#!/usr/bin/env python3
"""
Extracts official BIG Nagari boundary (June 2026) and BIG Agam RBI 50K layers (Dec 2022)
for the Nagari Balingka extent into compact 2D WGS84 GeoJSON/JSON under raw-data/.
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


def load_region_config():
    cfg_path = ROOT / "region.config.json"
    if cfg_path.exists():
        return json.loads(cfg_path.read_text(encoding="utf-8"))
    return {
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


REGION_CFG = load_region_config()
_bb = REGION_CFG["bbox"]
BBOX = (float(_bb["west"]), float(_bb["south"]), float(_bb["east"]), float(_bb["north"]))
PAD_BBOX = (BBOX[0] - 0.003, BBOX[1] - 0.003, BBOX[2] + 0.003, BBOX[3] + 0.003)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract official BIG Desa/Nagari boundary and optional RBI 50K layers for region.config.json into raw-data/."
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


def main():
    args = parse_args()
    import pyogrio

    ref_dir = Path(args.ref_dir)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    ro = REGION_CFG.get("regionalOverlays") or {}
    rbi_zip_name = str(ro.get("bigRbiZipName") or "").strip()
    rbi_gdb_name = str(ro.get("bigRbiGdbName") or "").strip()
    desa_gdb_name = str(ro.get("bigDesaGdbName") or "BATASWILAYAH_DESA_20260601.gdb").strip()
    target_code = str(REGION_CFG.get("officialBoundaryCode") or "").strip()
    target_name = str(REGION_CFG.get("officialBoundaryNameMatch") or "").strip().upper()
    region_name = str(REGION_CFG.get("name") or "Wilayah")
    regency_name = str(REGION_CFG.get("regency") or "")
    das_name = str(ro.get("bigRbiDasName") or "")

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

        # 1. Extract BIG official village/nagari boundary from region.config.json
        nagari_features = []
        bbox_candidates = []
        for geom, attrs in read_gdb_layer(str(desa_gdb), "BATAS_DESAKEL_AR", bbox=BBOX):
            code = str(attrs.get("KDEPUM") or "").strip()
            name = str(attrs.get("NAMOBJ") or attrs.get("WADMKD") or "").strip()
            kec = str(attrs.get("WADMKC") or "").strip()
            kab = str(attrs.get("WADMKK") or "").strip()
            bbox_candidates.append({"KDEPUM": code, "NAMOBJ": name, "WADMKC": kec, "WADMKK": kab})
            code_match = bool(target_code) and code == target_code
            name_match = bool(target_name) and name.upper() == target_name
            if not (code_match or name_match):
                continue
            gj = json.loads(pyogrio.to_geojson(geom) if hasattr(pyogrio, "to_geojson") else json.dumps(geom.__geo_interface__))
            coords = round_coords(gj["coordinates"])
            nagari_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "name_id": f"Batas Administrasi {region_name}",
                        "name_en": f"{region_name} Administrative Boundary",
                        "code": code or target_code,
                        "kecamatan": kec or str(REGION_CFG.get("district") or ""),
                        "kabupaten": kab or regency_name,
                        "source": "BIG — Batas Wilayah Desa/Nagari",
                        "official": True,
                    },
                    "geometry": {"type": gj["type"], "coordinates": coords},
                }
            )

        if not nagari_features:
            print(
                f"[extract-big-ref] WARNING: No boundary matched officialBoundaryCode='{target_code}' "
                f"or officialBoundaryNameMatch='{target_name}' inside bbox {BBOX}."
            )
            if bbox_candidates:
                print("[extract-big-ref] Villages found inside your bbox (copy KDEPUM/NAMOBJ to region.config.json):")
                for cand in bbox_candidates[:25]:
                    print(f"  - {cand['KDEPUM']} | {cand['NAMOBJ']} ({cand['WADMKC']}, {cand['WADMKK']})")

        out_nagari = RAW_DIR / "big-nagari-2026.geojson"
        out_nagari.write_text(json.dumps({"type": "FeatureCollection", "features": nagari_features}))

        # 2. Extract optional BIG RBI 50K layers if archive is present
        rivers = []
        culverts = []
        bridges = []
        weirs = []
        toponyms = []
        facilities = []

        if rbi_gdb is not None:
            for idx, (geom, attrs) in enumerate(read_gdb_layer(str(rbi_gdb), "SUNGAI_LN_50K", bbox=PAD_BBOX), 1):
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
                    rows = read_gdb_layer(str(rbi_gdb), layer_name, bbox=BBOX)
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

            out_rbi = RAW_DIR / "big-rbi-2022.json"
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


if __name__ == "__main__":
    main()
