import { useEffect, useRef } from 'react';
import { CloudRain } from 'lucide-react';
import type { Language, RainPattern } from '../types/gis';

interface RainOverlayProps {
  active: boolean;
  intensityMmHr: number;
  rainPattern?: RainPattern;
  lang?: Language;
}

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
  width: number;
  uplandOnly: boolean;
}

export function RainOverlay({
  active,
  intensityMmHr,
  rainPattern = 'uniform',
  lang = 'id'
}: RainOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active || intensityMmHr <= 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const norm = Math.max(0.08, Math.min(1, intensityMmHr / 150));
    const dropCount = Math.round(55 + norm * 250);
    const windVx = -(1.6 + norm * 4.0);
    const baseVy = 11 + norm * 17;
    const baseLen = 10 + norm * 22;
    const isUpland = rainPattern === 'upland';

    let width = 0;
    let height = 0;
    let dpr = 1;
    let drops: Drop[] = [];

    const spawnDrop = (randomY: boolean, uplandOnly: boolean): Drop => {
      const maxY = uplandOnly ? Math.max(120, height * 0.56) : height;
      return {
        x: Math.random() * (width + 160) - 40,
        y: randomY ? Math.random() * maxY : -20 - Math.random() * 80,
        len: baseLen * (0.7 + Math.random() * 0.65),
        speed: baseVy * (0.8 + Math.random() * 0.45),
        alpha: (uplandOnly ? 0.28 : 0.2) + norm * 0.35 * (0.5 + Math.random() * 0.5),
        width: norm > 0.6 ? 1.4 : 1.1,
        uplandOnly
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
      drops = Array.from({ length: dropCount }, (_, idx) =>
        spawnDrop(true, isUpland && idx < dropCount * 0.78)
      );
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    let rafId = 0;
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      if (isUpland) {
        ctx.fillStyle = `rgba(15, 23, 42, ${(0.05 + norm * 0.14).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height * 0.55);
      } else {
        ctx.fillStyle = `rgba(15, 23, 42, ${(0.03 + norm * 0.14).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.lineCap = 'round';
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        const ratio = d.len / baseLen;
        const dx = windVx * ratio;
        const dy = d.len;

        ctx.strokeStyle = `rgba(224, 242, 254, ${d.alpha.toFixed(2)})`;
        ctx.lineWidth = d.width;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + dx, d.y + dy);
        ctx.stroke();

        d.x += windVx * (d.speed / baseVy);
        d.y += d.speed;

        const maxY = d.uplandOnly ? height * 0.58 : height + 30;
        if (d.y > maxY || d.x < -60) {
          drops[i] = spawnDrop(false, d.uplandOnly);
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      ctx.clearRect(0, 0, width, height);
    };
  }, [active, intensityMmHr, rainPattern]);

  if (!active || intensityMmHr <= 0) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-11 h-full w-full"
      />
      {rainPattern === 'upland' && (
        <div className="surface-panel pointer-events-none fixed top-15 right-3.5 z-15 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[#0369a1] max-md:hidden">
          <CloudRain className="h-3.5 w-3.5 shrink-0" />
          <span>
            {lang === 'en'
              ? 'Rain focused on upper Singgalang slopes'
              : 'Hujan terkonsentrasi di hulu Gunung Singgalang'}
          </span>
        </div>
      )}
    </>
  );
}
