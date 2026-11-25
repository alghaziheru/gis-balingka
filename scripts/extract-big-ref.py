#!/usr/bin/env python3
"""
Extracts official BIG Nagari/Desa boundary (June 2026) and BIG RBI 50K layers (Dec 2022)
for one or all regions in regions.config.json (or region.config.json) into raw-data/.
"""

import argparse
import json
import os
import tempfile
import warnings
import zipfile
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "raw-data"
DEFAULT_REF_DIR = os.environ.get("BIG_REF_DIR") or str(RAW_DIR / "big-ref")


def load_regions_manifest():
    manifest_path = ROOT / "regions.config.json"
    if manifest_path.exists():
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        regions = data.get("regions") or []
        if regions:
            return data.get("defaultRegionId") or regions[0]["id"], regions
    cfg_path = ROOT / "region.config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        return cfg.get("id") or "nagari-balingka", [cfg]
    return "nagari-balingka", [
        {
            "id": "nagari-balingka",
            "name": "Nagari Balingka",
            "district": "Kec. IV Koto",
            "regency": "Kab. Agam",
            "officialBoundaryCode": "13.06.05.2003",
            "officialBoundaryNameMatch": "BALINGKA",
            "bbox": {"west": 100.278, "south": -0.408, "east": 100.345, "north": -0.314},
            "regionalOverlays": {
                "bigRbiZipName": "Agam.zip",
                "bigRbiGdbName": "RBI50K_AGAM_KUGI50_20221231.gdb",
                "bigDesaGdbName": "BATASWILAYAH_DESA_20260601.gdb",
                "bigRbiDasName": "MASANG KIRI",
            },
        }
    ]


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract official BIG Desa/Nagari boundary and optional RBI 50K layers into raw-data/."
    )
    parser.add_argument(
        "--ref-dir",
        default=DEFAULT_REF_DIR,
        help="Directory containing downloaded BIG archives (.zip or extracted .gdb folders). Defaults to $BIG_REF_DIR or raw-data/big-ref.",
    )
    parser.add_argument(
        "--desa-only",
        action="store_true",
        help="Extract only the official Desa/Nagari boundary and skip RBI 50K rivers/structures.",
    )
    parser.add_argument(
        "--region",
        default=None,
        help="Region ID from regions.config.json to extract (defaults to defaultRegionId).",
    )
    parser.add_argument(
        "--all-regions",
        action="store_true",
        help="Extract BIG boundaries & RBI 50K for all regions in regions.config.json.",
    )
    return parser.parse_args()


def find_gdb_in_dir(base_dir: Path, preferred_name: str, keyword: str = "") -> Path | None:
    if not base_dir.exists():
        return None
    if preferred_name:
        direct = base_dir / preferred_name
        if direct.exists():
            return direct
        for match in base_dir.rglob(preferred_name):
            if match.is_dir():
                return match
    if keyword:
        kw = keyword.upper()
        for match in base_dir.rglob("*.gdb"):
            if match.is_dir() and kw in match.name.upper():
                return match
    return None


def resolve_gdb(
    tmp_dir: str,
    ref_dir: Path,
    gdb_name: str,
    zip_name: str,
    keyword: str = "",
    required: bool = True,
) -> Path | None:
    found = find_gdb_in_dir(ref_dir, gdb_name, keyword=keyword)
    if found is not None:
        return found

    zip_candidates = []
    if zip_name:
        zip_candidates.append(ref_dir / zip_name)
    if gdb_name:
        zip_candidates.append(ref_dir / f"{gdb_name}.zip")
    for zp in zip_candidates:
        if zp.exists() and zp.is_file():
            sub_tmp = Path(tmp_dir) / zp.stem
            sub_tmp.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zp) as zf:
                zf.extractall(sub_tmp)
            extracted = find_gdb_in_dir(sub_tmp, gdb_name, keyword=keyword)
            if extracted is not None:
                return extracted
            any_gdb = next((p for p in sub_tmp.rglob("*.gdb") if p.is_dir()), None)
            if any_gdb is not None:
                return any_gdb

    if not required:
        return None
    raise SystemExit(
        f"Missing required BIG GIS dataset in {ref_dir} (expected '{gdb_name}' or '{zip_name or gdb_name + '.zip'}').\n"
        "Download the official datasets from https://tanahair.indonesia.go.id/portal-web/ and see DATA_SOURCES.md / docs/ADAPT_REGION.md."
    )


