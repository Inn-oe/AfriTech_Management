export const PRODUCT_NAME = 'SolarPilot';

/** The SolarPilot panel-and-sun mark on its own. */
export function SunMark({ size = 38 }) {
  return <img className="brand-mark" src="/solarpilot-mark.png" width={size} height={Math.round(size * 0.82)} alt="" aria-hidden="true" />;
}

/** The product name on the sign-in page; inside the app it shows the signed-in company's own logo and name. */
export function Brand({ to = '/', company = null }) {
  if (!company) {
    // The full SolarPilot logo is dark on transparent, so it sits on a white card over the dark panel.
    return (
      <a className="brand brand-product" href={to} title={PRODUCT_NAME}>
        <img src="/solarpilot-logo.png" alt="SolarPilot - Solar Business Management" />
      </a>
    );
  }
  return (
    <a className="brand" href={to} title={company.name}>
      {company.has_logo
        ? <span className="brand-logo"><img src={`/api/company/logo?v=${company.logo_v}`} alt="" /></span>
        : <span className="brand-logo"><img src="/solarpilot-mark.png" alt="" /></span>}
      <span className="brand-name brand-company">{company.name}</span>
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
