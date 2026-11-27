import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { HydrographPoint, Language, ViewMode } from '../types/gis';
import { InfoTooltip } from './InfoTooltip';

interface HydrographSparklineProps {
  lang: Language;
  points: HydrographPoint[];
  progress: number;
  durationMin: number;
  totalWindowMin: number;
  peakQ: number;
  peakQP10: number;
  peakQP90: number;
  isCalibrated?: boolean;
  mode?: ViewMode;
  interactive?: boolean;
  compact?: boolean;
  bare?: boolean;
  onSeekProgress?: (progress: number) => void;
}

function interpolatePointAtFrac(
  points: HydrographPoint[],
  totalWindowMin: number,
  frac: number
): { timeMin: number; rainMmHr: number; qM3s: number } {
  const safeTotal = Math.max(15, totalWindowMin);
  const tMin = Math.max(0, Math.min(1, frac)) * safeTotal;
  if (points.length === 0) return { timeMin: tMin, rainMmHr: 0, qM3s: 0 };
  if (tMin <= points[0].timeMin) {
    return { timeMin: tMin, rainMmHr: points[0].rainMmHr, qM3s: points[0].qBulkP50 };
  }
  const last = points[points.length - 1];
  if (tMin >= last.timeMin) {
    return { timeMin: tMin, rainMmHr: last.rainMmHr, qM3s: last.qBulkP50 };
  }
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timeMin <= tMin) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = Math.max(1e-4, b.timeMin - a.timeMin);
  const r = Math.max(0, Math.min(1, (tMin - a.timeMin) / span));
  return {
    timeMin: tMin,
    rainMmHr: a.rainMmHr + (b.rainMmHr - a.rainMmHr) * r,
    qM3s: a.qBulkP50 + (b.qBulkP50 - a.qBulkP50) * r
  };
}

