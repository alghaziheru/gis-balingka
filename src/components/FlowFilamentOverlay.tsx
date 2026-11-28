import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { PlaybackHydroGrids } from '../hooks/useSimulationController';
import type { CascadeEngine } from '../lib/cascadeEngine';
import type { FlowCorridor } from '../lib/flowRibbons';
import type {
  DebrisCouplingMode,
  DrainCondition,
  GeoFeatureCollection,
  RainPattern,
  SimMapViewMode,
  SoilMoisture
} from '../types/gis';

interface FlowFilamentOverlayProps {
  active: boolean;
  playing: boolean;
  playbackSpeed: number;
  mapRef: MutableRefObject<MapLibreMap | null>;
  corridors: FlowCorridor[];
  nagariBoundary?: GeoFeatureCollection | null;
  rainMmHr: number;
  liveRainMmHr: number;
  durationMin: number;
  progress: number;
  elapsedMin?: number;
  drainCondition: DrainCondition;
  debrisCoupling: DebrisCouplingMode;
  meanSedimentCv: number;
  isRecession: boolean;
  rainPattern: RainPattern;
  soilMoisture: SoilMoisture;
  simMapViewMode?: SimMapViewMode;
  cascadeEngine: CascadeEngine | null;
  playbackGridsRef?: MutableRefObject<PlaybackHydroGrids>;
}

interface PoolPathCache {
  version: number;
  yardPath: Path2D | null;
  kneePath: Path2D | null;
  deepPath: Path2D | null;
  landslidePath: Path2D | null;
  runoutPath: Path2D | null;
  dirty: boolean;
}

function buildProjectedRingsPath(map: MapLibreMap, rings: [number, number][][]): Path2D | null {
  if (!rings || rings.length === 0) return null;
  const path = new Path2D();
  let hasRing = false;
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    if (!ring || ring.length < 3) continue;
    for (let j = 0; j < ring.length; j++) {
      const pt = map.project([ring[j][0], ring[j][1]]);
      if (j === 0) path.moveTo(pt.x, pt.y);
      else path.lineTo(pt.x, pt.y);
    }
    path.closePath();
    hasRing = true;
  }
  return hasRing ? path : null;
}

interface ProjectedCorridor {
  corridor: FlowCorridor;
  sx: Float32Array;
  sy: Float32Array;
  nxUnit: Float32Array;
  nyUnit: Float32Array;
  hydroCellIdx: Int32Array;
  inViewport: boolean;
}

interface ProjectionCache {
  corridors: ProjectedCorridor[];
  clipPolys: [number, number][][];
  pxPerM: number;
  dirty: boolean;
}

