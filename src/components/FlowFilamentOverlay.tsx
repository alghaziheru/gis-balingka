import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { CascadeEngine } from '../lib/cascadeEngine';
import { sampleCorridorAtDistance, type FlowCorridor } from '../lib/flowRibbons';
import type { DrainCondition, GeoFeatureCollection, RainPattern, SoilMoisture } from '../types/gis';

interface FlowFilamentOverlayProps {
  active: boolean;
  mapRef: MutableRefObject<MapLibreMap | null>;
  corridors: FlowCorridor[];
  glintPoints: [number, number][];
  nagariBoundary?: GeoFeatureCollection | null;
  rainMmHr: number;
  durationMin: number;
  progress: number;
  drainCondition: DrainCondition;
  rainPattern: RainPattern;
  soilMoisture: SoilMoisture;
  cascadeEngine: CascadeEngine | null;
}

function strandHash(seed: number, strand: number, salt: number): number {
  const x = Math.sin((seed & 0xffff) * 12.9898 + (strand + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

interface CellHydroSample {
  depth: number;
  tcMin: number;
  bProx: number;
  runoffMm: number;
}

function sampleCellHydro(engine: CascadeEngine | null, lng: number, lat: number): CellHydroSample {
  if (!engine) return { depth: 0, tcMin: 0, bProx: 0, runoffMm: 0 };
  const { width, height, bbox } = engine.fields;
  if (lng < bbox.west || lng > bbox.east || lat < bbox.south || lat > bbox.north) {
    return { depth: 0, tcMin: 0, bProx: 0, runoffMm: 0 };
  }
  const col = Math.max(0, Math.min(width - 1, Math.floor(((lng - bbox.west) / (bbox.east - bbox.west)) * width)));
  const row = Math.max(0, Math.min(height - 1, Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)));
  const idx = row * width + col;
  return {
    depth: engine.getFloodDepthGrid()[idx] || 0,
    tcMin: (engine.getTravelTimeTenthMin()[idx] || 0) * 0.1,
    bProx: engine.getBottleneckProx()[idx] || 0,
    runoffMm: engine.getRunoffMmGrid()[idx] || 0
  };
}

export function FlowFilamentOverlay({
  active,
  mapRef,
  corridors,
  glintPoints,
  nagariBoundary = null,
  rainMmHr,
  durationMin,
  progress,
  drainCondition,
  rainPattern,
  soilMoisture,
  cascadeEngine
}: FlowFilamentOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({
    active,
    corridors,
    glintPoints,
    nagariBoundary,
    rainMmHr,
    durationMin,
    progress,
    drainCondition,
    rainPattern,
    soilMoisture,
    cascadeEngine
  });
  propsRef.current = {
    active,
    corridors,
    glintPoints,
    nagariBoundary,
    rainMmHr,
    durationMin,
    progress,
    drainCondition,
    rainPattern,
    soilMoisture,
    cascadeEngine
  };

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

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const startTime = performance.now();
    let rafId = 0;

    const drawFrame = () => {
      const st = propsRef.current;
      ctx.clearRect(0, 0, width, height);
      if (!st.active || st.progress <= 0.02 || st.rainMmHr <= 0) return;

      const bounds = map.getBounds();
      const vWest = bounds.getWest();
      const vEast = bounds.getEast();
      const vSouth = bounds.getSouth();
      const vNorth = bounds.getNorth();

      const elapsedSec = reducedMotion ? 1.8 : (performance.now() - startTime) / 1000;
      const isMobile = width < 768;
      const rainNorm = Math.max(0.12, Math.min(1, st.rainMmHr / 60));
      const speedMult = 0.62 + rainNorm * 0.85;
      const maxTier = st.progress >= 0.3 || st.rainMmHr >= 30 || st.durationMin >= 720 ? 2 : 1;

      const refTravel = st.cascadeEngine ? Math.max(18, st.cascadeEngine.fields.p90TravelMin) : 75;
      const waveFrontMin = Math.max(st.durationMin * st.progress, st.progress * refTravel * 1.32);
      const isClogged = st.drainCondition !== 'cleared';

      const boundary = st.nagariBoundary;
      let hasClip = false;
      if (boundary?.features?.length) {
        ctx.save();
        ctx.beginPath();
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
              for (let ri = 0; ri < ring.length; ri++) {
                const pt = map.project([ring[ri][0], ring[ri][1]]);
                if (ri === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
              }
              ctx.closePath();
              hasClip = true;
            }
          }
        }
        if (hasClip) {
          ctx.clip('evenodd');
        } else {
          ctx.restore();
        }
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const list = st.corridors;
      for (let ci = 0; ci < list.length; ci++) {
        const cor = list[ci];
        if (cor.tier > maxTier) continue;
        if (
          cor.bbox.east < vWest ||
          cor.bbox.west > vEast ||
          cor.bbox.north < vSouth ||
          cor.bbox.south > vNorth
        ) {
          continue;
        }

        const isMainVerified = cor.kind === 'verified_river' || cor.kind === 'verified_channel';
        const strands = isMobile ? Math.max(2, Math.round(cor.strandCount * 0.65)) : cor.strandCount;
        const baseCycle = Math.max(110, Math.min(220, cor.totalLengthM * 0.45));
        const baseDashLen = Math.min(baseCycle * 0.68, 68 + rainNorm * 66);
        const baseSpeed = cor.speedMps * speedMult * (st.drainCondition === 'cleared' ? 1.12 : 0.94);

        for (let s = 0; s < strands; s++) {
          const h1 = strandHash(cor.seed, s, 1);
          const h2 = strandHash(cor.seed, s, 2);
          const h3 = strandHash(cor.seed, s, 3);

          const rawNorm = strands > 1 ? (s / (strands - 1)) * 2 - 1 : 0;
          const centerDist = Math.abs(rawNorm);
          const weightedNorm = Math.sign(rawNorm) * Math.pow(centerDist, 1.25) + (h1 - 0.5) * 0.16;
          const isCenterCore = centerDist <= 0.45;

          const velFactor = isCenterCore ? 1.1 + h2 * 0.14 : 0.78 + h2 * 0.15;
          const dashCycle = baseCycle * (0.82 + h3 * 0.44);
          const dashLen = Math.min(dashCycle * 0.72, baseDashLen * (0.72 + h1 * 0.54));
          const phaseShift = h2 * dashCycle * 2.3;
          const strandSpeed = baseSpeed * velFactor;
          const travel = (elapsedSec * strandSpeed + phaseShift) % dashCycle;

          for (let baseD = -dashCycle + travel; baseD < cor.totalLengthM; baseD += dashCycle) {
            const d0 = Math.max(0, baseD);
            const d1 = Math.min(cor.totalLengthM, baseD + dashLen);
            if (d1 - d0 < 16) continue;

            const midSample = sampleCorridorAtDistance(cor, (d0 + d1) * 0.5);
            const hydro = sampleCellHydro(st.cascadeEngine, midSample.lng, midSample.lat);

            if (st.cascadeEngine && waveFrontMin < hydro.tcMin - 4) continue;

            // Couple cell-level SCS-CN effective runoff & local depth so mild rain stays quiet in minor gullies
            const localActivity = st.cascadeEngine
              ? Math.max(Math.min(1, hydro.runoffMm / 38), Math.min(1, hydro.depth / 0.28))
              : 0.75;
            if (st.cascadeEngine && !isMainVerified && localActivity < 0.16) {
              continue;
            }
            if (st.cascadeEngine && st.soilMoisture === 'dry' && hydro.runoffMm < 1.5 && !isMainVerified) {
              continue;
            }
            const runoffGain = st.cascadeEngine
              ? Math.max(0.24, Math.min(1.0, Math.sqrt(Math.max(0, hydro.runoffMm) / 55)))
              : 0.75;

            const isPooled = hydro.depth >= 0.14;
            const isBottlenecked = isClogged && hydro.bProx > 105 && isPooled;
            const flareFactor = isPooled ? 1.0 + Math.min(1.05, hydro.depth * 1.15) : 1.0;
            const spread = cor.baseSpreadM * flareFactor;
            const weaveAmp = cor.baseSpreadM * (isBottlenecked ? 0.24 : 0.13);

            const steps = 11;
            const ptsX: number[] = [];
            const ptsY: number[] = [];

            for (let k = 0; k <= steps; k++) {
              const d = d0 + ((d1 - d0) * k) / steps;
              const samp = sampleCorridorAtDistance(cor, d);
              const weave =
                Math.sin(d * 0.048 + s * 1.85 + h1 * 6.28 + elapsedSec * (isBottlenecked ? 0.7 : 1.15)) * weaveAmp;
              const latM = weightedNorm * (spread * 0.5) + weave;
              const p = map.project([samp.lng + samp.nx * latM, samp.lat + samp.ny * latM]);
              ptsX.push(p.x);
              ptsY.push(p.y);
            }

            const sx = ptsX[0];
            const sy = ptsY[0];
            const ex = ptsX[ptsX.length - 1];
            const ey = ptsY[ptsY.length - 1];
            if (
              Math.max(sx, ex) < -30 ||
              Math.min(sx, ex) > width + 30 ||
              Math.max(sy, ey) < -30 ||
              Math.min(sy, ey) > height + 30
            ) {
              continue;
            }
            if (Math.hypot(ex - sx, ey - sy) < 3) continue;

            const baseStrength = isMainVerified
              ? isCenterCore
                ? 0.96
                : 0.74
              : cor.kind === 'rbi_tributary'
                ? isCenterCore
                  ? 0.90
                  : 0.68
                : isCenterCore
                  ? 0.84
                  : 0.62;
            const activityFactor = isMainVerified
              ? 0.38 + 0.62 * Math.max(runoffGain, Math.min(1, hydro.depth / 0.4))
              : 0.14 + 0.86 * localActivity;
            const baseAlpha = baseStrength * activityFactor;

            // High-contrast deep ocean blue / teal for light DEMNAS Relief, Elevasi & Lereng surfaces
            const rgb = isMainVerified
              ? isCenterCore
                ? '7, 89, 133'
                : '2, 132, 199'
              : cor.kind === 'rbi_tributary'
                ? isCenterCore
                  ? '3, 105, 161'
                  : '14, 165, 233'
                : isCenterCore
                  ? '14, 116, 144'
                  : '8, 145, 178';
            const midIdx = Math.max(1, Math.floor((ptsX.length - 1) * 0.45));
            const baseWidth = isCenterCore
              ? cor.kind === 'verified_river'
                ? 2.15
                : 1.75
              : 1.25;

            ctx.strokeStyle = `rgba(${rgb}, ${(baseAlpha * 0.48).toFixed(2)})`;
            ctx.lineWidth = Math.max(1.0, baseWidth * 0.85);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            for (let k = 1; k < ptsX.length; k++) {
              ctx.lineTo(ptsX[k], ptsY[k]);
            }
            ctx.stroke();

            ctx.strokeStyle = `rgba(${rgb}, ${Math.min(0.98, baseAlpha + 0.06).toFixed(2)})`;
            ctx.lineWidth = baseWidth;
            ctx.beginPath();
            ctx.moveTo(ptsX[midIdx], ptsY[midIdx]);
            for (let k = midIdx + 1; k < ptsX.length; k++) {
              ctx.lineTo(ptsX[k], ptsY[k]);
            }
            ctx.stroke();
          }
        }
      }

      const glints = st.glintPoints;
      if (glints.length > 0) {
        const stride = Math.max(1, Math.ceil(glints.length / 240));
        for (let i = 0; i < glints.length; i += stride) {
          const [lng, lat] = glints[i];
          if (lng < vWest || lng > vEast || lat < vSouth || lat > vNorth) continue;
          const pt = map.project([lng, lat]);
          if (pt.x < -8 || pt.x > width + 8 || pt.y < -8 || pt.y > height + 8) continue;

          const twinkle = 0.5 + 0.5 * Math.sin(elapsedSec * 3.4 + i * 1.73);
          const alpha = 0.25 + twinkle * 0.55;
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
          ctx.fillRect(pt.x - 0.75, pt.y - 0.75, 1.5, 1.5);
        }
      }

      if (hasClip) {
        ctx.restore();
      }
    };

    const onMapRender = () => {
      drawFrame();
    };
    let lastDrawTs = 0;

    if (reducedMotion) {
      map.on('render', onMapRender);
      drawFrame();
    } else {
      const loop = (now: number) => {
        if (!document.hidden && now - lastDrawTs >= 32) {
          lastDrawTs = now;
          drawFrame();
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (reducedMotion) map.off('render', onMapRender);
      ro.disconnect();
      ctx.clearRect(0, 0, width, height);
    };
  }, [active, mapRef]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
    />
  );
}
