import type { DemGridData, ElevationProfileResult, RaindropTrace } from '../types/gis';

export function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class DemClient {
  private readonly grid: DemGridData;
  private readonly elev: Int16Array;

  constructor(grid: DemGridData) {
    this.grid = grid;
    const bin = atob(grid.elevBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    this.elev = new Int16Array(bytes.buffer);
  }

  get meta(): DemGridData {
    return this.grid;
  }

  getElevation(lng: number, lat: number): number {
    const { width, height, bbox } = this.grid;
    const colF = ((lng - bbox.west) / (bbox.east - bbox.west)) * width - 0.5;
    const rowF = ((bbox.north - lat) / (bbox.north - bbox.south)) * height - 0.5;

    const cClamped = Math.max(0, Math.min(width - 1.0001, colF));
    const rClamped = Math.max(0, Math.min(height - 1.0001, rowF));

    const c0 = Math.floor(cClamped);
    const r0 = Math.floor(rClamped);
    const c1 = Math.min(width - 1, c0 + 1);
    const r1 = Math.min(height - 1, r0 + 1);

    const tx = cClamped - c0;
    const ty = rClamped - r0;

    const e00 = this.elev[r0 * width + c0];
    const e10 = this.elev[r0 * width + c1];
    const e01 = this.elev[r1 * width + c0];
    const e11 = this.elev[r1 * width + c1];

    const top = e00 * (1 - tx) + e10 * tx;
    const bot = e01 * (1 - tx) + e11 * tx;
    return top * (1 - ty) + bot * ty;
  }

  getSlopePercent(lng: number, lat: number): number {
    const dLng = ((this.grid.bbox.east - this.grid.bbox.west) / this.grid.width) * 0.9;
    const dLat = ((this.grid.bbox.north - this.grid.bbox.south) / this.grid.height) * 0.9;
    const dx = haversineMeters(lng - dLng, lat, lng + dLng, lat);
    const dy = haversineMeters(lng, lat - dLat, lng, lat + dLat);
    if (dx <= 0 || dy <= 0) return 0;
    const dzdx = (this.getElevation(lng + dLng, lat) - this.getElevation(lng - dLng, lat)) / dx;
    const dzdy = (this.getElevation(lng, lat + dLat) - this.getElevation(lng, lat - dLat)) / dy;
    return Math.min(180, Math.round(Math.hypot(dzdx, dzdy) * 100));
  }

  traceRaindrop(startLng: number, startLat: number): RaindropTrace {
    const { bbox, width, height } = this.grid;
    const stepLng = (bbox.east - bbox.west) / width;
    const stepLat = (bbox.north - bbox.south) / height;

    const dirs: [number, number][] = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1]
    ];

    const path: [number, number][] = [[startLng, startLat]];
    let curLng = startLng;
    let curLat = startLat;
    let curElev = this.getElevation(curLng, curLat);
    let prevDir: [number, number] = [0.6, 0.7];

    const seen = new Set<string>();
    const quant = (x: number, y: number) => `${Math.round(x * 3500)},${Math.round(y * 3500)}`;
    seen.add(quant(curLng, curLat));

    for (let s = 0; s < 140; s++) {
      let bestScore = Infinity;
      let bestNext: [number, number] | null = null;
      let bestElev = curElev;
      let bestDir = prevDir;

      for (const [dx, dy] of dirs) {
        const nLng = curLng + dx * stepLng;
        const nLat = curLat + dy * stepLat;
        if (nLng < bbox.west || nLng > bbox.east || nLat < bbox.south || nLat > bbox.north) continue;
        if (seen.has(quant(nLng, nLat))) continue;

        const nElev = this.getElevation(nLng, nLat);
        const dot = dx * prevDir[0] + dy * prevDir[1];
        if (dot < -0.55) continue;

        const score = nElev - dot * 0.45;
        if (score < bestScore) {
          bestScore = score;
          bestNext = [nLng, nLat];
          bestElev = nElev;
          bestDir = [dx, dy];
        }
      }

      if (!bestNext) break;
      if (bestElev > curElev + 8 && s > 6) break;

      path.push(bestNext);
      seen.add(quant(bestNext[0], bestNext[1]));
      curLng = bestNext[0];
      curLat = bestNext[1];
      curElev = Math.min(curElev, bestElev);
      prevDir = bestDir;
    }

    let lengthM = 0;
    for (let i = 0; i < path.length - 1; i++) {
      lengthM += haversineMeters(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
    }
    const startElev = this.getElevation(path[0][0], path[0][1]);
    const endElev = this.getElevation(path[path.length - 1][0], path[path.length - 1][1]);
    const dropM = Math.max(0, startElev - endElev);
    const avgSlopePct = lengthM > 0 ? (dropM / lengthM) * 100 : 0;

    return {
      coordinates: path,
      startElev,
      endElev,
      dropM,
      lengthM,
      avgSlopePct
    };
  }

  sampleElevationProfile(ptA: [number, number], ptB: [number, number], count = 60): ElevationProfileResult {
    const totalDistM = haversineMeters(ptA[0], ptA[1], ptB[0], ptB[1]);
    const samples = [];
    let minElev = Infinity;
    let maxElev = -Infinity;
    let maxSlopePct = 0;

    for (let i = 0; i <= count; i++) {
      const f = i / count;
      const lng = ptA[0] + (ptB[0] - ptA[0]) * f;
      const lat = ptA[1] + (ptB[1] - ptA[1]) * f;
      const elev = this.getElevation(lng, lat);
      minElev = Math.min(minElev, elev);
      maxElev = Math.max(maxElev, elev);
      samples.push({ dist: totalDistM * f, elev, lng, lat });
      if (i > 0) {
        const segD = totalDistM / count;
        if (segD > 1) {
          const sl = (Math.abs(elev - samples[i - 1].elev) / segD) * 100;
          maxSlopePct = Math.max(maxSlopePct, sl);
        }
      }
    }

    return { samples, totalDistM, minElev, maxElev, maxSlopePct };
  }
}
