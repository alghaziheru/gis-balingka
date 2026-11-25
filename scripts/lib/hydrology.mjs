import zlib from 'node:zlib';

/**
 * Pure open-source hydrological terrain analysis & smooth raster rendering algorithms
 * for Nagari Balingka GIS.
 */

export const DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY = [0, 1, 1, 1, 0, -1, -1, -1];

class MinHeap {
  constructor(capacity) {
    this.idx = new Int32Array(capacity);
    this.val = new Float64Array(capacity);
    this.size = 0;
  }

  push(i, v) {
    let pos = this.size++;
    this.idx[pos] = i;
    this.val[pos] = v;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (this.val[parent] <= this.val[pos]) break;
      const ti = this.idx[parent];
      const tv = this.val[parent];
      this.idx[parent] = this.idx[pos];
      this.val[parent] = this.val[pos];
      this.idx[pos] = ti;
      this.val[pos] = tv;
      pos = parent;
    }
  }

  pop() {
    const outIdx = this.idx[0];
    const outVal = this.val[0];
    const last = --this.size;
    if (last > 0) {
      this.idx[0] = this.idx[last];
      this.val[0] = this.val[last];
      let pos = 0;
      while (true) {
        const l = pos * 2 + 1;
        const r = l + 1;
        let smallest = pos;
        if (l < last && this.val[l] < this.val[smallest]) smallest = l;
        if (r < last && this.val[r] < this.val[smallest]) smallest = r;
        if (smallest === pos) break;
        const ti = this.idx[pos];
        const tv = this.val[pos];
        this.idx[pos] = this.idx[smallest];
        this.val[pos] = this.val[smallest];
        this.idx[smallest] = ti;
        this.val[smallest] = tv;
        pos = smallest;
      }
    }
    return { idx: outIdx, val: outVal };
  }
}

export function priorityFloodFill(elev, width, height) {
  const n = width * height;
  const filled = new Float64Array(n);
  for (let i = 0; i < n; i++) filled[i] = elev[i];

  const closed = new Uint8Array(n);
  const heap = new MinHeap(n);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (r === 0 || r === height - 1 || c === 0 || c === width - 1) {
        const i = r * width + c;
        closed[i] = 1;
        heap.push(i, filled[i]);
      }
    }
  }

  const EPS = 1e-4;
  while (heap.size > 0) {
    const { idx, val } = heap.pop();
    const r = Math.floor(idx / width);
    const c = idx - r * width;

    for (let k = 0; k < 8; k++) {
      const nr = r + DY[k];
      const nc = c + DX[k];
      if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
      const ni = nr * width + nc;
      if (closed[ni]) continue;
      closed[ni] = 1;
      if (filled[ni] <= val) filled[ni] = val + EPS;
      heap.push(ni, filled[ni]);
    }
  }
  return filled;
}

export function computeD8(filled, width, height, cellSizeX = 30, cellSizeY = 30) {
  const n = width * height;
  const dir = new Int8Array(n).fill(-1);
  const diag = Math.hypot(cellSizeX, cellSizeY);
  const dist = [cellSizeX, diag, cellSizeY, diag, cellSizeX, diag, cellSizeY, diag];

  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      const i = r * width + c;
      const e = filled[i];
      let bestSlope = 0;
      let bestK = -1;
      for (let k = 0; k < 8; k++) {
        const ni = (r + DY[k]) * width + (c + DX[k]);
        const s = (e - filled[ni]) / dist[k];
        if (s > bestSlope) {
          bestSlope = s;
          bestK = k;
        }
      }
      dir[i] = bestK;
    }
  }

  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => filled[b] - filled[a]);

  const acc = new Int32Array(n);
  acc.fill(1);

  for (let p = 0; p < n; p++) {
    const i = order[p];
    const k = dir[i];
    if (k < 0) continue;
    const r = Math.floor(i / width);
    const c = i - r * width;
    const ni = (r + DY[k]) * width + (c + DX[k]);
    acc[ni] += acc[i];
  }

  return { dir, acc };
}

export function computeSlopePercent(rawElev, width, height, cellSizeX = 30, cellSizeY = 30) {
  const n = width * height;
  const slope = new Float32Array(n);
  const at = (r, c) => {
    const cr = Math.max(0, Math.min(height - 1, r));
    const cc = Math.max(0, Math.min(width - 1, c));
    return rawElev[cr * width + cc];
  };

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const a = at(r - 1, c - 1), b = at(r - 1, c), cc = at(r - 1, c + 1);
      const d = at(r, c - 1), f = at(r, c + 1);
      const g = at(r + 1, c - 1), h = at(r + 1, c), i = at(r + 1, c + 1);
      const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * cellSizeX);
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) / (8 * cellSizeY);
      slope[r * width + c] = Math.min(200, Math.hypot(dzdx, dzdy) * 100);
    }
  }
  return slope;
}

export function computeHAND(rawElev, dir, acc, width, height, streamThreshold = 75) {
  const n = width * height;
  const hand = new Float32Array(n);
  const drainElev = new Float64Array(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    if (acc[i] >= streamThreshold) {
      drainElev[i] = rawElev[i];
      hand[i] = 0;
    }
  }

  const stack = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(drainElev[i])) continue;
    stack.length = 0;
    let cur = i;
    let baseElev = NaN;
    let guard = 0;
    while (guard++ < n) {
      if (!Number.isNaN(drainElev[cur])) {
        baseElev = drainElev[cur];
        break;
      }
      stack.push(cur);
      const k = dir[cur];
      if (k < 0) {
        baseElev = rawElev[cur];
        break;
      }
      const r = Math.floor(cur / width);
      const c = cur - r * width;
      cur = (r + DY[k]) * width + (c + DX[k]);
    }
    if (Number.isNaN(baseElev)) baseElev = rawElev[i];
    for (let s = 0; s < stack.length; s++) {
      const idx = stack[s];
      drainElev[idx] = baseElev;
      hand[idx] = Math.max(0, rawElev[idx] - baseElev);
    }
  }

  return hand;
}

