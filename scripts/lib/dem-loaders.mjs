import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fromFile, fromUrl } from 'geotiff';
import { listSlippyTiles } from './tiles.mjs';

export function parseCliDemArg(rootDir, regionCfg) {
  const idx = process.argv.indexOf('--dem');
  if (idx !== -1 && process.argv[idx + 1]) return path.resolve(process.argv[idx + 1]);
  const demFile = regionCfg.regionalOverlays?.localDemFilename || 'demnas-balingka.tif';
  const defaultLocal = path.join(rootDir, 'raw-data', demFile);
  if (fs.existsSync(defaultLocal)) return defaultLocal;
  return null;
}

export function downsampleGrid(elev, w, h, maxDim = 520) {
  if (w <= maxDim && h <= maxDim) return { elev, width: w, height: h };
  const scale = Math.max(w / maxDim, h / maxDim);
  const nw = Math.round(w / scale);
  const nh = Math.round(h / scale);
  const out = new Float32Array(nw * nh);
  for (let r = 0; r < nh; r++) {
    const sr = Math.min(h - 1, Math.floor((r / nh) * h));
    for (let c = 0; c < nw; c++) {
      const sc = Math.min(w - 1, Math.floor((c / nw) * w));
      out[r * nw + c] = elev[sr * w + sc];
    }
  }
  return { elev: out, width: nw, height: nh };
}

export async function loadFromGeoTIFF(tiff, bbox, sourceLabel, signal) {
  const image = await tiff.getImage();
  const imgW = image.getWidth();
  const imgH = image.getHeight();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();

  const c0 = Math.max(0, Math.floor(((bbox.west - minX) / (maxX - minX)) * imgW));
  const c1 = Math.min(imgW, Math.ceil(((bbox.east - minX) / (maxX - minX)) * imgW));
  const r0 = Math.max(0, Math.floor(((maxY - bbox.north) / (maxY - minY)) * imgH));
  const r1 = Math.min(imgH, Math.ceil(((maxY - bbox.south) / (maxY - minY)) * imgH));

  const winW = Math.max(10, c1 - c0);
  const winH = Math.max(10, r1 - r0);
  const rasters = await image.readRasters({ window: [c0, r0, c0 + winW, r0 + winH], signal });
  const raw = rasters[0];
  let validSum = 0;
  let validCount = 0;
  for (let i = 0; i < raw.length; i++) {
    const v = Number(raw[i]);
    if (Number.isFinite(v) && v > -500) {
      validSum += v;
      validCount++;
    }
  }
  const fallbackFill = validCount > 0 ? validSum / validCount : 0;
  const floatGrid = new Float32Array(winW * winH);
  for (let i = 0; i < floatGrid.length; i++) {
    const v = Number(raw[i]);
    floatGrid[i] = Number.isFinite(v) && v > -500 ? v : fallbackFill;
  }

  const exactWest = minX + (c0 / imgW) * (maxX - minX);
  const exactEast = minX + ((c0 + winW) / imgW) * (maxX - minX);
  const exactNorth = maxY - (r0 / imgH) * (maxY - minY);
  const exactSouth = maxY - ((r0 + winH) / imgH) * (maxY - minY);

  const ds = downsampleGrid(floatGrid, winW, winH, 760);
  return {
    elev: ds.elev,
    width: ds.width,
    height: ds.height,
    bbox: { west: exactWest, south: exactSouth, east: exactEast, north: exactNorth },
    sourceLabel
  };
}

