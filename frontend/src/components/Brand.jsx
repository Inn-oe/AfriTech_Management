export function SunMark({ size = 38 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g stroke="#f4b942" strokeWidth="4" strokeLinecap="round">
        <path d="M32 6v8M32 50v8M6 32h8M50 32h8M13.6 13.6l5.7 5.7M44.7 44.7l5.7 5.7M50.4 13.6l-5.7 5.7M19.3 44.7l-5.7 5.7" />
      </g>
      <circle cx="32" cy="32" r="11" fill="#f4b942" />
    </svg>
  );
}

export function Brand({ to = '/' }) {
  return (
    <a className="brand" href={to}>
      <SunMark />
      <span className="brand-name">Solar Business<br />Manager</span>
    </a>
  );
}

// Decorative tilted solar panel used on the login screen.
export function PanelArt() {
  const cells = [];
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 6; c += 1) cells.push(<rect key={`${r}-${c}`} x={12 + c * 62} y={12 + r * 52} width="56" height="46" rx="3" />);
  return (
    <svg className="panel-art" viewBox="0 0 400 180" aria-hidden="true">
      <rect x="0" y="0" width="400" height="180" rx="8" fill="#0b3556" stroke="#8fb8c6" strokeWidth="4" />
      <g fill="#14507a" stroke="#7fa9ba" strokeWidth="1.5">{cells}</g>
    </svg>
  );
}
