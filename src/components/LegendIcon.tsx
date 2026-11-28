export type LegendIconKind =
  | 'waterway'
  | 'simWaterways'
  | 'canal'
  | 'bridge'
  | 'culvert'
  | 'structure'
  | 'crossing'
  | 'evacuation'
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
  simPalette?: boolean;
}

export function LegendIcon({ kind, size = 18, simPalette = false }: LegendIconProps) {
  if (kind === 'waterway') {
    if (simPalette) {
      return (
        <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
          <line x1="1" y1="7" x2="17" y2="7" stroke="#0f2d42" strokeOpacity="0.5" strokeWidth="5" strokeLinecap="round" />
          <line x1="1" y1="7" x2="17" y2="7" stroke="#1b4d6e" strokeWidth="3.6" strokeLinecap="round" />
        </svg>
      );
    }
    return (
      <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
        <line x1="1" y1="7" x2="17" y2="7" stroke="#0369a1" strokeWidth="4" strokeLinecap="round" />
        <path
          d="M7.5 4.5L11 7L7.5 9.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'simWaterways') {
    return (
      <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
        <path d="M1 8.5 Q7 8.5 17 7.5" fill="none" stroke="#1b5270" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M4.5 2.5 Q7 5.5 9.5 8" fill="none" stroke="#3a7a99" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M11 2 Q12.5 5 13.5 7.8" fill="none" stroke="#538ca6" strokeWidth="0.95" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'canal') {
    return (
      <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
        <line x1="1" y1="7" x2="17" y2="7" stroke="#0d9488" strokeWidth="3.2" strokeLinecap="round" />
        <path
          d="M7.5 4.7L10.7 7L7.5 9.3"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
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
    return (
      <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
        <path
          d="M1 4.5Q5.5 1.5 9.5 4T17 3.5"
          fill="none"
          stroke="#78350f"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M1 10Q5.5 7 9.5 9.5T17 9"
          fill="none"
          stroke="#b45309"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    );
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
    if (simPalette) {
      return (
        <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
          <line x1="1" y1="7" x2="17" y2="7" stroke="#4a4843" strokeWidth="4.4" strokeLinecap="round" />
          <line x1="2" y1="7" x2="10" y2="7" stroke="#d8c79e" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="10" y1="7" x2="16" y2="7" stroke="#cfc9be" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    }
    return (
      <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
        <line x1="1" y1="7" x2="17" y2="7" stroke="#161c1a" strokeWidth="5.4" strokeLinecap="round" />
        <line x1="2" y1="7" x2="10" y2="7" stroke="#fde047" strokeWidth="2.4" strokeLinecap="round" />
        <line x1="10" y1="7" x2="16" y2="7" stroke="#ffffff" strokeWidth="2.0" strokeLinecap="round" />
      </svg>
    );
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

  if (kind === 'landslide') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="24" height="24" rx="6" fill="#b45309" stroke="#ffffff" strokeWidth="2" />
        <path d="M7.5 19.5L13 9.5L20.5 19.5Z" fill="none" stroke="#ffffff" strokeWidth="2.1" strokeLinejoin="round" />
        <line x1="16.5" y1="9" x2="21.5" y2="15.5" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" />
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
    if (simPalette) {
      return (
        <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
          <line
            x1="1.5"
            y1="7"
            x2="16.5"
            y2="7"
            stroke="#5b7f95"
            strokeWidth="2.0"
            strokeDasharray="3.5 2.2"
            strokeLinecap="round"
          />
        </svg>
      );
    }
    return (
      <svg width={18} height={14} viewBox="0 0 18 14" className="shrink-0" aria-hidden="true">
        <line
          x1="1"
          y1="7"
          x2="17"
          y2="7"
          stroke="#082f49"
          strokeWidth="4.6"
          strokeLinecap="round"
        />
        <line
          x1="1.5"
          y1="7"
          x2="16.5"
          y2="7"
          stroke="#22d3ee"
          strokeWidth="2.2"
          strokeDasharray="3.5 2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === 'agamForest') {
    return (
      <span
        className="inline-block h-3.5 w-4 shrink-0 rounded-[3px] border-[1.5px] border-dashed border-[#15803d] bg-[#22c55e]/25"
        aria-hidden="true"
      />
    );
  }

  if (kind === 'agamSoil') {
    return (
      <span
        className="inline-block h-3.5 w-4 shrink-0 rounded-[3px] border-[1.5px] border-[#92400e] bg-[#f59e0b]/28"
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