export function cellToLngLat(col, row, gridMeta) {
  const { width, height, bbox } = gridMeta;
  const lng = bbox.west + ((col + 0.5) / width) * (bbox.east - bbox.west);
  const lat = bbox.north - ((row + 0.5) / height) * (bbox.north - bbox.south);
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

export function gridPointToLngLat(colFloat, rowFloat, gridMeta) {
  const { width, height, bbox } = gridMeta;
  const lng = bbox.west + (colFloat / width) * (bbox.east - bbox.west);
  const lat = bbox.north - (rowFloat / height) * (bbox.north - bbox.south);
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

export function haversineMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function perpDistSq(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

export function simplifyLine(pts, tolDeg = 0.00009) {
  if (pts.length <= 2) return pts;
  const sqTol = tolDeg * tolDeg;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxSq = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = perpDistSq(pts[i], pts[first], pts[last]);
      if (sq > maxSq) {
        maxSq = sq;
        idx = i;
      }
    }
    if (maxSq > sqTol && idx !== -1) {
      keep[idx] = 1;
      if (idx - first > 1) stack.push([first, idx]);
      if (last - idx > 1) stack.push([idx, last]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * Chaikin corner-cutting curve smoother preserving exact start & end vertices
 * so stream junctions stay topologically connected without 45°/90° zigzags.
 */
export function chaikinSmooth(pts, iterations = 3) {
  if (pts.length <= 2) return pts;
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      if (i > 0) next.push([Number((0.75 * a[0] + 0.25 * b[0]).toFixed(6)), Number((0.75 * a[1] + 0.25 * b[1]).toFixed(6))]);
      if (i < cur.length - 2) next.push([Number((0.25 * a[0] + 0.75 * b[0]).toFixed(6)), Number((0.25 * a[1] + 0.75 * b[1]).toFixed(6))]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

export function extractFlowPathsGeoJSON(rawElev, dir, acc, gridMeta, thresholds = { main: 240, normal: 75, detail: 25 }) {
  const { width, height, cellSizeX, cellSizeY } = gridMeta;
  const n = width * height;
  const cellHa = (cellSizeX * cellSizeY) / 10000;

  const tierOf = i => {
    const a = acc[i];
    if (a >= thresholds.main) return 1;
    if (a >= thresholds.normal) return 2;
    if (a >= thresholds.detail) return 3;
    return 0;
  };

  const inDeg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (tierOf(i) === 0 || dir[i] < 0) continue;
    const r = Math.floor(i / width);
    const c = i - r * width;
    const ni = (r + DY[dir[i]]) * width + (c + DX[dir[i]]);
    if (tierOf(ni) > 0) inDeg[ni]++;
  }

  const features = [];
  let reachId = 0;

  for (let start = 0; start < n; start++) {
    const startTier = tierOf(start);
    if (startTier === 0 || inDeg[start] === 1) continue;

    let cur = start;
    let curTier = startTier;
    let pts = [];
    let startElev = rawElev[cur];
    let maxAcc = acc[cur];

    const pushSegment = (coords, tier, e0, e1, mAcc) => {
      if (coords.length < 2) return;
      const simplified = simplifyLine(coords, 0.00014);
      const smoothed = chaikinSmooth(simplified, 3);
      if (smoothed.length < 2) return;
      let len = 0;
      for (let j = 0; j < smoothed.length - 1; j++) {
        len += haversineMeters(smoothed[j][0], smoothed[j][1], smoothed[j + 1][0], smoothed[j + 1][1]);
      }
      if (len < 15) return;
      const drop = Math.max(0, e0 - e1);
      features.push({
        type: 'Feature',
        properties: {
          id: `flow-${++reachId}`,
          tier,
          catchment_ha: Number((mAcc * cellHa).toFixed(1)),
          elev_start: Math.round(e0),
          elev_end: Math.round(e1),
          length_m: Math.round(len),
          slope_pct: Number((len > 0 ? (drop / len) * 100 : 0).toFixed(1))
        },
        geometry: { type: 'LineString', coordinates: smoothed }
      });
    };

    let guard = 0;
    while (guard++ < n) {
      const r = Math.floor(cur / width);
      const c = cur - r * width;
      pts.push(cellToLngLat(c, r, gridMeta));
      maxAcc = Math.max(maxAcc, acc[cur]);

      const k = dir[cur];
      if (k < 0) {
        pushSegment(pts, curTier, startElev, rawElev[cur], maxAcc);
        break;
      }

      const ni = (r + DY[k]) * width + (c + DX[k]);
      const nextTier = tierOf(ni);
      if (nextTier === 0) {
        pushSegment(pts, curTier, startElev, rawElev[cur], maxAcc);
        break;
      }

      const nr = Math.floor(ni / width);
      const nc = ni - nr * width;
      const nextCoord = cellToLngLat(nc, nr, gridMeta);

      if (inDeg[ni] >= 2) {
        pts.push(nextCoord);
        pushSegment(pts, curTier, startElev, rawElev[ni], Math.max(maxAcc, acc[ni]));
        break;
      }

      if (nextTier < curTier) {
        pts.push(nextCoord);
        pushSegment(pts, curTier, startElev, rawElev[ni], maxAcc);
        curTier = nextTier;
        pts = [nextCoord];
        startElev = rawElev[ni];
        maxAcc = acc[ni];
      }

      cur = ni;
    }
  }

  return { type: 'FeatureCollection', features };
}

export function extractContoursGeoJSON(rawElev, gridMeta, interval = 25) {
  const { width, height } = gridMeta;
  let minE = Infinity, maxE = -Infinity;
  for (let i = 0; i < rawElev.length; i++) {
    if (rawElev[i] < minE) minE = rawElev[i];
    if (rawElev[i] > maxE) maxE = rawElev[i];
  }

  const startLevel = Math.ceil(minE / interval) * interval;
  const endLevel = Math.floor(maxE / interval) * interval;
  const features = [];

  const interp = (v1, v2, level) => {
    const dv = v2 - v1;
    if (Math.abs(dv) < 1e-9) return 0.5;
    return Math.max(0, Math.min(1, (level - v1) / dv));
  };

  const keyOf = p => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

  for (let level = startLevel; level <= endLevel; level += interval) {
    const adj = new Map();
    const segs = [];

    const addSeg = (p1, p2) => {
      const k1 = keyOf(p1), k2 = keyOf(p2);
      if (k1 === k2) return;
      const idx = segs.length;
      segs.push({ p1, p2, k1, k2, used: false });
      if (!adj.has(k1)) adj.set(k1, []);
      if (!adj.has(k2)) adj.set(k2, []);
      adj.get(k1).push(idx);
      adj.get(k2).push(idx);
    };

    for (let r = 0; r < height - 1; r++) {
      for (let c = 0; c < width - 1; c++) {
        const tl = rawElev[r * width + c];
        const tr = rawElev[r * width + c + 1];
        const br = rawElev[(r + 1) * width + c + 1];
        const bl = rawElev[(r + 1) * width + c];

        const code =
          (tl >= level ? 8 : 0) |
          (tr >= level ? 4 : 0) |
          (br >= level ? 2 : 0) |
          (bl >= level ? 1 : 0);

        if (code === 0 || code === 15) continue;

        const top = [c + 0.5 + interp(tl, tr, level), r + 0.5];
        const right = [c + 1.5, r + 0.5 + interp(tr, br, level)];
        const bottom = [c + 0.5 + interp(bl, br, level), r + 1.5];
        const left = [c + 0.5, r + 0.5 + interp(tl, bl, level)];
        const centerAbove = (tl + tr + br + bl) * 0.25 >= level;

        switch (code) {
          case 1: case 14: addSeg(left, bottom); break;
          case 2: case 13: addSeg(bottom, right); break;
          case 3: case 12: addSeg(left, right); break;
          case 4: case 11: addSeg(top, right); break;
          case 6: case 9: addSeg(top, bottom); break;
          case 7: case 8: addSeg(left, top); break;
          case 5:
            if (centerAbove) { addSeg(left, top); addSeg(bottom, right); }
            else { addSeg(left, bottom); addSeg(top, right); }
            break;
          case 10:
            if (centerAbove) { addSeg(top, right); addSeg(left, bottom); }
            else { addSeg(left, top); addSeg(bottom, right); }
            break;
        }
      }
    }

    for (let i = 0; i < segs.length; i++) {
      if (segs[i].used) continue;
      segs[i].used = true;
      const chain = [segs[i].p1, segs[i].p2];
      let headKey = segs[i].k1;
      let tailKey = segs[i].k2;

      while (true) {
        const cand = (adj.get(tailKey) || []).find(si => !segs[si].used);
        if (cand === undefined) break;
        segs[cand].used = true;
        if (segs[cand].k1 === tailKey) {
          chain.push(segs[cand].p2);
          tailKey = segs[cand].k2;
        } else {
          chain.push(segs[cand].p1);
          tailKey = segs[cand].k1;
        }
      }

      while (true) {
        const cand = (adj.get(headKey) || []).find(si => !segs[si].used);
        if (cand === undefined) break;
        segs[cand].used = true;
        if (segs[cand].k2 === headKey) {
          chain.unshift(segs[cand].p1);
          headKey = segs[cand].k1;
        } else {
          chain.unshift(segs[cand].p2);
          headKey = segs[cand].k2;
        }
      }

      if (chain.length < 6) continue;
      const simplified = simplifyLine(
        chain.map(([cf, rf]) => gridPointToLngLat(cf, rf, gridMeta)),
        0.0001
      );
      const coords = chaikinSmooth(simplified, 2);
      if (coords.length < 3) continue;
      features.push({
        type: 'Feature',
        properties: { elev: level, major: level % 100 === 0 },
        geometry: { type: 'LineString', coordinates: coords }
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

function segmentsIntersect(a, b, c, d) {
  const ccw = (p1, p2, p3) => (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);
  if (ccw(a, c, d) === ccw(b, c, d) || ccw(a, b, c) === ccw(a, b, d)) return null;
  const a1 = b[1] - a[1], b1 = a[0] - b[0], c1 = a1 * a[0] + b1 * a[1];
  const a2 = d[1] - c[1], b2 = c[0] - d[0], c2 = a2 * c[0] + b2 * c[1];
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-12) return null;
  return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
}

export function detectRoadStreamCrossings(roadFeatures, flowFeatures, clusterMeters = 90) {
  const streamLines = flowFeatures.filter(f => f.properties && f.properties.tier <= 2);
  const rawHits = [];

  for (const road of roadFeatures) {
    const rc = road.geometry && road.geometry.coordinates;
    if (!rc || rc.length < 2) continue;
    for (const stream of streamLines) {
      const sc = stream.geometry && stream.geometry.coordinates;
      if (!sc || sc.length < 2) continue;
      for (let i = 0; i < rc.length - 1; i++) {
        for (let j = 0; j < sc.length - 1; j++) {
          const hit = segmentsIntersect(rc[i], rc[i + 1], sc[j], sc[j + 1]);
          if (hit) {
            rawHits.push({
              coords: hit,
              roadName: (road.properties && road.properties.name) || '',
              highway: (road.properties && road.properties.highway) || 'road',
              tier: stream.properties.tier,
              catchment_ha: stream.properties.catchment_ha
            });
          }
        }
      }
    }
  }

  const clusters = [];
  for (const h of rawHits) {
    let merged = false;
    for (const cl of clusters) {
      if (haversineMeters(h.coords[0], h.coords[1], cl.coords[0], cl.coords[1]) <= clusterMeters) {
        if (h.tier < cl.tier) cl.tier = h.tier;
        if (h.catchment_ha > cl.catchment_ha) cl.catchment_ha = h.catchment_ha;
        if (!cl.roadName && h.roadName) cl.roadName = h.roadName;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ ...h });
  }
  return clusters;
}

// ============================================================================
// SMOOTH ANTI-ALIASED CUTSHEETRX-STYLE RASTER & HAND OVERLAY RENDERERS
// ============================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/**
 * Pure-Node RGBA PNG encoder (zero external image dependencies).
 */
export function encodePngRgba(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 1; // Sub filter compresses smooth gradients very tightly
    const srcOff = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[srcOff + x - 4] : 0;
      raw[rowOff + 1 + x] = (rgba[srcOff + x] - left) & 255;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

export function smoothGrid(grid, width, height, passes = 2) {
  let cur = new Float32Array(grid);
  let next = new Float32Array(grid.length);
  for (let p = 0; p < passes; p++) {
    for (let r = 0; r < height; r++) {
      const r0 = Math.max(0, r - 1);
      const r2 = Math.min(height - 1, r + 1);
      for (let c = 0; c < width; c++) {
        const c0 = Math.max(0, c - 1);
        const c2 = Math.min(width - 1, c + 1);
        const sum =
          cur[r0 * width + c0] + 2 * cur[r0 * width + c] + cur[r0 * width + c2] +
          2 * cur[r * width + c0] + 4 * cur[r * width + c] + 2 * cur[r * width + c2] +
          cur[r2 * width + c0] + 2 * cur[r2 * width + c] + cur[r2 * width + c2];
        next[r * width + c] = sum * 0.0625;
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  return cur;
}

function sampleBilinear(grid, w, h, xf, yf) {
  const x = Math.max(0, Math.min(w - 1.0001, xf));
  const y = Math.max(0, Math.min(h - 1.0001, yf));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const top = grid[y0 * w + x0] * (1 - tx) + grid[y0 * w + x1] * tx;
  const bot = grid[y1 * w + x0] * (1 - tx) + grid[y1 * w + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function lerpColorRamp(stops, val) {
  if (val <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i];
    const [v1, c1] = stops[i + 1];
    if (val <= v1) {
      const f = (val - v0) / Math.max(1e-6, v1 - v0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Renders smooth CutSheetRX-style Terrain PNGs (Relief, Color Elevation + Shading, Smooth Slope)
 * by gently smoothing the raw DEM, upsampling to outSize x outSize, and computing per-pixel hillshade.
 */
export function renderSmoothTerrainRasters(rawElev, slopeGrid, gridMeta, outSize = 1024, insideMask = null) {
  const { width, height, cellSizeX, cellSizeY } = gridMeta;
  const smoothElev = smoothGrid(rawElev, width, height, 2);
  const smoothSlope = smoothGrid(slopeGrid, width, height, 2);

  let minE = Infinity, maxE = -Infinity;
  for (let i = 0; i < smoothElev.length; i++) {
    if (smoothElev[i] < minE) minE = smoothElev[i];
    if (smoothElev[i] > maxE) maxE = smoothElev[i];
  }

  // Build upsampled high-res elevation field for crisp per-pixel hillshading
  const hiElev = new Float32Array(outSize * outSize);
  for (let y = 0; y < outSize; y++) {
    const yf = (y / (outSize - 1)) * (height - 1);
    for (let x = 0; x < outSize; x++) {
      const xf = (x / (outSize - 1)) * (width - 1);
      hiElev[y * outSize + x] = sampleBilinear(smoothElev, width, height, xf, yf);
    }
  }

  const hiCellX = (cellSizeX * width) / outSize;
  const hiCellY = (cellSizeY * height) / outSize;

  const reliefRgba = new Uint8Array(outSize * outSize * 4);
  const elevRgba = new Uint8Array(outSize * outSize * 4);
  const slopeRgba = new Uint8Array(outSize * outSize * 4);

  const elevStops = [
    [0.0, [48, 128, 86]],   // valley emerald green
    [0.25, [132, 184, 96]], // terraced rice fields
    [0.5, [224, 198, 110]], // mid-slope warm ochre
    [0.75, [202, 122, 74]], // steep terracotta
    [1.0, [242, 236, 224]]  // highland ridge pale stone
  ];

  const slopeStops = [
    [15, [245, 196, 66]],   // moderate amber
    [28, [234, 118, 28]],   // steep orange
    [45, [215, 42, 42]]     // critical landslide crimson
  ];

  // Multi-directional hillshade illumination vectors (NW + W)
  const alt = (45 * Math.PI) / 180;
  const az1 = (315 * Math.PI) / 180;
  const az2 = (265 * Math.PI) / 180;
  const lx1 = Math.sin(az1) * Math.cos(alt), ly1 = Math.cos(az1) * Math.cos(alt), lz = Math.sin(alt);
  const lx2 = Math.sin(az2) * Math.cos(alt), ly2 = Math.cos(az2) * Math.cos(alt);

  const zFactor = 1.65;

  for (let y = 0; y < outSize; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(outSize - 1, y + 1);
    const yf = (y / (outSize - 1)) * (height - 1);
    const mr = Math.min(height - 1, Math.floor((y / outSize) * height));
    for (let x = 0; x < outSize; x++) {
      if (insideMask) {
        const mc = Math.min(width - 1, Math.floor((x / outSize) * width));
        if (insideMask[mr * width + mc] === 0) continue;
      }
      const x0 = Math.max(0, x - 1), x1 = Math.min(outSize - 1, x + 1);
      const xf = (x / (outSize - 1)) * (width - 1);

      const dzdx = ((hiElev[y * outSize + x1] - hiElev[y * outSize + x0]) / (2 * hiCellX)) * zFactor;
      const dzdy = ((hiElev[y0 * outSize + x] - hiElev[y1 * outSize + x]) / (2 * hiCellY)) * zFactor;
      const invLen = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const nx = -dzdx * invLen;
      const ny = -dzdy * invLen;
      const nz = invLen;

      const shade1 = Math.max(0, nx * lx1 + ny * ly1 + nz * lz);
      const shade2 = Math.max(0, nx * lx2 + ny * ly2 + nz * lz);
      const shade = 0.7 * shade1 + 0.3 * shade2; // 0..1

      const pIdx = (y * outSize + x) * 4;

      // 1. CutSheetRX Shaded Relief (Gray)
      const gVal = clamp255(42 + shade * 208);
      reliefRgba[pIdx] = gVal;
      reliefRgba[pIdx + 1] = gVal + 2 > 255 ? 255 : gVal + 2;
      reliefRgba[pIdx + 2] = gVal + 1 > 255 ? 255 : gVal + 1;
      reliefRgba[pIdx + 3] = 255;

      // 2. CutSheetRX Color Elevation + Shading
      const eNorm = (hiElev[y * outSize + x] - minE) / Math.max(1, maxE - minE);
      const rgb = lerpColorRamp(elevStops, eNorm);
      const lightMult = 0.56 + shade * 0.62;
      elevRgba[pIdx] = clamp255(rgb[0] * lightMult);
      elevRgba[pIdx + 1] = clamp255(rgb[1] * lightMult);
      elevRgba[pIdx + 2] = clamp255(rgb[2] * lightMult);
      elevRgba[pIdx + 3] = 255;

      // 3. Smooth Slope % Heatmap (transparent on flat ground < 12%)
      const sl = sampleBilinear(smoothSlope, width, height, xf, yf);
      const alphaF = smoothstep(11, 24, sl);
      const sRgb = lerpColorRamp(slopeStops, sl);
      const sLight = 0.72 + shade * 0.36;
      slopeRgba[pIdx] = clamp255(sRgb[0] * sLight);
      slopeRgba[pIdx + 1] = clamp255(sRgb[1] * sLight);
      slopeRgba[pIdx + 2] = clamp255(sRgb[2] * sLight);
      slopeRgba[pIdx + 3] = clamp255(alphaF * 215);
    }
  }

  return {
    reliefPng: encodePngRgba(outSize, outSize, reliefRgba),
    elevPng: encodePngRgba(outSize, outSize, elevRgba),
    slopePng: encodePngRgba(outSize, outSize, slopeRgba)
  };
}

/**
 * Renders 6 smooth anti-aliased HAND flood overlay PNGs (clogged vs cleared across low/med/high)
 * and computes exact matching hectare footprints.
 */
export function renderSmoothHandFloodRasters(
  handGrid,
  slopeGrid,
  bottlenecks,
  gridMeta,
  outSize = 768,
  insideMask = null
) {
  const { width, height, bbox, cellSizeX, cellSizeY } = gridMeta;
  const smoothHand = smoothGrid(handGrid, width, height, 2);
  const smoothSlope = smoothGrid(slopeGrid, width, height, 2);
  const cellHa = (cellSizeX * cellSizeY) / 10000;

  // Precompute per-cell bottleneck proximity on the coarse grid for exact area KPIs
  const nearBottleneckCell = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const [lng, lat] = cellToLngLat(c, r, gridMeta);
      if (bottlenecks.some(b => haversineMeters(lng, lat, b.coords[0], b.coords[1]) <= 220)) {
        nearBottleneckCell[r * width + c] = 1;
      }
    }
  }

  const levels = {
    low: 0.8,
    med: 1.8,
    high: 3.2
  };

  const simAreasHa = {
    clogged: { low: 0, med: 0, high: 0 },
    cleared: { low: 0, med: 0, high: 0 }
  };

  for (const [key, maxH] of Object.entries(levels)) {
    let clogCount = 0;
    let clearCount = 0;
    for (let i = 0; i < handGrid.length; i++) {
      if (insideMask && insideMask[i] === 0) continue;
      if (slopeGrid[i] <= 22 && handGrid[i] <= maxH) {
        clogCount++;
        if (!nearBottleneckCell[i]) clearCount++;
      }
    }
    simAreasHa.clogged[key] = Number((clogCount * cellHa).toFixed(1));
    simAreasHa.cleared[key] = Number((clearCount * cellHa).toFixed(1));
  }

  // Precompute smooth radial clearance field on outSize x outSize for 'cleared' mode
  const clearanceField = new Float32Array(outSize * outSize);
  const dLng = bbox.east - bbox.west;
  const dLat = bbox.north - bbox.south;
  for (let y = 0; y < outSize; y++) {
    const lat = bbox.north - (y / (outSize - 1)) * dLat;
    for (let x = 0; x < outSize; x++) {
      const lng = bbox.west + (x / (outSize - 1)) * dLng;
      let minD = 9999;
      for (let b = 0; b < bottlenecks.length; b++) {
        const bc = bottlenecks[b].coords;
        // Fast equirectangular distance in meters
        const dxM = (lng - bc[0]) * 111320;
        const dyM = (lat - bc[1]) * 110540;
        const d = Math.hypot(dxM, dyM);
        if (d < minD) minD = d;
      }
      clearanceField[y * outSize + x] = smoothstep(130, 290, minD);
    }
  }

  const pngs = {};
  for (const scenario of ['clogged', 'cleared']) {
    for (const [levelName, maxH] of Object.entries(levels)) {
      const rgba = new Uint8Array(outSize * outSize * 4);
      for (let y = 0; y < outSize; y++) {
        const yf = (y / (outSize - 1)) * (height - 1);
        for (let x = 0; x < outSize; x++) {
          const xf = (x / (outSize - 1)) * (width - 1);
          const h = sampleBilinear(smoothHand, width, height, xf, yf);
          const sl = sampleBilinear(smoothSlope, width, height, xf, yf);

          const slopeMask = 1 - smoothstep(16, 24, sl);
          const handMask = 1 - smoothstep(Math.max(0.2, maxH - 0.45), maxH + 0.35, h);
          const clearMask = scenario === 'cleared' ? clearanceField[y * outSize + x] : 1;
          const alpha = slopeMask * handMask * clearMask;
          if (alpha <= 0.01) continue;

          // Calm translucent water-corridor tones (#0369a1 -> #0284c7 -> #7dd3fc)
          let rCol, gCol, bCol;
          if (h <= 0.9) {
            const f = smoothstep(0.2, 0.9, h);
            rCol = 3 * (1 - f) + 2 * f;
            gCol = 105 * (1 - f) + 132 * f;
            bCol = 161 * (1 - f) + 199 * f;
          } else {
            const f = smoothstep(0.9, 3.2, h);
            rCol = 2 * (1 - f) + 125 * f;
            gCol = 132 * (1 - f) + 211 * f;
            bCol = 199 * (1 - f) + 252 * f;
          }

          const pIdx = (y * outSize + x) * 4;
          rgba[pIdx] = clamp255(rCol);
          rgba[pIdx + 1] = clamp255(gCol);
          rgba[pIdx + 2] = clamp255(bCol);
          rgba[pIdx + 3] = clamp255(alpha * 145);
        }
      }
      pngs[`${scenario}-${levelName}`] = encodePngRgba(outSize, outSize, rgba);
    }
  }

  return { pngs, simAreasHa };
}

/**
 * Hydro-condition (stream-burn) verified channels into a copy of the DEM
 * before flow routing and HAND so corrected community channels guide runoff.
 */
export function burnStreamsIntoDem(rawElev, streamFeatures, gridMeta, carveDepthM = 2.5) {
  const { width, height, bbox, cellSizeX, cellSizeY } = gridMeta;
  const burned = new Float32Array(rawElev);
  if (!Array.isArray(streamFeatures) || streamFeatures.length === 0) {
    return { elev: burned, burnedCellCount: 0 };
  }

  const centerMask = new Uint8Array(width * height);
  const shoulderMask = new Uint8Array(width * height);
  const stepM = Math.max(4, Math.min(cellSizeX, cellSizeY) * 0.4);

  const toColRow = (lng, lat) => {
    const c = Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width);
    const r = Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height);
    return [c, r];
  };

  for (const feat of streamFeatures) {
    if (feat?.geometry?.type !== 'LineString') continue;
    const coords = feat.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const segM = haversineMeters(a[0], a[1], b[0], b[1]);
      const steps = Math.max(1, Math.ceil(segM / stepM));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const lng = a[0] + (b[0] - a[0]) * t;
        const lat = a[1] + (b[1] - a[1]) * t;
        const [c, r] = toColRow(lng, lat);
        if (c < 0 || c >= width || r < 0 || r >= height) continue;
        centerMask[r * width + c] = 1;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
            shoulderMask[nr * width + nc] = 1;
          }
        }
      }
    }
  }

  let burnedCellCount = 0;
  for (let i = 0; i < burned.length; i++) {
    if (centerMask[i]) {
      burned[i] -= carveDepthM;
      burnedCellCount++;
    } else if (shoulderMask[i]) {
      burned[i] -= carveDepthM * 0.35;
      burnedCellCount++;
    }
  }

  return { elev: burned, burnedCellCount };
}

export function pointToSegmentMeters(pt, a, b) {
  const cosLat = Math.max(0.1, Math.cos((pt[1] * Math.PI) / 180));
  const mPerDegLng = 111320 * cosLat;
  const mPerDegLat = 110540;

  const px = pt[0] * mPerDegLng;
  const py = pt[1] * mPerDegLat;
  const ax = a[0] * mPerDegLng;
  const ay = a[1] * mPerDegLat;
  const bx = b[0] * mPerDegLng;
  const by = b[1] * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 1e-12) {
    t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  }
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return {
    distM: Math.hypot(px - cx, py - cy),
    closest: [
      Number((a[0] + (b[0] - a[0]) * t).toFixed(6)),
      Number((a[1] + (b[1] - a[1]) * t).toFixed(6))
    ],
    t
  };
}

/**
 * Removes DEM-derived dashed flow segments that mostly run along already-verified
 * waterways (~bufferMeters) so burned channels are not visually duplicated while
 * unmapped uphill tributaries terminating at verified junctions remain intact.
 */
export function filterOverlappingFlowPaths(flowPathsFC, verifiedFeatures, bufferMeters = 48, overlapThreshold = 0.55) {
  if (!Array.isArray(verifiedFeatures) || verifiedFeatures.length === 0) {
    return {
      type: 'FeatureCollection',
      features: flowPathsFC?.features || [],
      filteredCount: 0
    };
  }

  const verifiedLines = verifiedFeatures
    .filter(f => f?.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2)
    .map(f => f.geometry.coordinates);

  if (verifiedLines.length === 0) {
    return {
      type: 'FeatureCollection',
      features: flowPathsFC?.features || [],
      filteredCount: 0
    };
  }

  const minDistToVerified = pt => {
    let best = Infinity;
    for (const line of verifiedLines) {
      for (let i = 0; i < line.length - 1; i++) {
        const hit = pointToSegmentMeters(pt, line[i], line[i + 1]);
        if (hit.distM < best) best = hit.distM;
        if (best <= bufferMeters * 0.4) return best;
      }
    }
    return best;
  };

  const kept = [];
  let filteredCount = 0;

  for (const feat of flowPathsFC?.features || []) {
    const coords = feat?.geometry?.coordinates;
    if (feat?.geometry?.type !== 'LineString' || !Array.isArray(coords) || coords.length < 2) {
      continue;
    }

    const samplePts = [];
    for (let i = 0; i < coords.length; i++) {
      samplePts.push(coords[i]);
      if (i < coords.length - 1) {
        const segLen = haversineMeters(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
        if (segLen > 25) {
          samplePts.push([(coords[i][0] + coords[i + 1][0]) * 0.5, (coords[i][1] + coords[i + 1][1]) * 0.5]);
        }
      }
    }

    let nearCount = 0;
    for (const pt of samplePts) {
      if (minDistToVerified(pt) <= bufferMeters) nearCount++;
    }
    const overlapFraction = samplePts.length > 0 ? nearCount / samplePts.length : 0;

    if (overlapFraction >= overlapThreshold) {
      filteredCount++;
    } else {
      kept.push(feat);
    }
  }

  const snapped = snapFlowPathsToWaterways({ type: 'FeatureCollection', features: kept }, verifiedFeatures);

  return {
    type: 'FeatureCollection',
    features: snapped.features,
    filteredCount,
    snappedCount: snapped.snappedCount
  };
}

/**
 * Snaps disconnected downstream endpoints of DEM runoff segments onto the nearest
 * verified river/stream (or larger downstream DEM channel) so runoff visually and
 * topologically merges into the river network instead of stopping mid-slope.
 */
export function snapFlowPathsToWaterways(
  flowPathsFC,
  verifiedFeatures,
  snapMaxMeters = 120,
  demSnapMaxMeters = 55
) {
  const verifiedLines = (verifiedFeatures || [])
    .filter(f => f?.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2)
    .map(f => f.geometry.coordinates);

  const nearestPointOnLines = (pt, lines) => {
    let distM = Infinity;
    let closest = null;
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const hit = pointToSegmentMeters(pt, line[i], line[i + 1]);
        if (hit.distM < distM) {
          distM = hit.distM;
          closest = hit.closest;
        }
      }
    }
    return { distM, closest };
  };

  const lineLengthM = coords => {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += haversineMeters(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    }
    return total;
  };

  const snappedFeatures = [];
  let snappedCount = 0;

  for (const feat of flowPathsFC?.features || []) {
    const rawCoords = feat?.geometry?.coordinates;
    if (feat?.geometry?.type !== 'LineString' || !Array.isArray(rawCoords) || rawCoords.length < 2) {
      continue;
    }

    let coords = rawCoords.map(c => [c[0], c[1]]);
    let snappedToVerified = false;

    if (verifiedLines.length > 0) {
      // Trim overshooting tails once the flow line enters within 12m of a verified channel
      for (let i = 1; i < coords.length; i++) {
        const hit = nearestPointOnLines(coords[i], verifiedLines);
        if (hit.closest && hit.distM <= 12) {
          coords = coords.slice(0, i + 1);
          if (hit.distM <= 8) {
            coords[coords.length - 1] = hit.closest;
          } else if (hit.distM > 1.5) {
            coords.push(hit.closest);
          }
          snappedToVerified = true;
          break;
        }
      }

      if (!snappedToVerified) {
        const endPt = coords[coords.length - 1];
        const hit = nearestPointOnLines(endPt, verifiedLines);
        if (hit.closest && hit.distM <= snapMaxMeters) {
          if (hit.distM <= 8) {
            coords[coords.length - 1] = hit.closest;
          } else if (hit.distM > 1.5) {
            coords.push(hit.closest);
          }
          snappedToVerified = true;
        }
      }
    }

    snappedFeatures.push({
      ...feat,
      properties: {
        ...feat.properties,
        length_m: Math.round(lineLengthM(coords)),
        ...(snappedToVerified ? { snapped_to_verified: true } : {})
      },
      geometry: {
        type: 'LineString',
        coordinates: coords
      }
    });
  }

  // Second pass: connect remaining dangling DEM tributaries to larger downstream DEM reaches
  for (let idx = 0; idx < snappedFeatures.length; idx++) {
    const feat = snappedFeatures[idx];
    if (feat.properties.snapped_to_verified) {
      snappedCount++;
      continue;
    }
    const coords = feat.geometry.coordinates;
    const endPt = coords[coords.length - 1];
    const selfId = feat.properties.id;
    const selfCatch = Number(feat.properties.catchment_ha || 0);

    const targetLines = [];
    for (let j = 0; j < snappedFeatures.length; j++) {
      if (j === idx) continue;
      const other = snappedFeatures[j];
      if (other.properties.id === selfId) continue;
      if (Number(other.properties.catchment_ha || 0) >= selfCatch) {
        targetLines.push(other.geometry.coordinates);
      }
    }
    if (targetLines.length === 0) continue;

    const hit = nearestPointOnLines(endPt, targetLines);
    if (hit.closest && hit.distM > 2 && hit.distM <= demSnapMaxMeters) {
      if (hit.distM <= 8) {
        coords[coords.length - 1] = hit.closest;
      } else {
        coords.push(hit.closest);
      }
      feat.properties.snapped_to_dem = true;
      feat.properties.length_m = Math.round(lineLengthM(coords));
      snappedCount++;
    }
  }

  return {
    type: 'FeatureCollection',
    features: snappedFeatures,
    snappedCount
  };
}

/**
 * Renders discrete ESA WorldCover 10m land-cover classes into a crisp translucent
 * RGBA PNG overlay suitable for daylight satellite/topographic basemaps.
 */
export function renderLandCoverRaster(lcGrid, lcW, lcH, outSize = 1024, insideMask = null, maskW = 0, maskH = 0) {
  const palette = {
    10: [21, 128, 61, 145],   // Tree cover / Forest
    20: [101, 163, 13, 125],  // Shrubland
    30: [132, 204, 22, 115],  // Grassland
    40: [202, 138, 4, 135],   // Cropland
    50: [185, 28, 28, 145],   // Built-up
    60: [146, 64, 14, 155],   // Bare / sparse vegetation
    80: [2, 132, 199, 175],   // Permanent water bodies
    90: [13, 148, 136, 135]   // Herbaceous wetland
  };

  const rgba = new Uint8Array(outSize * outSize * 4);
  for (let y = 0; y < outSize; y++) {
    const sr = Math.min(lcH - 1, Math.floor((y / outSize) * lcH));
    const mr = insideMask && maskH > 0 ? Math.min(maskH - 1, Math.floor((y / outSize) * maskH)) : 0;
    for (let x = 0; x < outSize; x++) {
      if (insideMask && maskW > 0) {
        const mc = Math.min(maskW - 1, Math.floor((x / outSize) * maskW));
        if (insideMask[mr * maskW + mc] === 0) continue;
      }
      const sc = Math.min(lcW - 1, Math.floor((x / outSize) * lcW));
      const code = lcGrid[sr * lcW + sc];
      const col = palette[code];
      if (!col) continue;
      const pIdx = (y * outSize + x) * 4;
      rgba[pIdx] = col[0];
      rgba[pIdx + 1] = col[1];
      rgba[pIdx + 2] = col[2];
      rgba[pIdx + 3] = col[3];
    }
  }
  return encodePngRgba(outSize, outSize, rgba);
}

export function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygonRings(pt, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return false;
  if (!pointInRing(pt, coordinates[0])) return false;
  for (let k = 1; k < coordinates.length; k++) {
    if (pointInRing(pt, coordinates[k])) return false;
  }
  return true;
}

function findPolygonFeatureAt(pt, collection) {
  const feats = collection?.features || [];
  for (let i = 0; i < feats.length; i++) {
    const geom = feats[i]?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && pointInPolygonRings(pt, geom.coordinates)) return feats[i];
    if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (pointInPolygonRings(pt, poly)) return feats[i];
      }
    }
  }
  return null;
}

export function isPointInFeatureCollection(pt, fc) {
  return findPolygonFeatureAt(pt, fc) !== null;
}

export function buildPolygonMaskGrid(fc, gridMeta) {
  const { width, height } = gridMeta;
  const mask = new Uint8Array(width * height);
  if (!fc?.features?.length) {
    mask.fill(1);
    return mask;
  }
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const pt = cellToLngLat(c, r, gridMeta);
      mask[r * width + c] = findPolygonFeatureAt(pt, fc) ? 1 : 0;
    }
  }
  return mask;
}

export function computeFeatureCollectionAreaKm2(fc) {
  const ringAreaM2 = ring => {
    if (!ring || ring.length < 3) return 0;
    let sumLat = 0;
    for (let i = 0; i < ring.length; i++) sumLat += ring[i][1];
    const midLat = (sumLat / ring.length) * (Math.PI / 180);
    const mLat = 111132.95;
    const mLon = 111319.49 * Math.cos(midLat);
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * mLon * (ring[i + 1][1] * mLat) - ring[i + 1][0] * mLon * (ring[i][1] * mLat);
    }
    return Math.abs(area) * 0.5;
  };
  let totalM2 = 0;
  for (const feat of fc?.features || []) {
    const geom = feat?.geometry;
    if (!geom) continue;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : [];
    for (const rings of polys) {
      if (!rings.length) continue;
      totalM2 += ringAreaM2(rings[0]);
      for (let k = 1; k < rings.length; k++) totalM2 -= ringAreaM2(rings[k]);
    }
  }
  return Number((totalM2 / 1e6).toFixed(2));
}

/**
 * Rasterizes Pemkab Agam official soil erodibility, landslide susceptibility, and SK 35 forest
 * zone coverage onto the DEM grid (scoped to insideMask if provided).
 */
export function rasterizeAgamGrids(agamContext, gridMeta, insideMask = null) {
  const { width, height } = gridMeta;
  const n = width * height;
  const soilErodibility = new Uint8Array(n);
  const officialLandslide = new Uint8Array(n);

  let insideCount = 0;
  let andosolCount = 0;
  let highCount = 0;
  let medCount = 0;
  let lowCount = 0;
  let hlCount = 0;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const pt = cellToLngLat(c, r, gridMeta);
      const isInside = !insideMask || insideMask[i] === 1;
      if (isInside) insideCount++;

      const soilFeat = findPolygonFeatureAt(pt, agamContext?.soil);
      const soilName = String(soilFeat?.properties?.soilType || '').toLowerCase();
      if (soilName.includes('andosol')) {
        soilErodibility[i] = 220;
        if (isInside) andosolCount++;
      } else if (soilName.includes('kambisol')) {
        soilErodibility[i] = 165;
      } else {
        soilErodibility[i] = 150;
      }

      const lsFeat = findPolygonFeatureAt(pt, agamContext?.landslideHazard);
      const lsLevel = String(lsFeat?.properties?.level || '').toLowerCase();
      if (lsLevel === 'tinggi' || lsLevel === 'high') {
        officialLandslide[i] = 3;
        if (isInside) highCount++;
      } else if (lsLevel === 'sedang' || lsLevel === 'medium') {
        officialLandslide[i] = 2;
        if (isInside) medCount++;
      } else if (lsLevel === 'rendah' || lsLevel === 'low') {
        officialLandslide[i] = 1;
        if (isInside) lowCount++;
      }

      if (isInside) {
        const forestFeat = findPolygonFeatureAt(pt, agamContext?.forestStatus);
        const fn = String(forestFeat?.properties?.fungsi || '').toUpperCase();
        if (fn === 'HL' || fn.includes('KSA')) {
          hlCount++;
        }
      }
    }
  }

  const denom = Math.max(1, insideCount);
  return {
    soilErodibility,
    officialLandslide,
    summary: {
      andosolPct: Number(((andosolCount / denom) * 100).toFixed(1)),
      officialHighPct: Number(((highCount / denom) * 100).toFixed(1)),
      officialMedPct: Number(((medCount / denom) * 100).toFixed(1)),
      officialLowPct: Number(((lowCount / denom) * 100).toFixed(1)),
      hutanLindungPct: Number(((hlCount / denom) * 100).toFixed(1))
    }
  };
}

/**
 * Computes compact, deterministic raster fields for real-time physical galodo
 * cascade simulation (SCS-CN, D8 travel time, upland catchment ratio, root cohesion,
 * and road-crossing bottleneck proximity).
 */
export function computeCascadeFields({
  rawElev,
  filled,
  dir,
  acc,
  slope,
  hand,
  landCoverClasses = null,
  soilErodibility = null,
  officialLandslide = null,
  nagariMask = null,
  agamSummary = null,
  bottlenecks = [],
  gridMeta,
  maxSimDim = 260
}) {
  const { width, height, bbox, cellSizeX, cellSizeY } = gridMeta;
  const n = width * height;
  const areaScale = (30.9 * 30.9) / Math.max(1, cellSizeX * cellSizeY);

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 0; i < n; i++) {
    if (rawElev[i] < minElev) minElev = rawElev[i];
    if (rawElev[i] > maxElev) maxElev = rawElev[i];
  }
  const elevSpan = Math.max(1, maxElev - minElev);

  const handDm = new Uint16Array(n);
  const slopePct = new Uint8Array(n);
  const accNorm = new Uint8Array(n);
  const cnBase = new Uint8Array(n);
  const rootCohesion = new Uint8Array(n);
  const isForest = new Uint8Array(n);
  const uplandWeight = new Uint8Array(n);
  const vel = new Float32Array(n);

  for (let r = 0; r < height; r++) {
    const southFactor = r / Math.max(1, height - 1); // 1.0 at southern Singgalang slopes
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      handDm[i] = Math.min(65535, Math.round(Math.max(0, hand[i]) * 10));
      const sl = Math.max(0, slope[i]);
      slopePct[i] = Math.min(200, Math.round(sl));
      const accEquiv = acc[i] / areaScale;
      accNorm[i] = Math.min(255, Math.round((Math.log10(Math.max(1, accEquiv)) / 4.2) * 255));

      const lc = landCoverClasses ? landCoverClasses[i] : 0;
      let cn = 74;
      let root = 150;
      let forest = 0;
      if (lc === 10) {
        cn = 70;
        root = 220;
        forest = 1;
      } else if (lc === 20 || lc === 30) {
        cn = 77;
        root = 135;
      } else if (lc === 40) {
        cn = 82;
        root = 95;
      } else if (lc === 50) {
        cn = 92;
        root = 50;
      } else if (lc === 60) {
        cn = 89;
        root = 50;
      } else if (lc === 80 || lc === 90) {
        cn = 98;
        root = 80;
      }
      if (soilErodibility && soilErodibility[i] >= 200) {
        cn = Math.max(60, cn - 2);
      }
      cnBase[i] = cn;
      rootCohesion[i] = root;
      isForest[i] = forest;

      const elevNorm = (rawElev[i] - minElev) / elevSpan;
      const uw = Math.max(0, Math.min(1, elevNorm * 0.75 + southFactor * 0.25));
      uplandWeight[i] = Math.round(uw * 255);

      const sRad = Math.max(0.012, sl / 100);
      const rough = forest ? 1.35 : 0.95;
      if (accEquiv >= 25) {
        vel[i] = Math.max(0.45, Math.min(3.8, (0.65 * Math.sqrt(sRad) * Math.pow(accEquiv, 0.14)) / rough));
      } else {
        vel[i] = Math.max(0.12, Math.min(1.35, (0.24 * Math.sqrt(sRad)) / rough));
      }
    }
  }

  // Topological sort from highest filled elevation to lowest for upstream->downstream accumulation
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => filled[b] - filled[a]);

  const diag = Math.hypot(cellSizeX, cellSizeY);
  const stepDist = [cellSizeX, diag, cellSizeY, diag, cellSizeX, diag, cellSizeY, diag];

  const uplandSum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    uplandSum[i] = uplandWeight[i] >= 128 ? 1 : 0;
  }
  const weightedTime = new Float64Array(n);
  const inWeight = new Float64Array(n);
  const tcArr = new Float32Array(n);

  for (let p = 0; p < n; p++) {
    const i = order[p];
    const tc = inWeight[i] > 0 ? weightedTime[i] / inWeight[i] : 0;
    tcArr[i] = tc;

    const k = dir[i];
    if (k < 0) continue;
    const r = Math.floor(i / width);
    const c = i - r * width;
    const ni = (r + DY[k]) * width + (c + DX[k]);
    if (ni < 0 || ni >= n) continue;

    uplandSum[ni] += uplandSum[i];
    const dtMin = (stepDist[k] / vel[i]) / 60;
    const w = Math.max(1, acc[i]);
    weightedTime[ni] += w * (tc + dtMin);
    inWeight[ni] += w;
  }

  const uplandAccRatio = new Uint8Array(n);
  const travelTimeTenthMin = new Uint16Array(n);
  const channelTcs = [];
  for (let i = 0; i < n; i++) {
    uplandAccRatio[i] = Math.min(255, Math.round((uplandSum[i] / Math.max(1, acc[i])) * 255));
    travelTimeTenthMin[i] = Math.min(65535, Math.round(tcArr[i] * 10));
    if (acc[i] / areaScale >= 75) channelTcs.push(tcArr[i]);
  }

  channelTcs.sort((a, b) => a - b);
  const p90TravelMin =
    channelTcs.length > 0
      ? channelTcs[Math.min(channelTcs.length - 1, Math.floor(channelTcs.length * 0.9))]
      : 25;

  const needSimDownsample = maxSimDim > 0 && (width > maxSimDim || height > maxSimDim);
  const simScale = needSimDownsample ? Math.max(width, height) / maxSimDim : 1;
  const simW = needSimDownsample ? Math.round(width / simScale) : width;
  const simH = needSimDownsample ? Math.round(height / simScale) : height;
  const simCellX = (cellSizeX * width) / simW;
  const simCellY = (cellSizeY * height) / simH;
  const simMeta = { width: simW, height: simH, bbox, cellSizeX: simCellX, cellSizeY: simCellY };

  const resampleArr = (arr, Ctor) => {
    if (!arr || !needSimDownsample) return arr;
    const out = new Ctor(simW * simH);
    for (let r = 0; r < simH; r++) {
      const sr = Math.min(height - 1, Math.floor(((r + 0.5) / simH) * height));
      for (let c = 0; c < simW; c++) {
        const sc = Math.min(width - 1, Math.floor(((c + 0.5) / simW) * width));
        out[r * simW + c] = arr[sr * width + sc];
      }
    }
    return out;
  };

  const bottleneckPts = (bottlenecks || [])
    .map(b => b?.coords || b?.geometry?.coordinates)
    .filter(c => Array.isArray(c) && c.length >= 2);
  const bottleneckProx = new Uint8Array(simW * simH);
  if (bottleneckPts.length > 0) {
    for (let r = 0; r < simH; r++) {
      for (let c = 0; c < simW; c++) {
        const i = r * simW + c;
        const [lng, lat] = cellToLngLat(c, r, simMeta);
        let minD = 9999;
        for (let b = 0; b < bottleneckPts.length; b++) {
          if (Math.abs(lng - bottleneckPts[b][0]) > 0.003 || Math.abs(lat - bottleneckPts[b][1]) > 0.003) continue;
          const d = haversineMeters(lng, lat, bottleneckPts[b][0], bottleneckPts[b][1]);
          if (d < minD) minD = d;
        }
        const prox = 1 - smoothstep(40, 260, minD);
        bottleneckProx[i] = Math.round(prox * 255);
      }
    }
  }

  const outHandDm = resampleArr(handDm, Uint16Array);
  const outSlopePct = resampleArr(slopePct, Uint8Array);
  const outAccNorm = resampleArr(accNorm, Uint8Array);
  const outTravelTime = resampleArr(travelTimeTenthMin, Uint16Array);
  const outCnBase = resampleArr(cnBase, Uint8Array);
  const outRootCohesion = resampleArr(rootCohesion, Uint8Array);
  const outIsForest = resampleArr(isForest, Uint8Array);
  const outUplandWeight = resampleArr(uplandWeight, Uint8Array);
  const outUplandAccRatio = resampleArr(uplandAccRatio, Uint8Array);
  const outSoil = resampleArr(soilErodibility, Uint8Array);
  const outLandslide = resampleArr(officialLandslide, Uint8Array);
  const outNagariMask = resampleArr(nagariMask, Uint8Array);

  const toB64 = arr => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');

  return {
    width: simW,
    height: simH,
    bbox,
    cellSizeX: Number(simCellX.toFixed(2)),
    cellSizeY: Number(simCellY.toFixed(2)),
    minElev: Math.round(minElev),
    maxElev: Math.round(maxElev),
    p90TravelMin: Number(Math.max(12, p90TravelMin).toFixed(1)),
    handDmBase64: toB64(outHandDm),
    slopePctBase64: toB64(outSlopePct),
    accNormBase64: toB64(outAccNorm),
    travelTimeTenthMinBase64: toB64(outTravelTime),
    cnBaseBase64: toB64(outCnBase),
    rootCohesionBase64: toB64(outRootCohesion),
    isForestBase64: toB64(outIsForest),
    uplandWeightBase64: toB64(outUplandWeight),
    uplandAccRatioBase64: toB64(outUplandAccRatio),
    bottleneckProxBase64: toB64(bottleneckProx),
    ...(outSoil ? { soilErodibilityBase64: toB64(outSoil) } : {}),
    ...(outLandslide ? { officialLandslideBase64: toB64(outLandslide) } : {}),
    ...(outNagariMask ? { nagariMaskBase64: toB64(outNagariMask) } : {}),
    ...(agamSummary ? { agamSummary } : {})
  };
}