def round_coords(obj):
    if isinstance(obj, (list, tuple)):
        if len(obj) >= 2 and isinstance(obj[0], (int, float)) and isinstance(obj[1], (int, float)):
            return [round(float(obj[0]), 6), round(float(obj[1]), 6)]
        return [round_coords(c) for c in obj]
    return obj


def read_gdb_layer(gdb_path: str, layer: str, bbox=None):
    from pyogrio import raw
    from shapely import force_2d, from_wkb

    meta, _, wkbs, fields = raw.read(gdb_path, layer=layer, bbox=bbox)
    fnames = list(meta["fields"])
    rows = []
    if wkbs is None or len(wkbs) == 0:
        return rows
    for idx in range(len(wkbs)):
        if wkbs[idx] is None:
            continue
        geom = force_2d(from_wkb(bytes(wkbs[idx])))
        if geom.is_empty:
            continue
        attrs = {fnames[col]: fields[col][idx] for col in range(len(fnames))}
        rows.append((geom, attrs))
    return rows


def extract_for_region(region_cfg, default_region_id, desa_gdb, rbi_gdb):
    import pyogrio
    from shapely.ops import unary_union

    region_id = str(region_cfg.get("id") or "nagari-balingka")
    out_dir = RAW_DIR if region_id == default_region_id else RAW_DIR / region_id
    out_dir.mkdir(parents=True, exist_ok=True)

    bb = region_cfg["bbox"]
    bbox = (float(bb["west"]), float(bb["south"]), float(bb["east"]), float(bb["north"]))
    pad_bbox = (bbox[0] - 0.003, bbox[1] - 0.003, bbox[2] + 0.003, bbox[3] + 0.003)

    ro = region_cfg.get("regionalOverlays") or {}
    target_code = str(region_cfg.get("officialBoundaryCode") or "").strip()
    target_codes = {str(c).strip() for c in (region_cfg.get("officialBoundaryCodes") or []) if str(c).strip()}
    if target_code and not target_codes:
        target_codes.add(target_code)
    target_name = str(region_cfg.get("officialBoundaryNameMatch") or "").strip().upper()
    region_name = str(region_cfg.get("name") or "Wilayah")
    regency_name = str(region_cfg.get("regency") or "")
    das_name = str(ro.get("bigRbiDasName") or "")

    matched_rows = []
    bbox_candidates = []
    for geom, attrs in read_gdb_layer(str(desa_gdb), "BATAS_DESAKEL_AR", bbox=bbox):
        code = str(attrs.get("KDEPUM") or "").strip()
        name = str(attrs.get("NAMOBJ") or attrs.get("WADMKD") or "").strip()
        kec = str(attrs.get("WADMKC") or "").strip()
        kab = str(attrs.get("WADMKK") or "").strip()
        bbox_candidates.append({"KDEPUM": code, "NAMOBJ": name, "WADMKC": kec, "WADMKK": kab})
        code_match = bool(target_codes) and code in target_codes
        name_match = (not target_codes or len(target_codes) <= 1) and bool(target_name) and name.upper() == target_name
        if not (code_match or name_match):
            continue
        matched_rows.append((geom, attrs, code, name, kec, kab))

    nagari_features = []
    sub_features = []
    if len(matched_rows) == 1:
        geom, attrs, code, name, kec, kab = matched_rows[0]
        gj = json.loads(pyogrio.to_geojson(geom) if hasattr(pyogrio, "to_geojson") else json.dumps(geom.__geo_interface__))
        coords = round_coords(gj["coordinates"])
        nagari_features.append(
            {
                "type": "Feature",
                "properties": {
                    "name_id": f"Batas Administrasi {region_name}",
                    "name_en": f"{region_name} Administrative Boundary",
                    "code": code or target_code,
                    "kecamatan": kec or str(region_cfg.get("district") or ""),
                    "kabupaten": kab or regency_name,
                    "source": "BIG — Batas Wilayah Desa/Nagari",
                    "official": True,
                },
                "geometry": {"type": gj["type"], "coordinates": coords},
            }
        )
    elif len(matched_rows) > 1:
        for geom, attrs, code, name, kec, kab in matched_rows:
            gj = json.loads(pyogrio.to_geojson(geom) if hasattr(pyogrio, "to_geojson") else json.dumps(geom.__geo_interface__))
            coords = round_coords(gj["coordinates"])
            sub_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "name_id": f"Nagari {name}",
                        "name_en": f"Nagari {name}",
                        "code": code,
                        "kecamatan": kec or str(region_cfg.get("district") or ""),
                        "kabupaten": kab or regency_name,
                        "area_km2": round(float(attrs.get("LUASWH") or 0), 2),
                        "source": "BIG — Batas Wilayah Desa/Nagari",
                        "official": True,
                    },
                    "geometry": {"type": gj["type"], "coordinates": coords},
                }
            )
        dissolved = unary_union([r[0].buffer(0) for r in matched_rows]).buffer(0.00002).buffer(-0.00002)
        gj = json.loads(
            pyogrio.to_geojson(dissolved)
            if hasattr(pyogrio, "to_geojson")
            else json.dumps(dissolved.__geo_interface__)
        )
        coords = round_coords(gj["coordinates"])
        nagari_features.append(
            {
                "type": "Feature",
                "properties": {
                    "name_id": f"Batas Administrasi {region_name}",
                    "name_en": f"{region_name} Administrative Boundary",
                    "code": target_code,
                    "kecamatan": str(region_cfg.get("district") or ""),
                    "kabupaten": regency_name,
                    "subRegionCount": len(matched_rows),
                    "source": "BIG — Batas Wilayah Desa/Nagari",
                    "official": True,
                },
                "geometry": {"type": gj["type"], "coordinates": coords},
            }
        )

    if not nagari_features:
        print(
            f"[extract-big-ref] WARNING ({region_id}): No boundary matched officialBoundaryCode='{target_code}' "
            f"or officialBoundaryNameMatch='{target_name}' inside bbox {bbox}."
        )
        if bbox_candidates:
            print("[extract-big-ref] Villages found inside bbox:")
            for cand in bbox_candidates[:25]:
                print(f"  - {cand['KDEPUM']} | {cand['NAMOBJ']} ({cand['WADMKC']}, {cand['WADMKK']})")

    out_nagari = out_dir / "big-nagari-2026.geojson"
    out_nagari.write_text(json.dumps({"type": "FeatureCollection", "features": nagari_features}))
    if sub_features:
        out_sub = out_dir / "big-sub-boundaries-2026.geojson"
        out_sub.write_text(json.dumps({"type": "FeatureCollection", "features": sub_features}))

    rivers = []
    culverts = []
    bridges = []
    weirs = []
    toponyms = []
    facilities = []

    if rbi_gdb is not None:
        for idx, (geom, attrs) in enumerate(read_gdb_layer(str(rbi_gdb), "SUNGAI_LN_50K", bbox=pad_bbox), 1):
            raw_name = str(attrs.get("NAMOBJ") or "").strip()
            remark = str(attrs.get("REMARK") or "").strip()
            parts = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
            for pi, line in enumerate(parts):
                coords = round_coords(line.__geo_interface__["coordinates"])
                if len(coords) < 2:
                    continue
                rivers.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "id": f"rbi22-{idx}" + (f"-{pi + 1}" if len(parts) > 1 else ""),
                            "name": raw_name or f"Anak Sungai RBI #{idx}",
                            "kind": "river" if raw_name.lower().startswith("sungai") else "stream",
                            "das": das_name,
                            "remark": remark,
                            "source": "BIG — Peta RBI 1:50.000",
                        },
                        "geometry": {"type": "LineString", "coordinates": coords},
                    }
                )

        def extract_points(layer_name):
            pts = []
            try:
                rows = read_gdb_layer(str(rbi_gdb), layer_name, bbox=bbox)
            except Exception:
                return pts
            for idx, (geom, attrs) in enumerate(rows, 1):
                c = round_coords([geom.x, geom.y])
                pts.append(
                    {
                        "idx": idx,
                        "name": str(attrs.get("NAMOBJ") or "").strip(),
                        "remark": str(attrs.get("REMARK") or "").strip(),
                        "coords": c,
                    }
                )
            return pts

        culverts = extract_points("GORONG_PT_50K")
        bridges = extract_points("JEMBATAN_PT_50K")
        weirs = extract_points("BENDUNG_PT_50K")
        toponyms = extract_points("TOPONIMI_PT_50K")

        for layer, cat in [
            ("SARANAIBADAH_PT_50K", "worship"),
            ("PENDIDIKAN_PT_50K", "school"),
            ("PUSKESMAS_PT_50K", "health"),
            ("PEMERINTAHAN_PT_50K", "gov"),
        ]:
            for pt in extract_points(layer):
                facilities.append({**pt, "category": cat})

        out_rbi = out_dir / "big-rbi-2022.json"
        rbi_label = f"BIG RBI 1:50.000 {regency_name}".strip()
        out_rbi.write_text(
            json.dumps(
                {
                    "source": f"{rbi_label} (KUGI50)",
                    "rivers": rivers,
                    "culverts": culverts,
                    "bridges": bridges,
                    "weirs": weirs,
                    "facilities": facilities,
                    "toponyms": toponyms,
                }
            )
        )

    print(
        json.dumps(
            {
                "regionId": region_id,
                "outDir": str(out_dir.relative_to(ROOT)),
                "nagariFeatures": len(nagari_features),
                "rbiExtracted": rbi_gdb is not None,
                "rivers": len(rivers),
                "culverts": len(culverts),
                "bridges": len(bridges),
                "weirs": len(weirs),
                "facilities": len(facilities),
                "toponyms": len(toponyms),
            },
            indent=2,
        )
    )