function strandHash(seed: number, strand: number, salt: number): number {
  const x = Math.sin((seed & 0xffff) * 12.9898 + (strand + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

function blendRgb(
  base: [number, number, number],
  sediment: [number, number, number],
  mix: number
): string {
  const r = Math.round(base[0] * (1 - mix) + sediment[0] * mix);
  const g = Math.round(base[1] * (1 - mix) + sediment[1] * mix);
  const b = Math.round(base[2] * (1 - mix) + sediment[2] * mix);
  return `${r}, ${g}, ${b}`;
}

function computeTargetFlowState(st: {
  rainMmHr: number;
  liveRainMmHr: number;
  isRecession: boolean;
  drainCondition: DrainCondition;
}): { targetRainNorm: number; targetSpeedMult: number } {
  const effectiveRain = st.isRecession ? st.rainMmHr * 0.4 : Math.max(st.rainMmHr * 0.45, st.liveRainMmHr);
  const targetRainNorm = Math.max(0.12, Math.min(1, effectiveRain / 60));
  const recessionDamp = st.isRecession ? 0.58 : 1.0;
  const drainFactor = st.drainCondition === 'cleared' ? 1.12 : 0.94;
  const targetSpeedMult = (0.6 + targetRainNorm * 0.85) * recessionDamp * drainFactor;
  return { targetRainNorm, targetSpeedMult };
}

function getVisualSpeedFactor(playbackSpeed: number): number {
  if (playbackSpeed <= 1) return Math.max(0.65, 0.5 + playbackSpeed * 0.5);
  return Math.min(1.9, 1 + Math.log2(playbackSpeed) * 0.225);
}

export function FlowFilamentOverlay({
  active,
  playing,
  playbackSpeed,
  mapRef,
  corridors,
  nagariBoundary = null,
  rainMmHr,
  liveRainMmHr,
  durationMin,
  progress,
  elapsedMin,
  drainCondition,
  debrisCoupling,
  meanSedimentCv,
  isRecession,
  rainPattern,
  soilMoisture,
  simMapViewMode = 'depth',
  cascadeEngine,
  playbackGridsRef
}: FlowFilamentOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simClockSecRef = useRef(0.8);
  const flowPhaseRef = useRef(0.8);
  const smoothedRainNormRef = useRef(0.25);
  const smoothedSpeedMultRef = useRef(0.8);
  const projCacheRef = useRef<ProjectionCache>({ corridors: [], clipPolys: [], pxPerM: 0.35, dirty: true });
  const poolProjRef = useRef<PoolPathCache>({
    version: -1,
    yardPath: null,
    kneePath: null,
    deepPath: null,
    landslidePath: null,
    runoutPath: null,
    dirty: true
  });
  const drawFrameRef = useRef<(() => void) | null>(null);
  const ensureLoopRef = useRef<(() => void) | null>(null);

  const propsRef = useRef({
    active,
    playing,
    playbackSpeed,
    corridors,
    nagariBoundary,
    rainMmHr,
    liveRainMmHr,
    durationMin,
    progress,
    elapsedMin,
    drainCondition,
    debrisCoupling,
    meanSedimentCv,
    isRecession,
    rainPattern,
    soilMoisture,
    simMapViewMode,
    cascadeEngine,
    playbackGridsRef
  });
  propsRef.current = {
    active,
    playing,
    playbackSpeed,
    corridors,
    nagariBoundary,
    rainMmHr,
    liveRainMmHr,
    durationMin,
    progress,
    elapsedMin,
    drainCondition,
    debrisCoupling,
    meanSedimentCv,
    isRecession,
    rainPattern,
    soilMoisture,
    simMapViewMode,
    cascadeEngine,
    playbackGridsRef
  };

  // Invalidate screen-space cache whenever corridor geometry, Nagari boundary, or hydrology grid changes
  useEffect(() => {
    projCacheRef.current.dirty = true;
    poolProjRef.current.dirty = true;
  }, [corridors, nagariBoundary, cascadeEngine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas || !map || !active) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;

    const rebuildProjectionCache = () => {
      const st = propsRef.current;
      const bounds = map.getBounds();
      const vWest = bounds.getWest();
      const vEast = bounds.getEast();
      const vSouth = bounds.getSouth();
      const vNorth = bounds.getNorth();
      const center = map.getCenter();
      const pCenter = map.project(center);
      const pOneMeterLng = map.project([center.lng + 1 / 111320, center.lat]);
      const pxPerM = Math.max(0.05, Math.hypot(pOneMeterLng.x - pCenter.x, pOneMeterLng.y - pCenter.y));

      const fields = st.cascadeEngine?.fields ?? null;
      const fW = fields ? fields.width : 0;
      const fH = fields ? fields.height : 0;
      const fBbox = fields ? fields.bbox : null;
      const invLonSpan = fBbox ? fW / Math.max(1e-6, fBbox.east - fBbox.west) : 0;
      const invLatSpan = fBbox ? fH / Math.max(1e-6, fBbox.north - fBbox.south) : 0;

      const projectedCorridors: ProjectedCorridor[] = [];
      for (let ci = 0; ci < st.corridors.length; ci++) {
        const cor = st.corridors[ci];
        const inViewport = !(
          cor.bbox.east < vWest ||
          cor.bbox.west > vEast ||
          cor.bbox.north < vSouth ||
          cor.bbox.south > vNorth
        );
        const n = cor.coords.length;
        const sx = new Float32Array(n);
        const sy = new Float32Array(n);
        const nxUnit = new Float32Array(n);
        const nyUnit = new Float32Array(n);
        const hydroCellIdx = new Int32Array(n);
        hydroCellIdx.fill(-1);

        if (inViewport) {
          for (let i = 0; i < n; i++) {
            const lng = cor.coords[i][0];
            const lat = cor.coords[i][1];
            const p = map.project([lng, lat]);
            sx[i] = p.x;
            sy[i] = p.y;
            if (fBbox && lng >= fBbox.west && lng <= fBbox.east && lat >= fBbox.south && lat <= fBbox.north) {
              const col = Math.max(0, Math.min(fW - 1, Math.floor((lng - fBbox.west) * invLonSpan)));
              const row = Math.max(0, Math.min(fH - 1, Math.floor((fBbox.north - lat) * invLatSpan)));
              hydroCellIdx[i] = row * fW + col;
            }
          }

          // Compute smoothed screen-space unit normals (5-point chord + Laplacian pass) to prevent sharp bend spikes
          const rawNx = new Float32Array(n);
          const rawNy = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const prev = Math.max(0, i - 2);
            const next = Math.min(n - 1, i + 2);
            const tx = sx[next] - sx[prev];
            const ty = sy[next] - sy[prev];
            const tLen = Math.hypot(tx, ty) || 1;
            rawNx[i] = -ty / tLen;
            rawNy[i] = tx / tLen;
          }
          for (let i = 0; i < n; i++) {
            const pm = Math.max(0, i - 1);
            const nm = Math.min(n - 1, i + 1);
            const mx = rawNx[pm] * 0.25 + rawNx[i] * 0.5 + rawNx[nm] * 0.25;
            const my = rawNy[pm] * 0.25 + rawNy[i] * 0.5 + rawNy[nm] * 0.25;
            const mLen = Math.hypot(mx, my) || 1;
            nxUnit[i] = mx / mLen;
            nyUnit[i] = my / mLen;
          }
        }
        projectedCorridors.push({ corridor: cor, sx, sy, nxUnit, nyUnit, hydroCellIdx, inViewport });
      }

      const clipPolys: [number, number][][] = [];
      const boundary = st.nagariBoundary;
      if (boundary?.features?.length) {
        for (const feat of boundary.features) {
          const geom = feat.geometry as unknown as { type?: string; coordinates?: unknown } | null;
          if (!geom) continue;
          const polys: [number, number][][][] =
            geom.type === 'Polygon'
              ? [geom.coordinates as [number, number][][]]
              : geom.type === 'MultiPolygon'
                ? (geom.coordinates as [number, number][][][])
                : [];
          for (const rings of polys) {
            for (const ring of rings) {
              if (!ring || ring.length < 3) continue;
              const pts: [number, number][] = new Array(ring.length);
              for (let ri = 0; ri < ring.length; ri++) {
                const pt = map.project([ring[ri][0], ring[ri][1]]);
                pts[ri] = [pt.x, pt.y];
              }
              clipPolys.push(pts);
            }
          }
        }
      }

      projCacheRef.current = { corridors: projectedCorridors, clipPolys, pxPerM, dirty: false };
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      projCacheRef.current.dirty = true;
      poolProjRef.current.dirty = true;
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const drawFrame = () => {
      const st = propsRef.current;
      ctx.clearRect(0, 0, width, height);
      if (!st.active || st.progress <= 0.02 || st.rainMmHr <= 0) return;

      if (projCacheRef.current.dirty) {
        rebuildProjectionCache();
      }
      const cache = projCacheRef.current;

      const elapsedSec = reducedMotion ? 1.8 : simClockSecRef.current;
      const flowPhase = reducedMotion ? 1.8 : flowPhaseRef.current;
      const isMobile = width < 768;
      if (!st.playing || reducedMotion) {
        const { targetRainNorm, targetSpeedMult } = computeTargetFlowState(st);
        smoothedRainNormRef.current = targetRainNorm;
        smoothedSpeedMultRef.current = targetSpeedMult;
      }
      const rainNorm = smoothedRainNormRef.current;
      const safeDurMin = Math.max(15, st.durationMin);
      const activeElapsedMin = st.elapsedMin ?? safeDurMin * st.progress;
      const stormFrac = Math.min(1, activeElapsedMin / safeDurMin);
      const maxTier = stormFrac >= 0.3 || st.rainMmHr >= 30 || st.durationMin >= 720 ? 2 : 1;

      const refTravel = st.cascadeEngine ? Math.max(18, st.cascadeEngine.fields.p90TravelMin) : 75;
      const waveFrontMin = Math.max(activeElapsedMin, stormFrac * refTravel * 1.32);
      const isClogged = st.drainCondition !== 'cleared';

      const sedimentMix = Math.min(
        0.48,
        Math.max(0, (st.meanSedimentCv - 0.025) * 3.6) +
          (st.debrisCoupling === 'surge' ? 0.24 : st.debrisCoupling === 'coupled' ? 0.14 : 0)
      );

      let hasClip = false;
      if (cache.clipPolys.length > 0) {
        ctx.save();
        ctx.beginPath();
        for (let pi = 0; pi < cache.clipPolys.length; pi++) {
          const ring = cache.clipPolys[pi];
          for (let ri = 0; ri < ring.length; ri++) {
            if (ri === 0) ctx.moveTo(ring[ri][0], ring[ri][1]);
            else ctx.lineTo(ring[ri][0], ring[ri][1]);
          }
          ctx.closePath();
          hasClip = true;
        }
        if (hasClip) ctx.clip('evenodd');
        else ctx.restore();
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const engine = st.cascadeEngine;
      const workerGrids = st.playbackGridsRef?.current;
      const depthGrid = workerGrids?.depthGrid ?? (engine ? engine.getFloodDepthGrid() : null);
      const tcGrid = engine ? engine.getTravelTimeTenthMin() : null;
      const bProxGrid = engine ? engine.getBottleneckProx() : null;
      const runoffGrid = workerGrids?.runoffGrid ?? (engine ? engine.getRunoffMmGrid() : null);
      const pxPerM = cache.pxPerM;

      // Render live off-thread 3-tier flood ponds & steep saturated slope zones directly below flow filaments
      if (st.playing && workerGrids?.pools) {
        const poolCache = poolProjRef.current;
        if (poolCache.dirty || poolCache.version !== workerGrids.poolsVersion) {
          poolCache.yardPath = buildProjectedRingsPath(map, workerGrids.pools.yard);
          poolCache.kneePath = buildProjectedRingsPath(map, workerGrids.pools.knee);
          poolCache.deepPath = buildProjectedRingsPath(map, workerGrids.pools.deep);
          poolCache.landslidePath = buildProjectedRingsPath(map, workerGrids.pools.landslide);
          poolCache.runoutPath = buildProjectedRingsPath(map, workerGrids.pools.runout);
          poolCache.version = workerGrids.poolsVersion;
          poolCache.dirty = false;
        }

        if (st.simMapViewMode !== 'survey') {
          if (poolCache.runoutPath) {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
            ctx.fill(poolCache.runoutPath);
          }
          if (poolCache.landslidePath) {
            ctx.fillStyle = 'rgba(234, 88, 12, 0.34)';
            ctx.fill(poolCache.landslidePath);
          }
        }

        if (st.simMapViewMode === 'depth') {
          const turb = Math.min(
            0.42,
            Math.max(0, (st.meanSedimentCv - 0.025) * 3.2) +
              (st.debrisCoupling === 'surge' ? 0.22 : st.debrisCoupling === 'coupled' ? 0.12 : 0)
          );
          const yardRgb = blendRgb([125, 211, 252], [132, 108, 84], turb);
          const kneeRgb = blendRgb([56, 189, 248], [132, 108, 84], turb);
          const deepRgb = blendRgb([3, 105, 161], [132, 108, 84], turb);

          if (poolCache.yardPath) {
            ctx.fillStyle = `rgba(${yardRgb}, 0.28)`;
            ctx.fill(poolCache.yardPath);
            ctx.setLineDash([3, 2]);
            ctx.lineWidth = 1.0;
            ctx.strokeStyle = 'rgba(2, 132, 199, 0.55)';
            ctx.stroke(poolCache.yardPath);
            ctx.setLineDash([]);
          }
          if (poolCache.kneePath) {
            ctx.fillStyle = `rgba(${kneeRgb}, 0.34)`;
            ctx.fill(poolCache.kneePath);
            ctx.lineWidth = 1.05;
            ctx.strokeStyle = 'rgba(3, 105, 161, 0.60)';
            ctx.stroke(poolCache.kneePath);
          }
          if (poolCache.deepPath) {
            ctx.fillStyle = `rgba(${deepRgb}, 0.44)`;
            ctx.fill(poolCache.deepPath);
          }
        }
      }

      // Batch all filaments into 7 Path2D buckets total (~7 strokes/frame vs >1,400)
      const bedGlowPath = new Path2D();
      const tailPath = new Path2D();
      const midOuterPath = new Path2D();
      const midCorePath = new Path2D();
      const headOuterPath = new Path2D();
      const headCorePath = new Path2D();
      const ringPath = new Path2D();
      let hasBedGlow = false;
      let hasTail = false;
      let hasMidOuter = false;
      let hasMidCore = false;
      let hasHeadOuter = false;
      let hasHeadCore = false;
      let hasRings = false;

      const drawnBackwaterRings: [number, number][] = [];
      const steps = 10;
      const idx1 = 3;
      const idx2 = 7;
      const ptsX = new Float32Array(steps + 1);
      const ptsY = new Float32Array(steps + 1);

      for (let ci = 0; ci < cache.corridors.length; ci++) {
        const pc = cache.corridors[ci];
        if (!pc.inViewport) continue;
        const cor = pc.corridor;
        if (cor.tier > maxTier) continue;

        const isMainVerified = cor.kind === 'verified_river' || cor.kind === 'verified_channel';
        const rawStrands = isMainVerified
          ? Math.max(5, Math.min(11, Math.round(cor.strandCount * 1.35)))
          : Math.max(3, Math.round(cor.strandCount * 1.15));
        const strands = isMobile ? Math.max(2, Math.round(rawStrands * 0.7)) : rawStrands;
        const baseCycle = Math.max(95, Math.min(195, cor.totalLengthM * 0.4));
        const baseDashLen = Math.min(baseCycle * 0.72, 34 + rainNorm * 28);
        const baseSpeed = cor.speedMps;
        const maxLatPx = isMainVerified ? 5.2 : 2.4;

        const cumDistM = cor.cumDistM;
        const nVerts = cumDistM.length;
        const corSx = pc.sx;
        const corSy = pc.sy;
        const corNxU = pc.nxUnit;
        const corNyU = pc.nyUnit;
        const corHydroIdx = pc.hydroCellIdx;

        for (let s = 0; s < strands; s++) {
          const h1 = strandHash(cor.seed, s, 1);
          const h2 = strandHash(cor.seed, s, 2);
          const h3 = strandHash(cor.seed, s, 3);

          const rawNorm = strands > 1 ? (s / (strands - 1)) * 2 - 1 : 0;
          const centerDist = Math.abs(rawNorm);
          const weightedNorm = Math.sign(rawNorm) * Math.pow(centerDist, 1.28) + (h1 - 0.5) * 0.14;
          const isCenterCore = centerDist <= 0.45;
          const isMidStrand = s === Math.floor(strands / 2);

          const velFactor = isCenterCore ? 1.12 + h2 * 0.14 : 0.8 + h2 * 0.14;
          const dashCycle = baseCycle * (0.72 + h3 * 0.56);
          const dashLen = Math.min(dashCycle * 0.78, baseDashLen * (0.55 + h1 * 0.9));
          const phaseShift = h2 * dashCycle * 2.3;
          const strandSpeed = baseSpeed * velFactor;
          const travel = (flowPhase * strandSpeed + phaseShift) % dashCycle;

          let segCursor = 0;

          for (let baseD = -dashCycle + travel; baseD < cor.totalLengthM; baseD += dashCycle) {
            const d0 = Math.max(0, baseD);
            const d1 = Math.min(cor.totalLengthM, baseD + dashLen);
            if (d1 - d0 < 14) continue;

            // Advance cursor once for dash midpoint O(1) hydrology lookup
            const midD = (d0 + d1) * 0.5;
            while (segCursor + 1 < nVerts - 1 && cumDistM[segCursor + 1] < midD) {
              segCursor++;
            }
            const cellIdx = corHydroIdx[segCursor];
            const hydroDepth = depthGrid && cellIdx >= 0 ? depthGrid[cellIdx] || 0 : 0;
            const hydroTcMin = tcGrid && cellIdx >= 0 ? (tcGrid[cellIdx] || 0) * 0.1 : 0;
            const hydroBProx = bProxGrid && cellIdx >= 0 ? bProxGrid[cellIdx] || 0 : 0;
            const hydroRunoffMm = runoffGrid && cellIdx >= 0 ? runoffGrid[cellIdx] || 0 : 0;

            if (engine && waveFrontMin < hydroTcMin - 4) continue;

            const localActivity = engine
              ? Math.max(Math.min(1, hydroRunoffMm / 38), Math.min(1, hydroDepth / 0.28))
              : 0.75;
            if (engine && !isMainVerified && localActivity < 0.14) continue;
            if (engine && st.soilMoisture === 'dry' && hydroRunoffMm < 1.5 && !isMainVerified) continue;

            const isPooled = hydroDepth >= 0.14;
            const isBottlenecked = isClogged && hydroBProx > 105 && isPooled;
            const flareFactor = isPooled ? 1.0 + Math.min(0.85, hydroDepth * 0.9) : 1.0;
            const spread = cor.baseSpreadM * flareFactor;
            const weaveAmp = cor.baseSpreadM * (isBottlenecked ? 0.14 : 0.08);

            // Rewind cursor slightly to d0 so k = 0..steps walks monotonically without binary searches
            let kCursor = segCursor;
            while (kCursor > 0 && cumDistM[kCursor] > d0) kCursor--;

            for (let k = 0; k <= steps; k++) {
              const d = d0 + ((d1 - d0) * k) / steps;
              while (kCursor + 1 < nVerts - 1 && cumDistM[kCursor + 1] < d) {
                kCursor++;
              }
              const dA = cumDistM[kCursor];
              const dB = cumDistM[Math.min(nVerts - 1, kCursor + 1)];
              const span = Math.max(1e-4, dB - dA);
              const t = Math.max(0, Math.min(1, (d - dA) / span));
              const nextI = Math.min(nVerts - 1, kCursor + 1);
              const x = corSx[kCursor] + (corSx[nextI] - corSx[kCursor]) * t;
              const y = corSy[kCursor] + (corSy[nextI] - corSy[kCursor]) * t;
              const ux = corNxU[kCursor] + (corNxU[nextI] - corNxU[kCursor]) * t;
              const uy = corNyU[kCursor] + (corNyU[nextI] - corNyU[kCursor]) * t;

              const weave =
                Math.sin(d * 0.045 + s * 1.85 + h1 * 6.28 + elapsedSec * 0.95) * weaveAmp;
              const rawLatPx = (weightedNorm * (spread * 0.48) + weave) * pxPerM;
              const latPx = Math.max(-maxLatPx, Math.min(maxLatPx, rawLatPx));
              ptsX[k] = x + ux * latPx;
              ptsY[k] = y + uy * latPx;
            }

            const sx = ptsX[0];
            const sy = ptsY[0];
            const ex = ptsX[steps];
            const ey = ptsY[steps];
            if (
              Math.max(sx, ex) < -30 ||
              Math.min(sx, ex) > width + 30 ||
              Math.max(sy, ey) < -30 ||
              Math.min(sy, ey) > height + 30
            ) {
              continue;
            }
            if (Math.hypot(ex - sx, ey - sy) < 3) continue;

            if ((isMainVerified || isPooled) && isCenterCore && isMidStrand) {
              bedGlowPath.moveTo(ptsX[0], ptsY[0]);
              for (let k = 1; k <= steps; k++) bedGlowPath.lineTo(ptsX[k], ptsY[k]);
              hasBedGlow = true;
            }

            tailPath.moveTo(ptsX[0], ptsY[0]);
            for (let k = 1; k <= idx1; k++) tailPath.lineTo(ptsX[k], ptsY[k]);
            hasTail = true;

            if (isCenterCore) {
              midCorePath.moveTo(ptsX[idx1], ptsY[idx1]);
              for (let k = idx1 + 1; k <= idx2; k++) midCorePath.lineTo(ptsX[k], ptsY[k]);
              hasMidCore = true;

              headCorePath.moveTo(ptsX[idx2], ptsY[idx2]);
              for (let k = idx2 + 1; k <= steps; k++) headCorePath.lineTo(ptsX[k], ptsY[k]);
              hasHeadCore = true;
            } else {
              midOuterPath.moveTo(ptsX[idx1], ptsY[idx1]);
              for (let k = idx1 + 1; k <= idx2; k++) midOuterPath.lineTo(ptsX[k], ptsY[k]);
              hasMidOuter = true;

              headOuterPath.moveTo(ptsX[idx2], ptsY[idx2]);
              for (let k = idx2 + 1; k <= steps; k++) headOuterPath.lineTo(ptsX[k], ptsY[k]);
              hasHeadOuter = true;
            }

            if (isBottlenecked && isCenterCore && isMidStrand && drawnBackwaterRings.length < 18) {
              const tooClose = drawnBackwaterRings.some(([rx, ry]) => Math.hypot(rx - ex, ry - ey) < 28);
              if (!tooClose) {
                drawnBackwaterRings.push([ex, ey]);
                const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 2.2 + ci);
                const r = 5.5 + pulse * 3.5;
                ringPath.moveTo(ex + r, ey);
                ringPath.arc(ex, ey, r, 0, Math.PI * 2);
                hasRings = true;
              }
            }
          }
        }
      }

      const recAlpha = st.isRecession ? 0.76 : 1.0;
      const activityGain = (0.62 + rainNorm * 0.38) * recAlpha;
      const coreRgb = sedimentMix > 0.05 ? blendRgb([255, 255, 255], [236, 224, 206], sedimentMix) : '255, 255, 255';
      const outerRgb = sedimentMix > 0.05 ? blendRgb([224, 242, 254], [236, 224, 206], sedimentMix) : '224, 242, 254';

      if (hasBedGlow) {
        const bedRgb = sedimentMix > 0.1 ? '148, 163, 184' : '56, 189, 248';
        ctx.strokeStyle = `rgba(${bedRgb}, ${(0.15 * activityGain).toFixed(2)})`;
        ctx.lineWidth = 2.8;
        ctx.stroke(bedGlowPath);
      }
      if (hasTail) {
        ctx.strokeStyle = `rgba(${outerRgb}, ${(0.24 * activityGain).toFixed(2)})`;
        ctx.lineWidth = 0.85;
        ctx.stroke(tailPath);
      }
      if (hasMidOuter) {
        ctx.strokeStyle = `rgba(${outerRgb}, ${(0.48 * activityGain).toFixed(2)})`;
        ctx.lineWidth = 0.95;
        ctx.stroke(midOuterPath);
      }
      if (hasMidCore) {
        ctx.strokeStyle = `rgba(${coreRgb}, ${(0.64 * activityGain).toFixed(2)})`;
        ctx.lineWidth = 0.95;
        ctx.stroke(midCorePath);
      }
      if (hasHeadOuter) {
        ctx.strokeStyle = `rgba(${outerRgb}, ${(0.72 * activityGain).toFixed(2)})`;
        ctx.lineWidth = 1.0;
        ctx.stroke(headOuterPath);
      }
      if (hasHeadCore) {
        ctx.strokeStyle = `rgba(${coreRgb}, ${Math.min(0.95, 0.9 * activityGain).toFixed(2)})`;
        ctx.lineWidth = 1.05;
        ctx.stroke(headCorePath);
      }
      if (hasRings) {
        ctx.strokeStyle = `rgba(251, 191, 36, ${(0.34 * recAlpha).toFixed(2)})`;
        ctx.lineWidth = 1.0;
        ctx.stroke(ringPath);
      }

      if (hasClip) {
        ctx.restore();
      }
    };

    drawFrameRef.current = drawFrame;

    const onMapMove = () => {
      projCacheRef.current.dirty = true;
      poolProjRef.current.dirty = true;
      drawFrame();
    };
    const onMapRender = () => {
      if (!propsRef.current.playing || reducedMotion) {
        drawFrame();
      }
    };

    map.on('move', onMapMove);
    map.on('render', onMapRender);

    let lastTs = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.004, (now - lastTs) / 1000));
      lastTs = now;
      const st = propsRef.current;
      if (st.playing && !reducedMotion) {
        if (!document.hidden) {
          const { targetRainNorm, targetSpeedMult } = computeTargetFlowState(st);
          const alpha = Math.min(1, dt * 3.5);
          const visSpeed = getVisualSpeedFactor(st.playbackSpeed);
          smoothedRainNormRef.current += (targetRainNorm - smoothedRainNormRef.current) * alpha;
          smoothedSpeedMultRef.current += (targetSpeedMult - smoothedSpeedMultRef.current) * alpha;
          simClockSecRef.current += dt * visSpeed;
          flowPhaseRef.current += dt * visSpeed * smoothedSpeedMultRef.current;
          drawFrame();
        }
        rafId = requestAnimationFrame(loop);
      } else {
        rafId = 0;
      }
    };

    ensureLoopRef.current = () => {
      if (!reducedMotion && propsRef.current.playing && rafId === 0) {
        lastTs = performance.now();
        rafId = requestAnimationFrame(loop);
      }
    };

    if (propsRef.current.playing && !reducedMotion) {
      ensureLoopRef.current();
    } else {
      drawFrame();
    }

    return () => {
      cancelAnimationFrame(rafId);
      rafId = 0;
      drawFrameRef.current = null;
      ensureLoopRef.current = null;
      map.off('move', onMapMove);
      map.off('render', onMapRender);
      ro.disconnect();
      ctx.clearRect(0, 0, width, height);
    };
  }, [active, mapRef]);

  useEffect(() => {
    if (!active) return;
    if (playing) {
      ensureLoopRef.current?.();
    } else {
      drawFrameRef.current?.();
    }
  }, [
    active,
    playing,
    progress,
    elapsedMin,
    rainMmHr,
    liveRainMmHr,
    durationMin,
    drainCondition,
    debrisCoupling,
    meanSedimentCv,
    isRecession,
    rainPattern,
    soilMoisture,
    simMapViewMode,
    corridors,
    cascadeEngine
  ]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
    />
  );
}
