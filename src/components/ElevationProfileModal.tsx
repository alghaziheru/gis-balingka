import { useState } from 'react';
import { useT } from '../context/RegionContext';
import type { ElevationProfileResult, Language, ProfileSample } from '../types/gis';

interface ElevationProfileModalProps {
  lang: Language;
  profile: ElevationProfileResult | null;
  sidebarCollapsed: boolean;
  onHoverSample: (sample: ProfileSample | null) => void;
  onClose: () => void;
}

export function ElevationProfileModal({
  lang,
  profile,
  sidebarCollapsed,
  onHoverSample,
  onClose
}: ElevationProfileModalProps) {
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; dist: number; elev: number } | null>(null);
  const t = useT(lang);
  if (!profile) return null;
  const { samples, totalDistM, minElev, maxElev, maxSlopePct } = profile;

  const W = 600;
  const H = 132;
  const padL = 42;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const span = Math.max(15, maxElev - minElev);
  const eLo = Math.floor(minElev - span * 0.1);
  const eHi = Math.ceil(maxElev + span * 0.1);
  const maxDist = samples[samples.length - 1]?.dist || 1;

  const toX = (d: number) => padL + (d / maxDist) * plotW;
  const toY = (e: number) => padT + (1 - (e - eLo) / (eHi - eLo)) * plotH;

  const polylinePts = samples.map(s => `${toX(s.dist).toFixed(1)},${toY(s.elev).toFixed(1)}`).join(' ');
  const areaPts = `${padL},${padT + plotH} ${polylinePts} ${padL + plotW},${padT + plotH}`;

  return (
    <div
      className={`surface-panel absolute right-16 bottom-14 z-17 flex max-w-[680px] flex-col gap-2 rounded-2xl px-4 py-3 transition-all max-md:right-2 max-md:bottom-[154px] max-md:left-2 ${
        sidebarCollapsed ? 'left-4' : 'left-[404px]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-[13.5px] font-bold text-[#161c1a]">{t.profTitle}</strong>
        <div className="font-mono-num flex flex-wrap gap-3 text-[12px] text-[#434d49]">
          <span>{Math.round(totalDistM)} m</span>
          <span>
            {Math.round(minElev)}–{Math.round(maxElev)} mdpl
          </span>
          <span>
            {t.slopeWord} Maks: {maxSlopePct.toFixed(1)}%
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[32px] rounded-lg border border-[#161c1a]/15 bg-white px-3 py-1 text-[12px] font-semibold text-[#161c1a] hover:bg-[#f2f3ef]"
        >
          {t.close}
        </button>
      </div>

      <div className="relative h-[132px] w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-full w-full cursor-crosshair"
          onMouseMove={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * W;
            const frac = Math.max(0, Math.min(1, (relX - padL) / plotW));
            const idx = Math.min(samples.length - 1, Math.round(frac * (samples.length - 1)));
            const s = samples[idx];
            if (!s) return;
            setHoverInfo({ x: toX(s.dist), y: toY(s.elev), dist: s.dist, elev: s.elev });
            onHoverSample(s);
          }}
          onMouseLeave={() => {
            setHoverInfo(null);
            onHoverSample(null);
          }}
        >
          {[0, 0.5, 1].map(fr => {
            const y = padT + fr * plotH;
            const eVal = Math.round(eHi - fr * (eHi - eLo));
            return (
              <g key={fr}>
                <line
                  x1={padL}
                  y1={y}
                  x2={padL + plotW}
                  y2={y}
                  stroke="rgba(22,28,26,0.12)"
                  strokeDasharray="3 3"
                />
                <text x={padL - 5} y={y + 3} textAnchor="end" fontSize="9.5" fill="#636f6a" fontFamily="monospace">
                  {eVal}m
                </text>
              </g>
            );
          })}
          <polygon points={areaPts} fill="rgba(3,105,161,0.14)" />
          <polyline points={polylinePts} fill="none" stroke="#0369a1" strokeWidth="2.5" strokeLinejoin="round" />
          {hoverInfo && (
            <>
              <line
                x1={hoverInfo.x}
                y1={padT}
                x2={hoverInfo.x}
                y2={padT + plotH}
                stroke="#161c1a"
                strokeWidth="1.2"
                strokeDasharray="3 2"
              />
              <circle cx={hoverInfo.x} cy={hoverInfo.y} r="4.2" fill="#b91c1c" stroke="#ffffff" strokeWidth="1.5" />
            </>
          )}
          <text x={padL} y={H - 5} fontSize="9.5" fill="#636f6a" fontFamily="monospace">
            A · 0 m
          </text>
          <text x={padL + plotW} y={H - 5} textAnchor="end" fontSize="9.5" fill="#636f6a" fontFamily="monospace">
            B · {Math.round(maxDist)} m
          </text>
        </svg>
        {hoverInfo && (
          <div className="font-mono-num pointer-events-none absolute top-1 right-1.5 rounded-md bg-[#161c1a] px-2.5 py-0.5 text-[11.5px] font-bold text-white">
            {Math.round(hoverInfo.dist)} m · {Math.round(hoverInfo.elev)} mdpl
          </div>
        )}
      </div>
    </div>
  );
}
