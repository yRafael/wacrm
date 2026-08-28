// ============================================================
// FirePlayLogo — SVG logo for the auth panel hero
//
// Phoenix + metallic ring + "FIRE" (chrome) + "PLAY" (orange/gold).
// Designed for large display on the auth left panel.
// ============================================================

interface FirePlayLogoProps {
  className?: string;
  width?: number;
  height?: number;
}

export function FirePlayLogo({ className, width = 280, height = 200 }: FirePlayLogoProps) {
  return (
    <svg
      viewBox="0 0 280 200"
      width={width}
      height={height}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Fire Play"
    >
      <defs>
        {/* Fire gradient: deep red → orange → gold */}
        <linearGradient id="fire-gradient" x1="140" y1="20" x2="140" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF4500" />
          <stop offset="40%" stopColor="#FF6B29" />
          <stop offset="80%" stopColor="#F5A623" />
          <stop offset="100%" stopColor="#FFB627" />
        </linearGradient>

        {/* Inner fire glow */}
        <radialGradient id="fire-glow" cx="140" cy="70" r="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFB627" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#FF4500" stopOpacity="0" />
        </radialGradient>

        {/* Metallic ring gradient */}
        <linearGradient id="ring-gradient" x1="90" y1="50" x2="190" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E8E8E8" />
          <stop offset="30%" stopColor="#C7C7C7" />
          <stop offset="50%" stopColor="#F0F0F0" />
          <stop offset="70%" stopColor="#A0A0A0" />
          <stop offset="100%" stopColor="#D0D0D0" />
        </linearGradient>

        {/* FIRE text chrome gradient */}
        <linearGradient id="chrome-gradient" x1="70" y1="130" x2="170" y2="130" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E8E8E8" />
          <stop offset="50%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#C0C0C0" />
        </linearGradient>

        {/* PLAY text fire gradient */}
        <linearGradient id="play-gradient" x1="155" y1="130" x2="230" y2="130" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF6B29" />
          <stop offset="100%" stopColor="#F5A623" />
        </linearGradient>

        {/* Drop shadow filter */}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Phoenix body — abstract wing/flame shape */}
      <g transform="translate(140, 65)" filter="url(#glow)">
        {/* Left wing */}
        <path
          d="M-8,-45 C-30,-30 -50,-10 -45,15 C-42,30 -25,40 -8,35"
          fill="url(#fire-gradient)"
          opacity="0.95"
        />
        {/* Right wing */}
        <path
          d="M8,-45 C30,-30 50,-10 45,15 C42,30 25,40 8,35"
          fill="url(#fire-gradient)"
          opacity="0.95"
        />
        {/* Center body */}
        <path
          d="M0,-50 C-12,-35 -15,-10 -12,15 C-10,30 -5,40 0,42 C5,40 10,30 12,15 C15,-10 12,-35 0,-50Z"
          fill="url(#fire-gradient)"
        />
        {/* Inner glow */}
        <ellipse cx="0" cy="-5" rx="12" ry="25" fill="url(#fire-glow)" />
        {/* Head/flame tip */}
        <path
          d="M0,-50 C-5,-58 -3,-65 0,-68 C3,-65 5,-58 0,-50Z"
          fill="#FFB627"
        />
      </g>

      {/* Metallic ring around phoenix */}
      <circle
        cx="140"
        cy="65"
        r="52"
        stroke="url(#ring-gradient)"
        strokeWidth="3"
        fill="none"
        opacity="0.7"
      />

      {/* Subtle ring highlight */}
      <circle
        cx="140"
        cy="65"
        r="52"
        stroke="white"
        strokeWidth="1"
        fill="none"
        opacity="0.15"
      />

      {/* Text: FIRE (chrome) + PLAY (fire gradient) */}
      <text
        x="140"
        y="148"
        textAnchor="middle"
        fontFamily="'Inter', 'SF Pro Display', -apple-system, sans-serif"
        fontWeight="800"
        fontSize="42"
        letterSpacing="6"
      >
        <tspan fill="url(#chrome-gradient)">FIRE</tspan>
        <tspan fill="url(#play-gradient)"> PLAY</tspan>
      </text>

      {/* Subtle underline accent */}
      <rect x="85" y="155" width="110" height="2" rx="1" fill="url(#play-gradient)" opacity="0.5" />
    </svg>
  );
}

/**
 * Simplified fire mark for small contexts (favicon, sidebar icon).
 * Just the flame silhouette, no text or ring.
 */
export function FireMarkIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M12 2C8 7 4 10 4 15a8 8 0 0016 0c0-5-4-8-8-13z"
        fill="url(#mark-fire)"
      />
      <path
        d="M12 8c-2 3-4 5-4 8a4 4 0 008 0c0-3-2-5-4-8z"
        fill="#FFB627"
        opacity="0.7"
      />
      <defs>
        <linearGradient id="mark-fire" x1="12" y1="2" x2="12" y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF4500" />
          <stop offset="100%" stopColor="#F5A623" />
        </linearGradient>
      </defs>
    </svg>
  );
}
