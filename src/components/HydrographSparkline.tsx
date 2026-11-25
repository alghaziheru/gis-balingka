import type { HydrographPoint, Language } from '../types/gis';

interface HydrographSparklineProps {
  lang: Language;
  points: HydrographPoint[];
  progress: number;
  durationMin: number;
  totalWindowMin: number;
  peakQ: number;
  peakQP10: number;
  peakQP90: number;
}

export function HydrographSparkline({
  lang,
  points,
  progress,
  durationMin,
  totalWindowMin,
  peakQ,
  peakQP10,
  peakQP90
}: HydrographSparklineProps) {
  const isEn = lang === 'en';
  if (!points || points.length < 2) return null;

  const W = 312;
  const H = 96;
  const padL = 6;
  const padR = 6;
  const padT = 8;
  const padB = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxRain = Math.max(15, ...points.map(p => p.rainMmHr));
  const maxQ = Math.max(5, ...points.map(p => Math.max(p.qP90, p.qBulkP50)));
  const safeTotal = Math.max(15, totalWindowMin);

  const xOfTime = (tMin: number) => padL + (Math.min(safeTotal, Math.max(0, tMin)) / safeTotal) * plotW;
  const yOfQ = (q: number) => padT + plotH - (Math.min(maxQ, Math.max(0, q)) / maxQ) * (plotH * 0.72);
  const rainBarH = (r: number) => (Math.min(maxRain, Math.max(0, r)) / maxRain) * (plotH * 0.28);

  const barW = Math.max(2, plotW / points.length - 1.5);

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
  const playheadX = padL + Math.max(0, Math.min(1, progress)) * plotW;
  const hasBulking = points.some(p => p.qBulkP50 > p.qP50 * 1.03);

  return (
    <div className="rounded-lg border border-[#161c1a]/10 bg-[#fafaf8] px-2.5 pt-2 pb-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] whitespace-nowrap">
        <span className="truncate font-semibold text-[#434d49]">
          {isEn ? 'Hydrograph (Q · P10–P90)' : 'Hidrograf (Q · P10–P90)'}
        </span>
        <span className="font-mono-num shrink-0 font-bold text-[#0369a1]">
          {peakQ.toFixed(1)} m³/s{' '}
          <span className="font-normal text-[#636f6a]">
            [{peakQP10.toFixed(0)}–{peakQP90.toFixed(0)}]
          </span>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[88px] w-full overflow-visible"
        role="img"
        aria-label={isEn ? 'Rainfall and routed river discharge hydrograph' : 'Grafik hujan dan debit limpasan sungai'}
      >
        {/* Recession shading zone after storm ends */}
        <rect
          x={stormEndX}
          y={padT}
          width={Math.max(0, W - padR - stormEndX)}
          height={plotH}
          fill="#161c1a"
          fillOpacity={0.04}
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
          return (
            <rect
              key={idx}
              x={Math.max(padL, x)}
              y={padT}
              width={barW}
              height={bh}
              rx={1}
              fill="#38bdf8"
              fillOpacity={0.55}
            />
          );
        })}

        {/* P10-P90 uncertainty envelope */}
        <path d={bandPath} fill="#0369a1" fillOpacity={0.16} />

        {/* Clear-water baseline (dashed) when sediment bulking separates Q_bulk from Q_water */}
        {hasBulking && (
          <path
            d={clearLine}
            fill="none"
            stroke="#0284c7"
            strokeWidth={1.25}
            strokeDasharray="3 2.5"
            strokeOpacity={0.75}
          />
        )}

        {/* Primary P50 routed bulk discharge curve */}
        <path d={bulkLine} fill="none" stroke="#0369a1" strokeWidth={2} strokeLinejoin="round" />

        {/* Storm-end divider */}
        <line
          x1={stormEndX}
          y1={padT}
          x2={stormEndX}
          y2={padT + plotH}
          stroke="#636f6a"
          strokeWidth={1}
          strokeDasharray="2 2"
        />

        {/* Live playhead */}
        {progress > 0.02 && (
          <line
            x1={playheadX}
            y1={padT - 2}
            x2={playheadX}
            y2={padT + plotH}
            stroke="#161c1a"
            strokeWidth={1.5}
          />
        )}

        {/* X-axis labels */}
        <text x={padL} y={H - 4} fontSize={9.5} fill="#636f6a" fontFamily="JetBrains Mono, monospace">
          0m
        </text>
        <text
          x={stormEndX - 4}
          y={H - 4}
          fontSize={9.5}
          fill="#636f6a"
          textAnchor="end"
          fontFamily="JetBrains Mono, monospace"
        >
          {durationMin}m
        </text>
        <text
          x={W - padR}
          y={H - 4}
          fontSize={9.5}
          fill="#0369a1"
          textAnchor="end"
          fontFamily="JetBrains Mono, monospace"
        >
          {totalWindowMin}m {isEn ? 'drain' : 'surut'}
        </text>
      </svg>
    </div>
  );
}
