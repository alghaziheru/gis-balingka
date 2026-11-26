interface BrandMarkProps {
  className?: string;
}

/**
 * Peta Alur Air mark: terrain contour arcs traversed by a central water channel.
 */
export function BrandMark({ className = 'h-5 w-5' }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M6.5 12.5Q16 7.5 25.5 12.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M6.5 20.5Q10.5 18.4 13 19"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.65"
      />
      <path
        d="M19.2 19.6Q22.2 18.6 25.5 20.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.65"
      />
      <path
        d="M17 6.5C11.5 11.5 20.5 17 14.5 25.5"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
