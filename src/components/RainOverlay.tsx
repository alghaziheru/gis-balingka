import { useEffect, useRef, type RefObject } from 'react';
import type { BasemapId, BBox, RainPattern } from '../types/gis';
import type { MapControlHandle } from './MapView';

interface RainOverlayProps {
  active: boolean;
  playing: boolean;
  playbackSpeed: number;
  intensityMmHr: number;
  liveRainMmHr: number;
  basemap?: BasemapId;
  rainPattern?: RainPattern;
  uplandBbox?: BBox | null;
  stormCore?: [number, number] | null;
  isRecession?: boolean;
  mapControlRef?: RefObject<MapControlHandle | null>;
}

interface Drop {
  x: number;
  y: number;
  lenFactor: number;
  speedFactor: number;
  layer: 0 | 1;
  uplandTarget: boolean;
}

interface ScreenUplandRegion {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function getUplandScreenRegion(
  width: number,
  height: number,
  uplandBbox: BBox | null | undefined,
  projectLngLat?: (lng: number, lat: number) => { x: number; y: number } | null
): ScreenUplandRegion {
  if (uplandBbox && projectLngLat) {
    const corners: [number, number][] = [
      [uplandBbox.west, uplandBbox.north],
      [uplandBbox.east, uplandBbox.north],
      [uplandBbox.east, uplandBbox.south],
      [uplandBbox.west, uplandBbox.south]
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let valid = 0;

    for (const [lng, lat] of corners) {
      const pt = projectLngLat(lng, lat);
      if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
        minX = Math.min(minX, pt.x);
        maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y);
        maxY = Math.max(maxY, pt.y);
        valid++;
      }
    }

    if (valid === 4 && maxX > minX && maxY > minY) {
      const padX = Math.max(24, (maxX - minX) * 0.1);
      const padY = Math.max(24, (maxY - minY) * 0.12);
      return {
        minX: Math.max(0, minX - padX),
        maxX: Math.min(width, maxX + padX),
        minY: Math.max(0, minY - padY),
        maxY: Math.min(height, maxY + padY)
      };
    }
  }

  return {
    minX: 0,
    maxX: width,
    minY: 0,
    maxY: Math.max(120, height * 0.56)
  };
}

const MAX_DROPS = 620;

function getVisualSpeedFactor(playbackSpeed: number): number {
  if (playbackSpeed <= 1) return Math.max(0.65, 0.5 + playbackSpeed * 0.5);
  return Math.min(1.9, 1 + Math.log2(playbackSpeed) * 0.225);
}