function formatAxisClock(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${String(h).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function HydrographSparkline({
  lang,
  points,
  progress,
  durationMin,
  totalWindowMin,
  peakQ,
  peakQP10,
  peakQP90,
  isCalibrated = false,
  mode = 'detail',
  interactive = true,
  compact = false,
  bare = false,
  onSeekProgress
}: HydrographSparklineProps) {
  const isEn = lang === 'en';
  const isDetail = mode === 'detail';
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);

  const W = 328;
  const H = compact ? 72 : 88;
  const padL = 4;
  const padR = 4;
  const padT = 8;
  const padB = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const clientXToFrac = useCallback(
    (clientX: number): number => {
      const svg = svgRef.current;
      if (!svg) return progress;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return progress;
      const plotLeft = rect.left + (padL / W) * rect.width;
      const plotWidthPx = (plotW / W) * rect.width;
      return Math.max(0, Math.min(1, (clientX - plotLeft) / Math.max(1, plotWidthPx)));
    },
    [padL, plotW, progress]
  );

  if (!points || points.length < 2) return null;

  const maxRain = Math.max(15, ...points.map(p => p.rainMmHr));
  const maxQ = Math.max(5, ...points.map(p => (isDetail ? Math.max(p.qP90, p.qBulkP50) : p.qBulkP50)));
  const safeTotal = Math.max(15, totalWindowMin);

  const xOfTime = (tMin: number) => padL + (Math.min(safeTotal, Math.max(0, tMin)) / safeTotal) * plotW;
  const yOfQ = (q: number) => padT + plotH - (Math.min(maxQ, Math.max(0, q)) / maxQ) * (plotH * 0.74);
  const rainBarH = (r: number) => (Math.min(maxRain, Math.max(0, r)) / maxRain) * (plotH * 0.28);

  const barW = Math.max(1.2, plotW / points.length - (points.length > 60 ? 0.6 : 1.6));

  const p90Pts = points.map(p => `${xOfTime(p.timeMin).toFixed(1)},${yOfQ(p.qP90).toFixed(1)}`);
  const p10Rev = [...points]
    .reverse()
    .map(p => `${xOfTime(p.timeMin).toFixed(1)},${yOfQ(p.qP10).toFixed(1)}`);
  const bandPath = `M ${p90Pts.join(' L ')} L ${p10Rev.join(' L ')} Z`;

  const bulkLine = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xOfTime(p.timeMin).toFixed(1)},${yOfQ(p.qBulkP50).toFixed(1)}`)
    .join(' ');
  const clearLine = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xOfTime(p.timeMin).toFixed(1)},${yOfQ(p.qP50).toFixed(1)}`)
    .join(' ');

  const stormEndX = xOfTime(durationMin);
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const playheadX = padL + clampedProgress * plotW;
  const hasBulking = isDetail && points.some(p => p.qBulkP50 > p.qP50 * 1.03);

  const activeSample = interpolatePointAtFrac(points, safeTotal, clampedProgress);
  const activeDotY = yOfQ(activeSample.qM3s);
  const hoverSample = hoverFrac !== null ? interpolatePointAtFrac(points, safeTotal, hoverFrac) : null;
  const hoverX = hoverFrac !== null ? padL + hoverFrac * plotW : null;

  const canSeek = interactive && Boolean(onSeekProgress);

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!canSeek || !onSeekProgress) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    const frac = clientXToFrac(e.clientX);
    setHoverFrac(frac);
    onSeekProgress(frac);
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!canSeek) return;
    const frac = clientXToFrac(e.clientX);
    setHoverFrac(frac);
    if (dragging && onSeekProgress) {
      onSeekProgress(frac);
    }
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging) {
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
    if (e.type === 'pointercancel' || e.pointerType !== 'mouse') {
      setHoverFrac(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!canSeek || !onSeekProgress) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onSeekProgress(Math.min(1, clampedProgress + 0.02));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onSeekProgress(Math.max(0, clampedProgress - 0.02));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSeekProgress(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeekProgress(1);
    }
  };

  const fmtAxisTime = (min: number) =>
    min >= 180
      ? `${min % 60 === 0 ? min / 60 : (min / 60).toFixed(1)}${isEn ? 'h' : 'j'}`
      : `${min}m`;
  const durLabel = fmtAxisTime(durationMin);
  const totalLabel = fmtAxisTime(totalWindowMin);
  const drainWord = isEn ? 'drain' : 'surut';
  const showSeparateStormTick = W - padR - stormEndX >= 68;

  return (
    <div className={bare ? '' : 'rounded-lg border border-[#161c1a]/10 bg-[#fafaf8] px-2.5 pt-2 pb-1.5'}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] whitespace-nowrap">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-[#434d49]">
          <span className="truncate">
            {isDetail
              ? isEn
                ? 'Discharge Hydrograph (Q · Sensitivity)'
                : 'Hidrograf Debit (Q · Sensitivitas)'
              : isEn
                ? 'Rainfall & Valley Flow Curve'
                : 'Kurva Hujan & Aliran Lembah'}
          </span>
          <InfoTooltip
            text={
              isDetail
                ? isEn
                  ? 'Compares rainfall intensity over time (top bars) against modeled channel discharge Q (m³/s) from SCS-CN + 1D Muskingum-Cunge. Shaded band shows a 7-scenario parameter + ±25% rainfall sensitivity spread.'
                  : 'Membandingkan laju hujan dari waktu ke waktu (batang atas) dengan perkiraan debit Q (m³/s) hasil SCS-CN + 1D Muskingum-Cunge. Pita arsiran adalah rentang sensitivitas 7 skenario (parameter + ±25% hujan).'
                : isEn
                  ? 'Shows storm rainfall input (top bars) and modeled downstream valley flow curve. Click or drag anywhere on the chart to jump to a timestamp.'
                  : 'Menampilkan intensitas hujan (batang atas) dan kurva aliran lembah hilir. Klik atau geser grafik untuk melompat ke waktu tertentu.'
            }
            label={isEn ? 'What is a hydrograph?' : 'Apa itu hidrograf?'}
          />
        </span>

        <span className="font-mono-num shrink-0 font-bold text-[#0369a1]">
          {hoverSample ? (
            <span className="text-[#161c1a]">
              {formatAxisClock(hoverSample.timeMin)} · {hoverSample.rainMmHr.toFixed(0)} mm/{isEn ? 'h' : 'j'} ·{' '}
              <span className="text-[#0369a1]">
                {isCalibrated ? hoverSample.qM3s.toFixed(1) : `~${Math.round(hoverSample.qM3s)}`} m³/s
              </span>
            </span>
          ) : clampedProgress <= 0.02 && peakQ <= 0 ? (
            <span className="font-sans text-[10.5px] font-medium text-[#636f6a]">
              {isEn ? 'Press Play or scrub chart' : 'Klik Putar atau geser grafik'}
            </span>
          ) : (
            <>
              {isEn ? 'Peak' : 'Puncak'} {isCalibrated ? peakQ.toFixed(1) : `~${Math.round(peakQ)}`} m³/s
              {isDetail && (
                <span className="ml-1 font-normal text-[#636f6a]">
                  [{peakQP10.toFixed(0)}–{peakQP90.toFixed(0)}]
                </span>
              )}
            </>
          )}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={`w-full overflow-visible rounded-md select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0369a1] ${
          compact ? 'h-[68px]' : 'h-[86px]'
        } ${canSeek ? (dragging ? 'cursor-grabbing' : 'cursor-pointer') : ''}`}
        role={canSeek ? 'slider' : 'img'}
        tabIndex={canSeek ? 0 : undefined}
        aria-valuemin={canSeek ? 0 : undefined}
        aria-valuemax={canSeek ? 100 : undefined}
        aria-valuenow={canSeek ? Math.round(clampedProgress * 100) : undefined}
        aria-label={isEn ? 'Rainfall and routed river discharge hydrograph' : 'Grafik hujan dan debit limpasan sungai'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (!dragging) setHoverFrac(null);
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Recession shading zone after storm ends */}
        <rect
          x={stormEndX}
          y={padT}
          width={Math.max(0, W - padR - stormEndX)}
          height={plotH}
          fill="#161c1a"
          fillOpacity={0.035}
        />

        {/* Subtle mid reference line */}
        <line
          x1={padL}
          y1={padT + plotH * 0.55}
          x2={W - padR}
          y2={padT + plotH * 0.55}
          stroke="#161c1a"
          strokeOpacity={0.06}
          strokeWidth={1}
        />

        {/* Baseline */}
        <line
          x1={padL}
          y1={padT + plotH}
          x2={W - padR}
          y2={padT + plotH}
          stroke="#161c1a"
          strokeOpacity={0.14}
          strokeWidth={1}
        />

        {/* Inverted rainfall hyetograph bars from top */}
        {points.map((pt, idx) => {
          const bh = rainBarH(pt.rainMmHr);
          if (bh <= 0.4) return null;
          const x = xOfTime(pt.timeMin) - barW * 0.5;
          const isPast = x <= playheadX;
          return (
            <rect
              key={idx}
              x={Math.max(padL, x)}
              y={padT}
              width={barW}
              height={bh}
              rx={1}
              fill="#0284c7"
              fillOpacity={isPast ? 0.45 : 0.22}
            />
          );
        })}

        {/* P10-P90 uncertainty envelope (Detailed mode only) */}
        {isDetail && <path d={bandPath} fill="#0369a1" fillOpacity={0.14} />}

        {/* Clear-water baseline (dashed) when sediment bulking separates Q_bulk from Q_water */}
        {hasBulking && (
          <path
            d={clearLine}
            fill="none"
            stroke="#0284c7"
            strokeWidth={1.2}
            strokeDasharray="3 2.5"
            strokeOpacity={0.7}
          />
        )}

        {/* Primary routed discharge curve */}
        <path d={bulkLine} fill="none" stroke="#0369a1" strokeWidth={2} strokeLinejoin="round" />

        {/* Storm-end divider */}
        <line
          x1={stormEndX}
          y1={padT}
          x2={stormEndX}
          y2={padT + plotH}
          stroke="#636f6a"
          strokeWidth={1}
          strokeDasharray="2.5 2.5"
        />

        {/* Hover hairline preview */}
        {hoverX !== null && !dragging && (
          <line
            x1={hoverX}
            y1={padT}
            x2={hoverX}
            y2={padT + plotH}
            stroke="#0369a1"
            strokeOpacity={0.45}
            strokeWidth={1}
          />
        )}

        {/* Active playhead + curve tracker dot */}
        <line
          x1={playheadX}
          y1={padT - 1}
          x2={playheadX}
          y2={padT + plotH}
          stroke="#161c1a"
          strokeWidth={1.5}
        />
        {clampedProgress > 0.01 && (
          <circle
            cx={playheadX}
            cy={activeDotY}
            r={3.5}
            fill="#ffffff"
            stroke="#0369a1"
            strokeWidth={2}
          />
        )}

        {/* X-axis labels */}
        <text x={padL} y={H - 3} fontSize={9.5} fill="#636f6a" fontFamily="JetBrains Mono, monospace">
          00:00
        </text>
        {showSeparateStormTick && (
          <text
            x={stormEndX - 4}
            y={H - 3}
            fontSize={9.5}
            fill="#636f6a"
            textAnchor="end"
            fontFamily="JetBrains Mono, monospace"
          >
            {durLabel}
          </text>
        )}
        <text
          x={W - padR}
          y={H - 3}
          fontSize={9.5}
          fill="#0369a1"
          textAnchor="end"
          fontFamily="JetBrains Mono, monospace"
        >
          {showSeparateStormTick ? `${totalLabel} ${drainWord}` : `${durLabel} → ${totalLabel} ${drainWord}`}
        </text>
      </svg>
    </div>
  );
}
