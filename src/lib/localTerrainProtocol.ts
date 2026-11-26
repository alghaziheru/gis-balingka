import { addProtocol, type AddProtocolAction } from 'maplibre-gl';
import type { DemClient } from './demClient';

const TILE_SIZE = 256;
const TERRARIUM_OFFSET = 32768;
const demRegistry = new Map<string, DemClient>();
let protocolRegistered = false;

/** Encodes elevation (meters) into Mapzen Terrarium 24-bit RGB channels. */
export function encodeTerrariumRgb(elevM: number): [number, number, number] {
  const shifted = Math.max(0, Math.min(65535.996, elevM + TERRARIUM_OFFSET));
  const r = Math.floor(shifted / 256);
  const rem = shifted - r * 256;
  const g = Math.floor(rem);
  const b = Math.floor((rem - g) * 256);
  return [r, g, b];
}

export function getLocalDemTileUrl(regionId: string): string {
  return `local-dem://${encodeURIComponent(regionId)}/{z}/{x}/{y}`;
}

const handleLocalDemRequest: AddProtocolAction = async (params, abortController) => {
  if (abortController.signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const match = /^local-dem:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
  if (!match) {
    throw new Error(`Invalid local-dem tile URL: ${params.url}`);
  }

  const regionId = decodeURIComponent(match[1]);
  const z = Number(match[2]);
  const x = Number(match[3]);
  const y = Number(match[4]);

  const dem = demRegistry.get(regionId);
  if (!dem) {
    throw new Error(`No DEM client registered for region "${regionId}"`);
  }

  const n = 2 ** z;
  const lngs = new Float64Array(TILE_SIZE);
  const lats = new Float64Array(TILE_SIZE);

  for (let px = 0; px < TILE_SIZE; px++) {
    lngs[px] = ((x + (px + 0.5) / TILE_SIZE) / n) * 360 - 180;
  }
  for (let py = 0; py < TILE_SIZE; py++) {
    const mercY = Math.PI * (1 - (2 * (y + (py + 0.5) / TILE_SIZE)) / n);
    lats[py] = (Math.atan(Math.sinh(mercY)) * 180) / Math.PI;
  }

  const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = lats[py];
    const rowOffset = py * TILE_SIZE * 4;
    for (let px = 0; px < TILE_SIZE; px++) {
      const elev = dem.getElevation(lngs[px], lat);
      const [r, g, b] = encodeTerrariumRgb(elev);
      const idx = rowOffset + px * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  if (abortController.signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const bitmap = await createImageBitmap(new ImageData(rgba, TILE_SIZE, TILE_SIZE), {
    colorSpaceConversion: 'none'
  });

  return { data: bitmap };
};

/** Registers a region's DEM client and ensures the local-dem:// MapLibre protocol is active. */
export function registerLocalDemRegion(regionId: string, demClient: DemClient): void {
  demRegistry.set(regionId, demClient);
  if (!protocolRegistered) {
    addProtocol('local-dem', handleLocalDemRequest);
    protocolRegistered = true;
  }
}
