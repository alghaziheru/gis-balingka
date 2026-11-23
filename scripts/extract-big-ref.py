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
        description="Extract official BIG Nagari boundary and Agam RBI 50K layers for Nagari Balingka into raw-data/."
    )
    parser.add_argument(
        "--ref-dir",
        default=DEFAULT_REF_DIR,
        help="Directory containing downloaded BIG archives (Agam.zip, BATASWILAYAH_DESA_20260601.gdb.zip) or extracted .gdb folders. Defaults to $BIG_REF_DIR or raw-data/big-ref.",
    )
    return parser.parse_args()


def resolve_gdb(tmp_dir: str, candidates: list[Path], zip_path: Path, inner_rel: Path, fallback_rel: Path | None = None) -> Path:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    if zip_path.exists():
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp_dir)
        extracted = Path(tmp_dir) / inner_rel
        if extracted.exists():
            return extracted
        if fallback_rel is not None and (Path(tmp_dir) / fallback_rel).exists():
            return Path(tmp_dir) / fallback_rel
    raise SystemExit(
        f"Missing required BIG GIS dataset. Expected {[str(c) for c in candidates]} or {zip_path}.\n"
        "Download the official datasets from https://tanahair.indonesia.go.id/ and see DATA_SOURCES.md for instructions."
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
    rbi_zip_name = ro.get("bigRbiZipName") or "Agam.zip"
    rbi_gdb_name = ro.get("bigRbiGdbName") or "RBI50K_AGAM_KUGI50_20221231.gdb"
    desa_gdb_name = ro.get("bigDesaGdbName") or "BATASWILAYAH_DESA_20260601.gdb"
    target_code = str(REGION_CFG.get("officialBoundaryCode") or "13.06.05.2003").strip()
    target_name = str(REGION_CFG.get("officialBoundaryNameMatch") or "BALINGKA").strip().upper()
    region_name = str(REGION_CFG.get("name") or "Nagari Balingka")
    das_name = str(ro.get("bigRbiDasName") or "")

    with tempfile.TemporaryDirectory(prefix="big-ref-") as tmp:
        rbi_gdb = resolve_gdb(
            tmp,
            [
                ref_dir / "KAB AGAM" / rbi_gdb_name,
                ref_dir / rbi_gdb_name,
            ],
            ref_dir / rbi_zip_name,
            Path("KAB AGAM") / rbi_gdb_name,
            Path(rbi_gdb_name),
        )
        desa_gdb = resolve_gdb(
            tmp,
            [ref_dir / desa_gdb_name],
            ref_dir / f"{desa_gdb_name}.zip",
            Path(desa_gdb_name),
        )

        # 1. Extract BIG official village/nagari boundary from region.config.json
        nagari_features = []
        for geom, attrs in read_gdb_layer(str(desa_gdb), "BATAS_DESAKEL_AR", bbox=BBOX):
            code = str(attrs.get("KDEPUM") or "").strip()
            name = str(attrs.get("NAMOBJ") or attrs.get("WADMKD") or "").strip()
            if code != target_code and name.upper() != target_name:
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
                        "kecamatan": str(attrs.get("WADMKC") or REGION_CFG.get("district") or ""),
                        "kabupaten": str(attrs.get("WADMKK") or REGION_CFG.get("regency") or ""),
                        "source": "BIG — Batas Wilayah Desa/Nagari (Juni 2026)",
                        "official": True,
                    },
                    "geometry": {"type": gj["type"], "coordinates": coords},
                }
            )

        out_nagari = RAW_DIR / "big-nagari-2026.geojson"
        out_nagari.write_text(json.dumps({"type": "FeatureCollection", "features": nagari_features}))

        # 2. Extract BIG RBI 50K layers
        rivers = []
        for idx, (geom, attrs) in enumerate(read_gdb_layer(str(rbi_gdb), "SUNGAI_LN_50K", bbox=PAD_BBOX), 1):
            raw_name = str(attrs.get("NAMOBJ") or "").strip()
            remark = str(attrs.get("REMARK") or "").strip()
            parts = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
            for pi, line in enumerate(parts):
                coords = round_coords(line.__geo_interface__["coordinates"])
                if len(coords) < 2:
                    continue
                is_main = bool(raw_name) or "satu garis" in remark.lower()
                rivers.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "id": f"rbi22-{idx}" + (f"-{pi + 1}" if len(parts) > 1 else ""),
                            "name": raw_name or f"Anak Sungai RBI #{idx}",
                            "kind": "river" if raw_name.lower().startswith("sungai") else "stream",
                            "das": das_name,
                            "remark": remark,
                            "source": "BIG — Peta RBI 1:50.000 (Des 2022)",
                        },
                        "geometry": {"type": "LineString", "coordinates": coords},
                    }
                )

        def extract_points(layer_name):
            pts = []
            for idx, (geom, attrs) in enumerate(read_gdb_layer(str(rbi_gdb), layer_name, bbox=BBOX), 1):
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

        facilities = []
        for layer, cat in [
            ("SARANAIBADAH_PT_50K", "worship"),
            ("PENDIDIKAN_PT_50K", "school"),
            ("PUSKESMAS_PT_50K", "health"),
            ("PEMERINTAHAN_PT_50K", "gov"),
        ]:
            for pt in extract_points(layer):
                facilities.append({**pt, "category": cat})

        out_rbi = RAW_DIR / "big-rbi-2022.json"
        out_rbi.write_text(
            json.dumps(
                {
                    "source": "BIG RBI 1:50.000 Kab. Agam (KUGI50, Des 2022)",
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
