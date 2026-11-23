import type { BBox, SimFieldsData, VerifiedWaterwayFeature } from '../types/gis';

export interface FlowFieldData {
  width: number;
  height: number;
  bbox: BBox;
  vx: Float32Array;
  vy: Float32Array;
  speed: Float32Array;
  channelMask: Uint8Array;
  uplandBbox: BBox;
}

function decodeBase64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Compute tight bounding box of upland cells (`uplandWeight >= 120` inside Nagari mask),
 * falling back to the northern/upper 40% of `fields.bbox` if no upland cells match.
 */
export function computeUplandBounds(fields: SimFieldsData): BBox {
  const { width, height, bbox } = fields;
  const uplandWeight = decodeBase64Bytes(fields.uplandWeightBase64);
  const nagariMask = fields.nagariMaskBase64 ? decodeBase64Bytes(fields.nagariMaskBase64) : null;

  let minCol = width;
  let maxCol = -1;
  let minRow = height;
  let maxRow = -1;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const idx = r * width + c;
      if (nagariMask && nagariMask[idx] === 0) continue;
      if (uplandWeight[idx] >= 120) {
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
      }
    }
  }

  if (maxCol < minCol || maxRow < minRow) {
    return {
      west: bbox.west,
      east: bbox.east,
      north: bbox.north,
      south: bbox.north - (bbox.north - bbox.south) * 0.4
    };
  }

  const dLng = (bbox.east - bbox.west) / width;
  const dLat = (bbox.north - bbox.south) / height;

  return {
    west: bbox.west + minCol * dLng,
    east: bbox.west + (maxCol + 1) * dLng,
    north: bbox.north - minRow * dLat,
    south: bbox.north - (maxRow + 1) * dLat
  };
}

/**
 * Build a normalized 2D downhill terrain & verified-waterway velocity field
 * aligned with `fields` (`width × height`) in grid coordinates (+x east, +y south).
 */
