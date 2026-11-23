import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  text: string;
  label?: string;
  className?: string;
}

interface TooltipPosition {
  top: number;
  left: number;
  placement: 'top' | 'bottom';
  arrowLeft: number;
}

export function InfoTooltip({ text, label, className = '' }: InfoTooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<TooltipPosition | null>(null);

  const isOpen = hovered || focused || pinned;

  const closeAll = useCallback(() => {
    setPinned(false);
    setHovered(false);
    setFocused(false);
  }, []);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    const tipEl = tooltipRef.current;
    if (!triggerEl || !tipEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const tipRect = tipEl.getBoundingClientRect();
    const margin = 12;
    const gap = 8;

    let placement: 'top' | 'bottom' = 'top';
    let top = triggerRect.top - tipRect.height - gap;
    if (top < 8) {
      placement = 'bottom';
      top = triggerRect.bottom + gap;
    }

    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const maxLeft = Math.max(margin, window.innerWidth - tipRect.width - margin);
    const left = Math.min(maxLeft, Math.max(margin, triggerCenterX - tipRect.width / 2));
    const arrowLeft = Math.min(tipRect.width - 12, Math.max(12, triggerCenterX - left));

    setPos({ top, left, placement, arrowLeft });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPos(null);
      return;
    }
    updatePosition();
  }, [isOpen, text, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target)) return;
      closeAll();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAll();
      }
    };

    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && tooltipRef.current?.contains(target)) return;
      closeAll();
    };

    const onResize = () => {
      updatePosition();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, closeAll, updatePosition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label ? `${label} info` : 'More information'}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          setPinned(prev => !prev);
        }}
        className={`inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[#636f6a] transition hover:bg-[#161c1a]/8 hover:text-[#0369a1] focus-visible:text-[#0369a1] ${
          isOpen ? 'bg-[#161c1a]/8 text-[#0369a1]' : ''
        } ${className}`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={
              pos
                ? { position: 'fixed', top: pos.top, left: pos.left }
                : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }
            }
            className="pointer-events-auto z-[90] w-max max-w-[min(260px,calc(100vw-24px))] rounded-lg border border-white/12 bg-[#161c1a] px-2.5 py-2 text-[12px] leading-snug font-normal text-[#fafaf8] shadow-md"
          >
            <span>{text}</span>
            {pos && (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute h-2 w-2 rotate-45 bg-[#161c1a] ${
                  pos.placement === 'top'
                    ? '-bottom-1 border-r border-b border-white/12'
                    : '-top-1 border-t border-l border-white/12'
                }`}
                style={{ left: pos.arrowLeft - 4 }}
              />
            )}
          </div>,
          document.body
        )}
    </>
  );
}