export function RainOverlay({
  active,
  playing,
  playbackSpeed,
  intensityMmHr,
  liveRainMmHr,
  basemap = 'elev',
  rainPattern = 'uniform',
  uplandBbox = null,
  stormCore = null,
  isRecession = false,
  mapControlRef
}: RainOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dropsRef = useRef<Drop[]>([]);
  const fadeAlphaRef = useRef(0);
  const overcastRef = useRef(0);
  const drawOnceRef = useRef<((dt: number, advance: boolean) => void) | null>(null);
  const ensureLoopRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    active,
    playing,
    playbackSpeed,
    intensityMmHr,
    liveRainMmHr,
    basemap,
    rainPattern,
    uplandBbox,
    stormCore,
    isRecession,
    mapControlRef
  });
  stateRef.current = {
    active,
    playing,
    playbackSpeed,
    intensityMmHr,
    liveRainMmHr,
    basemap,
    rainPattern,
    uplandBbox,
    stormCore,
    isRecession,
    mapControlRef
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let lastTs = performance.now();

    const getRegion = (): ScreenUplandRegion => {
      const st = stateRef.current;
      if (st.rainPattern === 'storm_core' && st.stormCore) {
        const coreBox: BBox = {
          west: st.stormCore[0] - 0.015,
          east: st.stormCore[0] + 0.015,
          south: st.stormCore[1] - 0.015,
          north: st.stormCore[1] + 0.015
        };
        return getUplandScreenRegion(width, height, coreBox, st.mapControlRef?.current?.projectLngLat);
      }
      return getUplandScreenRegion(width, height, st.uplandBbox, st.mapControlRef?.current?.projectLngLat);
    };

    const spawnDrop = (randomY: boolean, uplandTarget: boolean, region: ScreenUplandRegion): Drop => {
      const layer: 0 | 1 = Math.random() < 0.48 ? 0 : 1;
      const spanW = uplandTarget && region.maxX > region.minX + 20 ? region.maxX - region.minX : width;
      const startX = uplandTarget && region.maxX > region.minX + 20 ? region.minX : 0;
      const topY = uplandTarget ? Math.max(-30, region.minY - 50) : -24;
      const botY = uplandTarget ? Math.max(topY + 90, region.maxY) : height;

      return {
        x: startX - 30 + Math.random() * (spanW + 90),
        y: randomY ? topY + Math.random() * Math.max(60, botY - topY) : topY - Math.random() * 60,
        lenFactor: 0.45 + Math.random() * 1.15,
        speedFactor: 0.86 + Math.random() * 0.28,
        layer,
        uplandTarget
      };
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

      const st = stateRef.current;
      const isTargeted =
        st.rainPattern === 'upland' || (st.rainPattern === 'storm_core' && Boolean(st.stormCore));

      if (dropsRef.current.length !== MAX_DROPS) {
        const region = getRegion();
        dropsRef.current = Array.from({ length: MAX_DROPS }, (_, idx) =>
          spawnDrop(true, isTargeted && idx < MAX_DROPS * 0.45, region)
        );
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const drawRain = (dt: number, advance: boolean) => {
      const st = stateRef.current;
      const rawLive = st.isRecession ? 0 : Math.max(0, st.liveRainMmHr);
      const effectiveRate =
        rawLive > 0.2 ? Math.max(rawLive, st.intensityMmHr * 0.22) : 0;
      const hasLiveRain = st.active && st.intensityMmHr > 0 && effectiveRate > 0.2;
      const refRate = hasLiveRain ? effectiveRate : st.intensityMmHr;
      const norm = Math.pow(Math.max(0.06, Math.min(1, refRate / 50)), 0.68);
      const targetFade = hasLiveRain ? 1 : 0;
      const isRelief = st.basemap === 'relief';
      const targetOvercast = hasLiveRain
        ? (isRelief ? 0.22 : 0.18) + norm * 0.12
        : 0;

      // Snap opacity & storm darkness immediately when paused/scrubbing;
      // ramp smoothly during playback for dark-to-light storm progression.
      if (!advance) {
        fadeAlphaRef.current = targetFade;
        overcastRef.current = targetOvercast;
      } else {
        fadeAlphaRef.current =
          targetFade > fadeAlphaRef.current
            ? Math.min(targetFade, fadeAlphaRef.current + dt * 3.2)
            : Math.max(targetFade, fadeAlphaRef.current - dt * 2.2);
        overcastRef.current =
          targetOvercast > overcastRef.current
            ? Math.min(targetOvercast, overcastRef.current + dt * 0.85)
            : Math.max(targetOvercast, overcastRef.current - dt * 1.05);
      }

      ctx.clearRect(0, 0, width, height);
      if (fadeAlphaRef.current <= 0.01 && overcastRef.current <= 0.01) return;

      const activeCount = Math.min(MAX_DROPS, Math.round(180 + norm * (MAX_DROPS - 180)));
      const baseWindVx = -(0.55 + norm * 1.15);
      const baseVy = 12 + norm * 15;
      const baseLen = 10 + norm * 16;
      const isTargeted =
        st.rainPattern === 'upland' || (st.rainPattern === 'storm_core' && Boolean(st.stormCore));

      const angles = st.mapControlRef?.current?.getCameraAngles?.() ?? { pitch: 36, bearing: -12 };
      const pitchRad = (Math.max(0, Math.min(65, angles.pitch)) * Math.PI) / 180;
      const bearingRad = (angles.bearing * Math.PI) / 180;
      const pitchForeshorten = 0.78 + 0.22 * Math.cos(pitchRad);
      const windVx = baseWindVx + Math.sin(bearingRad) * 0.45;
      const region = isTargeted ? getRegion() : null;

      ctx.save();

      // Seamless full-viewport charcoal-slate overcast wash (zero rectangular borders or horizontal seams)
      const oc = overcastRef.current;
      if (oc > 0.01) {
        ctx.fillStyle = `rgba(12, 24, 36, ${oc.toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }

      const rainAlpha = fadeAlphaRef.current;
      if (rainAlpha > 0.01) {
        ctx.lineCap = 'round';
        ctx.lineWidth = 0.9;
        const drops = dropsRef.current;
        const speedScale = advance ? dt * 60 * getVisualSpeedFactor(st.playbackSpeed) : 0;

        if (advance) {
          const targetCutoff = activeCount * 0.45;
          for (let i = 0; i < activeCount; i++) {
            const d = drops[i];
            d.uplandTarget = isTargeted && i < targetCutoff;
            const speed = baseVy * (d.layer === 0 ? 0.84 : 1.12) * d.speedFactor;
            d.x += windVx * (speed / baseVy) * speedScale;
            d.y += speed * pitchForeshorten * speedScale;

            const maxY = d.uplandTarget && region ? Math.max(120, region.maxY) : height + 30;
            const minX = d.uplandTarget && region ? region.minX - 60 : -60;
            if (d.y > maxY || d.x < minX || d.x > width + 80) {
              drops[i] = spawnDrop(false, d.uplandTarget, region ?? getRegion());
            }
          }
        }

        // Pure CSRX fine rain mist: fixed 0.9px hairline thickness, random lengths, 2 batched alpha passes
        const layers = [
          { id: 0 as const, rgb: '242, 248, 255', alpha: (0.22 + norm * 0.14) * rainAlpha },
          { id: 1 as const, rgb: '255, 255, 255', alpha: (0.34 + norm * 0.18) * rainAlpha }
        ];
        for (const lyr of layers) {
          ctx.strokeStyle = `rgba(${lyr.rgb}, ${Math.min(0.55, lyr.alpha).toFixed(2)})`;
          ctx.beginPath();
          for (let i = 0; i < activeCount; i++) {
            const d = drops[i];
            if (d.layer !== lyr.id) continue;
            const len = baseLen * d.lenFactor;
            const lenY = len * pitchForeshorten;
            const dx = windVx * (len / baseLen);
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x + dx, d.y + lenY);
          }
          ctx.stroke();
        }
      }

      ctx.restore();
    };

    drawOnceRef.current = drawRain;

    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.004, (now - lastTs) / 1000));
      lastTs = now;
      const st = stateRef.current;
      const stillFading =
        (st.isRecession || st.liveRainMmHr <= 0.2) &&
        (fadeAlphaRef.current > 0.01 || overcastRef.current > 0.01);
      if (st.playing || stillFading) {
        drawRain(dt, st.playing && !document.hidden);
        rafId = requestAnimationFrame(loop);
      } else {
        rafId = 0;
      }
    };

    ensureLoopRef.current = () => {
      if (rafId === 0) {
        lastTs = performance.now();
        rafId = requestAnimationFrame(loop);
      }
    };

    ensureLoopRef.current();

    return () => {
      cancelAnimationFrame(rafId);
      rafId = 0;
      drawOnceRef.current = null;
      ensureLoopRef.current = null;
      ro.disconnect();
      ctx.clearRect(0, 0, width, height);
    };
  }, [active, mapControlRef]);

  useEffect(() => {
    if (!active) return;
    if (
      playing ||
      ((isRecession || liveRainMmHr <= 0.2) &&
        (fadeAlphaRef.current > 0.01 || overcastRef.current > 0.01))
    ) {
      ensureLoopRef.current?.();
    } else {
      drawOnceRef.current?.(0.016, false);
    }
  }, [active, playing, intensityMmHr, liveRainMmHr, isRecession, basemap, rainPattern, stormCore]);

  if (!active || intensityMmHr <= 0) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[3] h-full w-full"
    />
  );
}