def main():
    args = parse_args()
    default_region_id, regions = load_regions_manifest()

    if args.all_regions:
        targets = regions
    elif args.region:
        targets = [r for r in regions if r.get("id") == args.region]
        if not targets:
            raise SystemExit(f"Unknown region '{args.region}'. Available: {[r.get('id') for r in regions]}")
    else:
        targets = [r for r in regions if r.get("id") == default_region_id] or [regions[0]]

    ref_dir = Path(args.ref_dir)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    ro0 = targets[0].get("regionalOverlays") or {}
    rbi_zip_name = str(ro0.get("bigRbiZipName") or "Agam.zip").strip()
    rbi_gdb_name = str(ro0.get("bigRbiGdbName") or "RBI50K_AGAM_KUGI50_20221231.gdb").strip()
    desa_gdb_name = str(ro0.get("bigDesaGdbName") or "BATASWILAYAH_DESA_20260601.gdb").strip()

    with tempfile.TemporaryDirectory(prefix="big-ref-") as tmp:
        desa_gdb = resolve_gdb(
            tmp,
            ref_dir,
            gdb_name=desa_gdb_name,
            zip_name=f"{desa_gdb_name}.zip",
            keyword="DESA",
            required=True,
        )
        rbi_gdb = None
        if not args.desa_only:
            rbi_gdb = resolve_gdb(
                tmp,
                ref_dir,
                gdb_name=rbi_gdb_name,
                zip_name=rbi_zip_name,
                keyword="RBI",
                required=False,
            )
            if rbi_gdb is None:
                print(
                    "[extract-big-ref] BIG RBI 50K archive not found (optional) — "
                    "extracting official Desa/Nagari boundary only."
                )

        for reg in targets:
            extract_for_region(reg, default_region_id, desa_gdb, rbi_gdb)


if __name__ == "__main__":
    main()
