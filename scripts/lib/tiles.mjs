/**
 * Pure tile-addressing helpers for global open geospatial datasets
 * (Copernicus DEM GLO-30 1°×1° COGs, ESA WorldCover 10m 3°×3° COGs,
 * and Slippy-Map z/x/y Terrarium fallback tiles).
 */

const EPS = 1e-9;

export function buildCopernicusTile(latDeg, lngDeg) {
  const latTag = `${latDeg < 0 ? 'S' : 'N'}${String(Math.abs(latDeg)).padStart(2, '0')}_00`;
  const lngTag = `${lngDeg < 0 ? 'W' : 'E'}${String(Math.abs(lngDeg)).padStart(3, '0')}_00`;
  const tile = `Copernicus_DSM_COG_10_${latTag}_${lngTag}_DEM`;
  return {
    latDeg,
    lngDeg,
    tile,
    url: `https://copernicus-dem-30m.s3.amazonaws.com/${tile}/${tile}.tif`
  };
}

export function listCopernicusTiles(bbox) {
  const latStart = Math.floor(bbox.south);
  const latEnd = Math.floor(bbox.north - EPS);
  const lngStart = Math.floor(bbox.west);
  const lngEnd = Math.floor(bbox.east - EPS);
  const tiles = [];
  for (let lat = latStart; lat <= latEnd; lat++) {
    for (let lng = lngStart; lng <= lngEnd; lng++) {
      tiles.push(buildCopernicusTile(lat, lng));
    }
  }
  return tiles;
}

export function buildWorldCoverTile(latTile, lngTile) {
  const latTag = `${latTile < 0 ? 'S' : 'N'}${String(Math.abs(latTile)).padStart(2, '0')}`;
  const lngTag = `${lngTile < 0 ? 'W' : 'E'}${String(Math.abs(lngTile)).padStart(3, '0')}`;
  const tag = `${latTag}${lngTag}`;
  return {
    latTile,
    lngTile,
    tag,
    url: `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tag}_Map.tif`
  };
}

export function listWorldCoverTiles(bbox) {
  const latStart = Math.floor(bbox.south / 3) * 3;
  const latEnd = Math.floor((bbox.north - EPS) / 3) * 3;
  const lngStart = Math.floor(bbox.west / 3) * 3;
  const lngEnd = Math.floor((bbox.east - EPS) / 3) * 3;
  const tiles = [];
  for (let lat = latStart; lat <= latEnd; lat += 3) {
    for (let lng = lngStart; lng <= lngEnd; lng += 3) {
      tiles.push(buildWorldCoverTile(lat, lng));
    }
  }
  return tiles;
}

export function listSlippyTiles(bbox, z = 13) {
  const n = 2 ** z;
  const lonToTx = lon => Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
  const latToTy = lat => {
    const rad = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    return Math.max(0, Math.min(n - 1, Math.floor(y)));
  };
  const txMin = lonToTx(bbox.west);
  const txMax = lonToTx(bbox.east);
  const tyMin = latToTy(bbox.north);
  const tyMax = latToTy(bbox.south);
  const txList = [];
  for (let tx = txMin; tx <= txMax; tx++) txList.push(tx);
  const tyList = [];
  for (let ty = tyMin; ty <= tyMax; ty++) tyList.push(ty);
  return { z, txMin, txMax, tyMin, tyMax, txList, tyList };
}

/**
 * Checks whether a bbox overlaps Google Open Buildings v3 S2 level-4 cell `2fd`
 * (Central/West Sumatra, including Kab. Agam / Nagari Balingka).
 */
export function isInsideOpenBuildings2fd(bbox) {
  return bbox.east >= 98.5 && bbox.west <= 103.5 && bbox.north >= -3.0 && bbox.south <= 2.0;
}
