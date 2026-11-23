import { useEffect, useRef, type RefObject } from 'react';
import type { BBox, RainPattern } from '../types/gis';
import type { MapControlHandle } from './MapView';

interface RainOverlayProps {
  active: boolean;
  intensityMmHr: number;
  rainPattern?: RainPattern;
  uplandBbox?: BBox | null;
  mapControlRef?: RefObject<MapControlHandle | null>;
}

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
  width: number;
  depth: 0 | 1 | 2;
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

export function RainOverlay({
  active,
  intensityMmHr,
  rainPattern = 'uniform',
  uplandBbox = null,
  mapControlRef
}: RainOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active || intensityMmHr <= 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const norm = Math.max(0.08, Math.min(1, intensityMmHr / 150));
    const dropCount = Math.round(70 + norm * 235);
    const baseWindVx = -(1.4 + norm * 3.3);
    const baseVy = 12 + norm * 16;
    const baseLen = 11 + norm * 22;
    const isUpland = rainPattern === 'upland';

    let width = 0;
    let height = 0;
    let dpr = 1;
    let drops: Drop[] = [];
    let fadeAlpha = 0;
    let lastTs = performance.now();

    const getRegion = () =>
      getUplandScreenRegion(width, height, uplandBbox, mapControlRef?.current?.projectLngLat);

    const spawnDrop = (randomY: boolean, uplandTarget: boolean, region: ScreenUplandRegion): Drop => {
      const rRoll = Math.random();
      const depth: 0 | 1 | 2 = rRoll < 0.4 ? 0 : rRoll < 0.8 ? 1 : 2;
      const depthSpeed = depth === 0 ? 0.72 : depth === 1 ? 1.0 : 1.32;
      const depthLen = depth === 0 ? 0.68 : depth === 1 ? 1.0 : 1.32;
      const depthAlpha = depth === 0 ? 0.52 : depth === 1 ? 0.84 : 1.0;

      const spanW = uplandTarget && region.maxX > region.minX + 20 ? region.maxX - region.minX : width;
      const startX = uplandTarget && region.maxX > region.minX + 20 ? region.minX : 0;
      const topY = uplandTarget ? Math.max(-30, region.minY - 50) : -20;
      const botY = uplandTarget ? Math.max(topY + 90, region.maxY) : height;

      return {
        x: startX - 40 + Math.random() * (spanW + 140),
        y: randomY ? topY + Math.random() * Math.max(60, botY - topY) : topY - Math.random() * 70,
        len: baseLen * depthLen * (0.8 + Math.random() * 0.4),
        speed: baseVy * depthSpeed * (0.86 + Math.random() * 0.28),
        alpha: (0.26 + norm * 0.36) * depthAlpha * (0.72 + Math.random() * 0.28),
        width: depth === 0 ? 0.75 : depth === 1 ? 1.05 : 1.35,
        depth,
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
      const region = getRegion();
      drops = Array.from({ length: dropCount }, (_, idx) =>
        spawnDrop(true, isUpland && idx < dropCount * 0.8, region)
      );
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    let rafId = 0;
    const render = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.004, (now - lastTs) / 1000));
      lastTs = now;
      fadeAlpha = Math.min(1, fadeAlpha + dt * 3.5);

      ctx.clearRect(0, 0, width, height);

      const angles = mapControlRef?.current?.getCameraAngles?.() ?? { pitch: 36, bearing: -12 };
      const pitchRad = (Math.max(0, Math.min(65, angles.pitch)) * Math.PI) / 180;
      const bearingRad = (angles.bearing * Math.PI) / 180;
      const pitchForeshorten = 0.76 + 0.24 * Math.cos(pitchRad);
      const windVx = baseWindVx + Math.sin(bearingRad) * (0.8 + norm * 1.2);

      const region = isUpland ? getRegion() : null;

      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.lineCap = 'round';

      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        const lenY = d.len * pitchForeshorten;
        const dx = windVx * (d.len / baseLen);

        // Subtle shadow backing on foreground drops only so streaks read crisply over bright roofs
        if (d.depth === 2) {
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.16)';
          ctx.lineWidth = d.width + 0.4;
          ctx.beginPath();
          ctx.moveTo(d.x + 0.8, d.y + 0.4);
          ctx.lineTo(d.x + dx + 0.8, d.y + lenY + 0.4);
          ctx.stroke();
        }

        ctx.strokeStyle = `rgba(224, 242, 254, ${d.alpha.toFixed(2)})`;
        ctx.lineWidth = d.width;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + dx, d.y + lenY);
        ctx.stroke();

        const stepScale = dt * 60;
        d.x += windVx * (d.speed / baseVy) * stepScale;
        d.y += d.speed * pitchForeshorten * stepScale;

        const maxY = d.uplandTarget && region ? Math.max(120, region.maxY) : height + 30;
        const minX = d.uplandTarget && region ? region.minX - 60 : -60;
        if (d.y > maxY || d.x < minX || d.x > width + 80) {
          drops[i] = spawnDrop(false, d.uplandTarget, region ?? getRegion());
        }
      }

      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      ctx.clearRect(0, 0, width, height);
    };
  }, [active, intensityMmHr, rainPattern, uplandBbox, mapControlRef]);

  if (!active || intensityMmHr <= 0) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-11 h-full w-full"
    />
  );
}
