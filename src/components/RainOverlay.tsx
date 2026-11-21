import { useEffect, useRef } from 'react';

interface RainOverlayProps {
  active: boolean;
  intensityMmHr: number;
}

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
  width: number;
}

export function RainOverlay({ active, intensityMmHr }: RainOverlayProps) {
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

    let width = 0;
    let height = 0;
    let dpr = 1;
    let drops: Drop[] = [];

    const spawnDrop = (randomY: boolean): Drop => ({
      x: Math.random() * (width + 160) - 40,
      y: randomY ? Math.random() * height : -20 - Math.random() * 80,
      len: baseLen * (0.7 + Math.random() * 0.65),
      speed: baseVy * (0.8 + Math.random() * 0.45),
      alpha: 0.22 + norm * 0.35 * (0.5 + Math.random() * 0.5),
      width: norm > 0.6 ? 1.4 : 1.1
    });

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drops = Array.from({ length: dropCount }, () => spawnDrop(true));
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    let rafId = 0;
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Subtle atmospheric storm tint proportional to rainfall intensity
      ctx.fillStyle = `rgba(15, 23, 42, ${(0.03 + norm * 0.14).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);

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

        if (d.y > height + 30 || d.x < -60) {
          drops[i] = spawnDrop(false);
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
  }, [active, intensityMmHr]);

  if (!active || intensityMmHr <= 0) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-11 h-full w-full"
    />
  );
}