export function buildFlowField(
  fields: SimFieldsData,
  getElevation: (lng: number, lat: number) => number,
  verifiedWaterways: VerifiedWaterwayFeature[] = []
): FlowFieldData {
  const { width, height, bbox, cellSizeX, cellSizeY } = fields;
  const n = width * height;
  const dLng = (bbox.east - bbox.west) / width;
  const dLat = (bbox.north - bbox.south) / height;

  const rawElev = new Float32Array(n);
  for (let r = 0; r < height; r++) {
    const lat = bbox.north - (r + 0.5) * dLat;
    for (let c = 0; c < width; c++) {
      const lng = bbox.west + (c + 0.5) * dLng;
      rawElev[r * width + c] = getElevation(lng, lat);
    }
  }

  // Gentle 1-pass 3x3 smoothing to suppress micro-pits on steep cliffs
  const elev = new Float32Array(n);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let sum = 0;
      let wSum = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= height) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= width) continue;
          const w = dr === 0 && dc === 0 ? 4 : dr === 0 || dc === 0 ? 2 : 1;
          sum += rawElev[rr * width + cc] * w;
          wSum += w;
        }
      }
      elev[r * width + c] = sum / Math.max(1, wSum);
    }
  }

  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const slopePct = decodeBase64Bytes(fields.slopePctBase64);
  const accNorm = decodeBase64Bytes(fields.accNormBase64);
  const speed = new Float32Array(n);
  const channelMask = new Uint8Array(n);

  const dx2 = Math.max(1, 2 * cellSizeX);
  const dy2 = Math.max(1, 2 * cellSizeY);
  const diagDist = Math.hypot(cellSizeX, cellSizeY);

  for (let r = 0; r < height; r++) {
    const r0 = Math.max(0, r - 1);
    const r1 = Math.min(height - 1, r + 1);
    for (let c = 0; c < width; c++) {
      const idx = r * width + c;
      const c0 = Math.max(0, c - 1);
      const c1 = Math.min(width - 1, c + 1);

      // Central difference: +x = east, +y = south
      const dzdx = (elev[r * width + c1] - elev[r * width + c0]) / dx2;
      const dzdy = (elev[r1 * width + c] - elev[r0 * width + c]) / dy2;
      let gx = -dzdx;
      let gy = -dzdy;
      let mag = Math.hypot(gx, gy);

      if (mag < 1e-4) {
        // Fallback to steepest downhill 8-neighbor on near-flat valley floors
        let bestDrop = 0;
        let bestDx = 0;
        let bestDy = 0;
        const eCenter = elev[idx];
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= height) continue;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const cc = c + dc;
            if (cc < 0 || cc >= width) continue;
            const dist = dr !== 0 && dc !== 0 ? diagDist : dr === 0 ? cellSizeX : cellSizeY;
            const drop = (eCenter - elev[rr * width + cc]) / Math.max(1, dist);
            if (drop > bestDrop) {
              bestDrop = drop;
              bestDx = dc;
              bestDy = dr;
            }
          }
        }
        if (bestDrop > 0) {
          const norm = Math.hypot(bestDx, bestDy) || 1;
          gx = bestDx / norm;
          gy = bestDy / norm;
          mag = 1;
        } else {
          gx = 0;
          gy = 0;
        }
      }

      if (mag > 0) {
        vx[idx] = gx / mag;
        vy[idx] = gy / mag;
      }

      const slFactor = Math.sqrt(Math.min(1, slopePct[idx] / 60));
      const accFactor = (accNorm[idx] / 255) * 0.45;
      speed[idx] = Math.max(0.15, Math.min(1.0, 0.18 + slFactor * 0.6 + accFactor));
      if (accNorm[idx] >= 90) {
        channelMask[idx] = Math.min(255, Math.max(channelMask[idx], accNorm[idx]));
      }
    }
  }

  // Two light diffusion passes to keep vectors smooth and prevent flat-cell stalls
  for (let pass = 0; pass < 2; pass++) {
    const nextVx = new Float32Array(vx);
    const nextVy = new Float32Array(vy);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const idx = r * width + c;
        const curMag = Math.hypot(vx[idx], vy[idx]);
        let sx = vx[idx] * (curMag > 0.1 ? 3.5 : 0);
        let sy = vy[idx] * (curMag > 0.1 ? 3.5 : 0);
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= height) continue;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const cc = c + dc;
            if (cc < 0 || cc >= width) continue;
            const nIdx = rr * width + cc;
            sx += vx[nIdx];
            sy += vy[nIdx];
          }
        }
        const m = Math.hypot(sx, sy);
        if (m > 1e-4) {
          nextVx[idx] = sx / m;
          nextVy[idx] = sy / m;
        }
      }
    }
    vx.set(nextVx);
    vy.set(nextVy);
  }

  // Guide streamlines along verified waterways (~35 m corridor)
  const corridorRadiusM = 35;
  const radCols = Math.max(1, Math.ceil(corridorRadiusM / Math.max(1, cellSizeX)));
  const radRows = Math.max(1, Math.ceil(corridorRadiusM / Math.max(1, cellSizeY)));

  for (const ww of verifiedWaterways) {
    const coords = ww.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const first = coords[0];
    const last = coords[coords.length - 1];
    const forwardDownhill = getElevation(first[0], first[1]) >= getElevation(last[0], last[1]);

    for (let s = 0; s < coords.length - 1; s++) {
      const a = forwardDownhill ? coords[s] : coords[s + 1];
      const b = forwardDownhill ? coords[s + 1] : coords[s];

      const colA = ((a[0] - bbox.west) / (bbox.east - bbox.west)) * width - 0.5;
      const rowA = ((bbox.north - a[1]) / (bbox.north - bbox.south)) * height - 0.5;
      const colB = ((b[0] - bbox.west) / (bbox.east - bbox.west)) * width - 0.5;
      const rowB = ((bbox.north - b[1]) / (bbox.north - bbox.south)) * height - 0.5;

      const dCol = colB - colA;
      const dRow = rowB - rowA;
      const segGridLen = Math.hypot(dCol, dRow);
      if (segGridLen < 1e-4) continue;

      const tx = dCol / segGridLen;
      const ty = dRow / segGridLen;
      const steps = Math.max(1, Math.ceil(segGridLen * 2));

      for (let k = 0; k <= steps; k++) {
        const f = k / steps;
        const cc = Math.round(colA + dCol * f);
        const rr = Math.round(rowA + dRow * f);
        for (let dr = -radRows; dr <= radRows; dr++) {
          const r = rr + dr;
          if (r < 0 || r >= height) continue;
          for (let dc = -radCols; dc <= radCols; dc++) {
            const c = cc + dc;
            if (c < 0 || c >= width) continue;
            const distM = Math.hypot(dc * cellSizeX, dr * cellSizeY);
            if (distM > corridorRadiusM) continue;
            const idx = r * width + c;
            const proximity = 1 - distM / corridorRadiusM;
            const maskVal = Math.round(140 + proximity * 115);
            if (maskVal > channelMask[idx]) channelMask[idx] = maskVal;

            const blend = 0.65 * (0.55 + 0.45 * proximity);
            const bx = vx[idx] * (1 - blend) + tx * blend;
            const by = vy[idx] * (1 - blend) + ty * blend;
            const bm = Math.hypot(bx, by);
            if (bm > 1e-4) {
              vx[idx] = bx / bm;
              vy[idx] = by / bm;
            } else {
              vx[idx] = tx;
              vy[idx] = ty;
            }
            speed[idx] = Math.min(1.0, Math.max(speed[idx], 0.52 + 0.35 * proximity));
          }
        }
      }
    }
  }

  return {
    width,
    height,
    bbox,
    vx,
    vy,
    speed,
    channelMask,
    uplandBbox: computeUplandBounds(fields)
  };
}

/**
 * Bilinearly sample velocity `(vx, vy)`, normalized speed `[0.15..1]`, and channel mask `[0..255]`
 * at normalized grid coordinates `u` (0 west -> 1 east) and `v` (0 north -> 1 south).
 */
export function sampleFlowVelocity(
  field: FlowFieldData,
  u: number,
  v: number
): { vx: number; vy: number; speed: number; channel: number } {
  const { width, height, vx, vy, speed, channelMask } = field;
  const xf = Math.max(0, Math.min(width - 1.0001, u * (width - 1)));
  const yf = Math.max(0, Math.min(height - 1.0001, v * (height - 1)));
  const x0 = Math.floor(xf);
  const y0 = Math.floor(yf);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = xf - x0;
  const ty = yf - y0;

  const i00 = y0 * width + x0;
  const i10 = y0 * width + x1;
  const i01 = y1 * width + x0;
  const i11 = y1 * width + x1;

  const bilerp = (arr: Float32Array | Uint8Array) => {
    const top = arr[i00] * (1 - tx) + arr[i10] * tx;
    const bot = arr[i01] * (1 - tx) + arr[i11] * tx;
    return top * (1 - ty) + bot * ty;
  };

  return {
    vx: bilerp(vx),
    vy: bilerp(vy),
    speed: bilerp(speed),
    channel: bilerp(channelMask)
  };
}
