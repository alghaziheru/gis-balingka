import type { DemGridData } from '../../types/gis';

export const SIM_ELEV_MAX_M = 1250;

const ELEV_STOPS: readonly [number, readonly [number, number, number]][] = [
  [0.0, [58, 122, 88]],   // calm valley sage-emerald
  [0.25, [130, 168, 102]], // soft terraced olive-green
  [0.5, [198, 180, 118]], // muted warm ochre
  [0.75, [182, 126, 86]], // calm earthy terracotta
  [1.0, [224, 219, 209]]  // >= maxCapM soft ridge warm stone
];

function lerpElevColor(tNorm: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, tNorm));
  for (let i = 1; i < ELEV_STOPS.length; i++) {
    const [t1, c1] = ELEV_STOPS[i];
    const [t0, c0] = ELEV_STOPS[i - 1];
    if (t <= t1 || i === ELEV_STOPS.length - 1) {
      const f = Math.max(0, Math.min(1, (t - t0) / Math.max(1e-6, t1 - t0)));
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f
      ];
    }
  }
  const last = ELEV_STOPS[ELEV_STOPS.length - 1][1];
  return [last[0], last[1], last[2]];
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Renders a visual-only hypsometric + NW/W hillshade PNG capped at `maxCapM` (1,250 mdpl)
 * so valley & settlement terrain relief displays crisp elevation detail in Simulation view
 * without altering any DEM data or hydrological calculations.
 */
export function renderValleyElevationDataUrl(
  dem: DemGridData,
  maxCapM = SIM_ELEV_MAX_M,
  outSize = 640
): string {
  const bin = atob(dem.elevBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  const rawElev = new Int16Array(bytes.buffer);
  const { width, height, minElev, maxElev, cellSizeX, cellSizeY } = dem;

  const hiElev = new Float32Array(outSize * outSize);
  for (let y = 0; y < outSize; y++) {
    const yf = (y / Math.max(1, outSize - 1)) * (height - 1);
    const y0 = Math.floor(yf);
    const y1 = Math.min(height - 1, y0 + 1);
    const ty = yf - y0;
    const row0 = y0 * width;
    const row1 = y1 * width;
    for (let x = 0; x < outSize; x++) {
      const xf = (x / Math.max(1, outSize - 1)) * (width - 1);
      const x0 = Math.floor(xf);
      const x1 = Math.min(width - 1, x0 + 1);
      const tx = xf - x0;
      const top = rawElev[row0 + x0] * (1 - tx) + rawElev[row0 + x1] * tx;
      const bot = rawElev[row1 + x0] * (1 - tx) + rawElev[row1 + x1] * tx;
      hiElev[y * outSize + x] = top * (1 - ty) + bot * ty;
    }
  }

  const hiCellX = Math.max(1, (cellSizeX * (width - 1)) / Math.max(1, outSize - 1));
  const hiCellY = Math.max(1, (cellSizeY * (height - 1)) / Math.max(1, outSize - 1));

  const alt = (45 * Math.PI) / 180;
  const az1 = (315 * Math.PI) / 180;
  const az2 = (265 * Math.PI) / 180;
  const cosAlt = Math.cos(alt);
  const lx1 = Math.sin(az1) * cosAlt;
  const ly1 = Math.cos(az1) * cosAlt;
  const lx2 = Math.sin(az2) * cosAlt;
  const ly2 = Math.cos(az2) * cosAlt;
  const lz = Math.sin(alt);
  const zFactor = 1.65;

  const minE = minElev;
  const effectiveMax = Math.max(minE + 50, Math.min(maxElev, maxCapM));
  const elevSpan = Math.max(1, effectiveMax - minE);

  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const imgData = ctx.createImageData(outSize, outSize);
  const rgba = imgData.data;

  for (let y = 0; y < outSize; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(outSize - 1, y + 1);
    for (let x = 0; x < outSize; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(outSize - 1, x + 1);
      const dzdx = ((hiElev[y * outSize + x1] - hiElev[y * outSize + x0]) / (2 * hiCellX)) * zFactor;
      const dzdy = ((hiElev[y0 * outSize + x] - hiElev[y1 * outSize + x]) / (2 * hiCellY)) * zFactor;
      const invLen = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const nx = -dzdx * invLen;
      const ny = -dzdy * invLen;
      const nz = invLen;

      const shade1 = Math.max(0, nx * lx1 + ny * ly1 + nz * lz);
      const shade2 = Math.max(0, nx * lx2 + ny * ly2 + nz * lz);
      const shade = 0.7 * shade1 + 0.3 * shade2;

      const elev = hiElev[y * outSize + x];
      const eNorm = Math.max(0, Math.min(1, (elev - minE) / elevSpan));
      const rgb = lerpElevColor(eNorm);
      const lightMult = 0.56 + shade * 0.62;

      const pIdx = (y * outSize + x) * 4;
      rgba[pIdx] = clampByte(rgb[0] * lightMult);
      rgba[pIdx + 1] = clampByte(rgb[1] * lightMult);
      rgba[pIdx + 2] = clampByte(rgb[2] * lightMult);
      rgba[pIdx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}
