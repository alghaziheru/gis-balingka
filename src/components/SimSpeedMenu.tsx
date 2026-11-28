import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { BASE_SIM_MINUTES_PER_SEC, PLAYBACK_SPEEDS, type PlaybackSpeed } from '../hooks/useSimulationController';
import type { Language } from '../types/gis';

interface SimSpeedMenuProps {
  speed: PlaybackSpeed;
  onSelect: (speed: PlaybackSpeed) => void;
  lang: Language;
  placement?: 'down' | 'up';
  compact?: boolean;
  testId?: string;
}

export function SimSpeedMenu({
  speed,
  onSelect,
  lang,
  placement = 'down',
  compact = false,
  testId = 'sim-speed-btn'
}: SimSpeedMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isEn = lang === 'en';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const Chevron = placement === 'up' ? ChevronUp : ChevronDown;
  const caption = isEn
    ? `1× = ${BASE_SIM_MINUTES_PER_SEC} min/s`
    : `1× = ${BASE_SIM_MINUTES_PER_SEC} mnt/dtk`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={isEn ? 'Playback speed' : 'Kecepatan simulasi'}
        title={isEn ? `Playback speed (${caption})` : `Kecepatan simulasi (${caption})`}
        className={
          compact
            ? 'btn-tactile font-mono-num inline-flex h-7 items-center gap-0.5 rounded-full border border-[#161c1a]/15 bg-[#fafaf8] px-2 text-[11px] font-bold text-[#161c1a] hover:border-[#0369a1]/40 hover:text-[#0369a1]'
            : 'btn-tactile font-mono-num inline-flex min-h-[34px] items-center gap-0.5 rounded-lg border border-[#161c1a]/15 bg-[#fafaf8] px-2 text-[11.5px] font-bold text-[#161c1a] hover:border-[#0369a1]/40 hover:text-[#0369a1]'
        }
      >
        <span>{speed}×</span>
        <Chevron className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={isEn ? 'Select playback speed' : 'Pilih kecepatan simulasi'}
          className={`surface-panel absolute z-30 w-[144px] rounded-xl p-2 shadow-lg ${
            placement === 'up' ? 'right-0 bottom-full mb-1.5' : 'left-0 top-full mt-1.5'
          }`}
        >
          <div className="font-mono-num mb-1.5 border-b border-[#161c1a]/10 pb-1 text-center text-[10px] font-semibold text-[#434d49]">
            {caption}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {PLAYBACK_SPEEDS.map(s => {
              const active = s === speed;
              return (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-testid={`${testId}-option-${s}`}
                  onClick={() => {
                    onSelect(s);
                    setOpen(false);
                  }}
                  className={`font-mono-num rounded-lg px-2 py-1 text-[11.5px] font-bold transition-colors ${
                    active
                      ? 'bg-[#0369a1] text-white'
                      : 'border border-[#161c1a]/10 bg-[#fafaf8] text-[#161c1a] hover:border-[#0369a1]/35 hover:bg-[#f2f3ef]'
                  }`}
                >
                  {s}×
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
