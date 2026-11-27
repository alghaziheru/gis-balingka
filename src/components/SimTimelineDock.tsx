import { Pause, Play, RotateCcw } from 'lucide-react';
import { useT } from '../context/RegionContext';
import type { PlaybackSpeed } from '../hooks/useSimulationController';
import type { Language } from '../types/gis';
import { SimSpeedMenu } from './SimSpeedMenu';

interface SimTimelineDockProps {
  lang: Language;
  playing: boolean;
  playbackSpeed: PlaybackSpeed;
  progress: number;
  liveElapsedMin: number;
  mobileSheetMode: 'peek' | 'half' | 'full';
  onTogglePlay: () => void;
  onResetSim: () => void;
  onChangeProgress: (progress: number) => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
}

function formatClock(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function SimTimelineDock({
  lang,
  playing,
  playbackSpeed,
  progress,
  liveElapsedMin,
  mobileSheetMode,
  onTogglePlay,
  onResetSim,
  onChangeProgress,
  onChangeSpeed
}: SimTimelineDockProps) {
  const t = useT(lang);
  const isAtEnd = !playing && progress >= 0.99;

  if (mobileSheetMode !== 'peek') return null;

  const clampedPct = Math.round(Math.max(0, Math.min(1, progress)) * 1000) / 10;

  return (
    <div
      data-testid="sim-mobile-transport"
      className="surface-panel pointer-events-auto fixed right-[112px] bottom-[138px] left-2.5 z-19 hidden items-center gap-1.5 rounded-full px-2 py-1.5 shadow-md max-md:flex"
    >
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? t.pause : isAtEnd ? t.simReplay : t.play}
        className={`btn-tactile grid h-8 w-8 shrink-0 place-items-center rounded-full text-white ${
          playing ? 'bg-[#161c1a]' : 'bg-[#0369a1]'
        }`}
      >
        {playing ? (
          <Pause className="h-3.5 w-3.5" />
        ) : isAtEnd ? (
          <RotateCcw className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5 translate-x-[0.5px]" />
        )}
      </button>

      <div className="relative flex min-w-0 flex-1 items-center">
        <div className="pointer-events-none absolute inset-x-0 h-[3px] rounded-full bg-[#161c1a]/15">
          <div
            className="h-full rounded-full bg-[#0369a1]"
            style={{ width: `${clampedPct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(progress * 100)}
          onChange={e => onChangeProgress(parseInt(e.target.value, 10) / 100)}
          aria-label={t.lblTimeline}
          className="sim-range-input"
        />
      </div>

      <span className="font-mono-num shrink-0 text-[11px] font-bold text-[#161c1a]">
        {formatClock(liveElapsedMin)}
      </span>

      <SimSpeedMenu
        speed={playbackSpeed}
        onSelect={onChangeSpeed}
        lang={lang}
        placement="up"
        compact
        testId="sim-mobile-speed-btn"
      />

      <button
        type="button"
        onClick={onResetSim}
        disabled={progress === 0 && !playing}
        aria-label={t.simReset}
        className="btn-tactile grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#434d49] hover:bg-[#f2f3ef] disabled:opacity-35"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