export async function loadCopernicusMosaic(tiles, bbox, sourceLabel, signal) {
  if (tiles.length === 1) {
    const tiff = await fromUrl(tiles[0].url, {}, signal);
    return loadFromGeoTIFF(tiff, bbox, sourceLabel, signal);
  }
  const pxPerDeg = 3600; // Copernicus GLO-30 (~1 arc-second)
  const rawW = Math.max(20, Math.round((bbox.east - bbox.west) * pxPerDeg));
  const rawH = Math.max(20, Math.round((bbox.north - bbox.south) * pxPerDeg));
  const scale = Math.max(1, rawW / 760, rawH / 760);
  const width = Math.max(20, Math.round(rawW / scale));
  const height = Math.max(20, Math.round(rawH / scale));
  const elev = new Float32Array(width * height).fill(Number.NaN);

  for (const tile of tiles) {
    const tiff = await fromUrl(tile.url, {}, signal);
    const image = await tiff.getImage();
    const imgW = image.getWidth();
    const imgH = image.getHeight();
    const [minX, minY, maxX, maxY] = image.getBoundingBox();

    const ix0 = Math.max(bbox.west, minX);
    const ix1 = Math.min(bbox.east, maxX);
    const iy0 = Math.max(bbox.south, minY);
    const iy1 = Math.min(bbox.north, maxY);
    if (ix1 <= ix0 || iy1 <= iy0) continue;

    const c0 = Math.max(0, Math.floor(((ix0 - minX) / (maxX - minX)) * imgW));
    const c1 = Math.min(imgW, Math.ceil(((ix1 - minX) / (maxX - minX)) * imgW));
    const r0 = Math.max(0, Math.floor(((maxY - iy1) / (maxY - minY)) * imgH));
    const r1 = Math.min(imgH, Math.ceil(((maxY - iy0) / (maxY - minY)) * imgH));
    const winW = Math.max(1, c1 - c0);
    const winH = Math.max(1, r1 - r0);
    const [raw] = await image.readRasters({ window: [c0, r0, c0 + winW, r0 + winH], signal });

    const outC0 = Math.max(0, Math.floor(((ix0 - bbox.west) / (bbox.east - bbox.west)) * width));
    const outC1 = Math.min(width, Math.ceil(((ix1 - bbox.west) / (bbox.east - bbox.west)) * width));
    const outR0 = Math.max(0, Math.floor(((bbox.north - iy1) / (bbox.north - bbox.south)) * height));
    const outR1 = Math.min(height, Math.ceil(((bbox.north - iy0) / (bbox.north - bbox.south)) * height));

    const winWest = minX + (c0 / imgW) * (maxX - minX);
    const winEast = minX + ((c0 + winW) / imgW) * (maxX - minX);
    const winNorth = maxY - (r0 / imgH) * (maxY - minY);
    const winSouth = maxY - ((r0 + winH) / imgH) * (maxY - minY);

    for (let r = outR0; r < outR1; r++) {
      const lat = bbox.north - ((r + 0.5) / height) * (bbox.north - bbox.south);
      const sr = Math.max(0, Math.min(winH - 1, Math.floor(((winNorth - lat) / Math.max(1e-9, winNorth - winSouth)) * winH)));
      for (let c = outC0; c < outC1; c++) {
        const lng = bbox.west + ((c + 0.5) / width) * (bbox.east - bbox.west);
        const sc = Math.max(0, Math.min(winW - 1, Math.floor(((lng - winWest) / Math.max(1e-9, winEast - winWest)) * winW)));
        const v = Number(raw[sr * winW + sc]);
        if (Number.isFinite(v) && v > -500) elev[r * width + c] = v;
      }
    }
  }

  let validSum = 0;
  let validCount = 0;
  for (let i = 0; i < elev.length; i++) {
    if (Number.isFinite(elev[i])) {
      validSum += elev[i];
      validCount++;
    }
  }
  const fillVal = validCount > 0 ? validSum / validCount : 0;
  for (let i = 0; i < elev.length; i++) {
    if (!Number.isFinite(elev[i])) elev[i] = fillVal;
  }

  return { elev, width, height, bbox, sourceLabel: `${sourceLabel} (${tiles.length}-tile mosaic)` };
}

export function decodePngRgb(buf) {
  let pos = 8, w = 0, h = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const rowOff = y * (stride + 1) + 1;
    const outOff = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowOff + x];
      const a = x >= bpp ? out[outOff + x - bpp] : 0;
      const b = y > 0 ? out[outOff - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[outOff - stride + x - bpp] : 0;
      let r = v;
      if (f === 1) r = (v + a) & 255;
      else if (f === 2) r = (v + b) & 255;
      else if (f === 3) r = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) r = (v + paeth(a, b, c)) & 255;
      out[outOff + x] = r;
    }
  }
  return { w, h, data: out };
}

export async function loadFromTerrariumFallback(bbox) {
  const z = 13;
  const n = 2 ** z;
  const { txList, tyList } = listSlippyTiles(bbox, z);
  const tiles = new Map();
  for (const tx of txList) {
    for (const ty of tyList) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Terrarium fetch failed: ${res.status}`);
      tiles.set(`${tx}:${ty}`, decodePngRgb(Buffer.from(await res.arrayBuffer())));
    }
  }
  const width = 160, height = 160;
  const elev = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const lat = bbox.north - ((r + 0.5) / height) * (bbox.north - bbox.south);
    const latRad = (lat * Math.PI) / 180;
    const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const ty = Math.floor(yf);
    const py = Math.min(255, Math.max(0, Math.floor((yf - ty) * 256)));
    for (let c = 0; c < width; c++) {
      const lng = bbox.west + ((c + 0.5) / width) * (bbox.east - bbox.west);
      const xf = ((lng + 180) / 360) * n;
      const tx = Math.floor(xf);
      const px = Math.min(255, Math.max(0, Math.floor((xf - tx) * 256)));
      const tile = tiles.get(`${tx}:${ty}`);
      const pIdx = (py * tile.w + px) * 3;
      elev[r * width + c] = tile.data[pIdx] * 256 + tile.data[pIdx + 1] + tile.data[pIdx + 2] / 256 - 32768;
    }
  }
  return { elev, width, height, bbox, sourceLabel: 'AWS Mapzen Terrarium DEM (Fallback z13)' };
}

export async function fetchDEM({ rootDir, regionCfg, bbox, regionName, copernicusTiles }) {
  const localPath = parseCliDemArg(rootDir, regionCfg);
  if (localPath) {
    console.log(`Loading local DEM GeoTIFF: ${localPath}`);
    const tiff = await fromFile(localPath);
    const label =
      path.basename(localPath) === 'demnas-balingka.tif'
        ? 'BIG DEMNAS 8m (0715-62_v1.0)'
        : `Local GeoTIFF (${path.basename(localPath)})`;
    return loadFromGeoTIFF(tiff, bbox, label);
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('Copernicus COG request timed out after 20s')), 20000);
  try {
    console.log(`Fetching Copernicus DEM GLO-30 COG (${copernicusTiles.length} tile(s)) for ${regionName} block...`);
    return await loadCopernicusMosaic(
      copernicusTiles,
      bbox,
      'Copernicus DEM GLO-30 (30m, ESA/Airbus Open Data)',
      ac.signal
    );
  } catch (err) {
    console.warn(`Copernicus COG failed (${err.message}); falling back to AWS Terrarium tiles...`);
    return loadFromTerrariumFallback(bbox);
  } finally {
    clearTimeout(timer);
  }
}
