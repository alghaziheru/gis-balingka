export type LegendIconKind =
  | 'waterway'
  | 'canal'
  | 'bridge'
  | 'culvert'
  | 'structure'
  | 'crossing'
  | 'evacuation'
  | 'bronjong'
  | 'landslide'
  | 'landCover'
  | 'scourChange'
  | 'agamLandslide'
  | 'agamRbi'
  | 'agamForest'
  | 'agamSoil'
  | 'settlements'
  | 'flow'
  | 'das'
  | 'hillshade'
  | 'contour'
  | 'slope'
  | 'osm';

interface LegendIconProps {
  kind: LegendIconKind;
  size?: number;
}

export function LegendIcon({ kind, size = 18 }: LegendIconProps) {
  if (kind === 'waterway') {
    return (
      <span
        className="inline-block h-[4px] w-4 shrink-0 rounded-full bg-[#0369a1] ring-1 ring-black/10"
        aria-hidden="true"
      />
    );
  }
  if (kind === 'canal') {
    return (
      <span
        className="inline-block h-[3px] w-4 shrink-0 rounded-full bg-[#0d9488]"
        aria-hidden="true"
      />
    );
  }
  if (kind === 'flow') {
    return (
      <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
        <line
          x1="1"
          y1="7"
          x2="13"
          y2="7"
          stroke="#b45309"
          strokeWidth="2.2"
          strokeDasharray="3 2"
          strokeLinecap="round"
        />
        <path
          d="M11 3.5L15.5 7L11 10.5"
          fill="none"
          stroke="#b45309"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'das') {
    return (
      <span
        className="inline-block h-3.5 w-4 shrink-0 rounded-[3px] border-2 border-dashed border-[#14532d] bg-[#14532d]/10"
        aria-hidden="true"
      />
    );
  }
  if (kind === 'contour') {
    return <span className="inline-block h-[2px] w-4 shrink-0 rounded-full bg-[#b45309]" aria-hidden="true" />;
  }
  if (kind === 'slope') {
    return (
      <span
        className="inline-block h-3 w-4 shrink-0 rounded-[3px] border border-black/15"
        style={{ background: 'linear-gradient(90deg,#f59e0b,#c2410c)' }}
        aria-hidden="true"
      />
    );
  }
  if (kind === 'osm') {
    return <span className="inline-block h-[2.5px] w-4 shrink-0 rounded-full bg-[#475569]" aria-hidden="true" />;
  }
  if (kind === 'hillshade') {
    return (
      <span
        className="inline-block h-3 w-4 shrink-0 rounded-[3px] border border-black/15 bg-[#64748b]"
        aria-hidden="true"
      />
    );
  }

  // Rounded-square cartographic badge icons matching MapLibre sprites 1:1
  if (kind === 'bridge' || kind === 'structure') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#047857" stroke="#ffffff" strokeWidth="2" />
        <path
          d="M7 10.5L9.5 13.5H18.5L21 10.5M9.5 13.5V20M18.5 13.5V20"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === 'culvert') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#047857" stroke="#ffffff" strokeWidth="2" />
        <path d="M8 20.5V16.5A6 6 0 0 1 20 16.5V20.5Z" fill="#ffffff" />
      </svg>
    );
  }

  if (kind === 'crossing') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#475569" stroke="#ffffff" strokeWidth="2" />
        <path
          d="M8 10L20 18M8 18L20 10"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <circle cx="14" cy="14" r="2.6" fill="#e2e8f0" stroke="#475569" strokeWidth="1.2" />
      </svg>
    );
  }

  if (kind === 'evacuation') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#047857" stroke="#ffffff" strokeWidth="2" />
        <path
          d="M7.5 14L14 8L20.5 14H18V20H10V14Z"
          fill="#ffffff"
        />
      </svg>
    );
  }

  if (kind === 'bronjong') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#0369a1" stroke="#ffffff" strokeWidth="2" />
        <rect x="7" y="16" width="14" height="4" rx="1" fill="#ffffff" />
        <rect x="9" y="10.5" width="10" height="4" rx="1" fill="#ffffff" />
      </svg>
    );
  }

  if (kind === 'landslide') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#c2410c" stroke="#ffffff" strokeWidth="2" />
        <path d="M14 7.5L21 19.5H7Z" fill="#ffffff" />
        <line x1="14" y1="12" x2="14" y2="15.5" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" />
        <circle cx="14" cy="17.6" r="1.1" fill="#c2410c" />
      </svg>
    );
  }

  if (kind === 'landCover') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#15803d" stroke="#ffffff" strokeWidth="2" />
        <path d="M14 7L19.5 14.5H16.5L20 19H8L11.5 14.5H8.5Z" fill="#ffffff" />
        <rect x="12.8" y="19" width="2.4" height="3" fill="#ffffff" />
      </svg>
    );
  }

  if (kind === 'scourChange') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#991b1b" stroke="#ffffff" strokeWidth="2" />
        <path
          d="M7 11.5Q10.5 9 14 11.5T21 11.5M7 16.5Q10.5 14 14 16.5T21 16.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === 'agamLandslide') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#b91c1c" stroke="#ffffff" strokeWidth="2" />
        <path d="M6.5 19.5L12.5 9.5L17 15.5L21.5 19.5Z" fill="#ffffff" />
      </svg>
    );
  }

  if (kind === 'agamRbi') {
    return (
      <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
        <line
          x1="1"
          y1="7"
          x2="17"
          y2="7"
          stroke="#0e7490"
          strokeWidth="2.4"
          strokeDasharray="4 2.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === 'agamForest') {
    return (
      <span
        className="inline-block h-3.5 w-4 shrink-0 rounded-[3px] border border-[#166534] bg-[#166534]/25"
        aria-hidden="true"
      />
    );
  }

  if (kind === 'agamSoil') {
    return (
      <span
        className="inline-block h-3.5 w-4 shrink-0 rounded-[3px] border border-[#b45309] bg-[#b45309]/25"
        aria-hidden="true"
      />
    );
  }

  // settlements
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
      <rect x="2" y="2" width="24" height="24" rx="6" fill="#ea580c" stroke="#ffffff" strokeWidth="2" />
      <path d="M8 14L14 8.5L20 14V20H15.5V16H12.5V20H8Z" fill="#ffffff" />
    </svg>
  );
}