/**
 * Renders 10m Sentinel-2 pre-vs-post disaster NDVI loss (scour / bare bank corridor)
 * into a crisp translucent RGBA PNG overlay.
 */
export function renderScourChangeRaster(dNdviGrid, w, h, outSize = 1024) {
  const rgba = new Uint8Array(outSize * outSize * 4);
  for (let y = 0; y < outSize; y++) {
    const sr = Math.min(h - 1, Math.floor((y / outSize) * h));
    for (let x = 0; x < outSize; x++) {
      const sc = Math.min(w - 1, Math.floor((x / outSize) * w));
      const v = dNdviGrid[sr * w + sc];
      if (v > -0.2) continue;
      const pIdx = (y * outSize + x) * 4;
      if (v <= -0.32) {
        // Severe bare-earth / galodo scouring corridor (#991b1b)
        rgba[pIdx] = 153;
        rgba[pIdx + 1] = 27;
        rgba[pIdx + 2] = 27;
        rgba[pIdx + 3] = 195;
      } else {
        // Moderate vegetation/bank disturbance (#d97706)
        rgba[pIdx] = 217;
        rgba[pIdx + 1] = 119;
        rgba[pIdx + 2] = 6;
        rgba[pIdx + 3] = 155;
      }
    }
  }
  return encodePngRgba(outSize, outSize, rgba);
}
