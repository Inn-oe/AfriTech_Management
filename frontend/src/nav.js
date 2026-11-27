// Sidebar structure. Each section has tabs; a tab is shown only if the user's role allows it
// (the server enforces the same rules, see auth.py). `module` 'any' = every logged-in user.
export const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'fa-table-cells-large', tabs: [{ to: '/', label: 'Overview', module: 'dashboard', end: true }] },
  { key: 'customers', label: 'Customers', icon: 'fa-user-group', tabs: [{ to: '/customers', label: 'Customers', module: 'customers' }] },
  {
    key: 'whatsapp', label: 'WhatsApp', icon: 'fa-comments',
    tabs: [
      { to: '/enquiries', label: 'Enquiries', module: 'customers', feature: 'whatsapp' },
      { to: '/whatsapp', label: 'Potential clients', module: 'customers', feature: 'whatsapp' },
    ],
  },
  {
    key: 'sales', label: 'Sales & Quotes', icon: 'fa-file-lines',
    tabs: [
      { to: '/quotations', label: 'Quotations', module: 'sales' },
      { to: '/invoices', label: 'Invoices', module: 'sales' },
    ],
  },
  {
    key: 'inventory', label: 'Inventory', icon: 'fa-cube',
    tabs: [
      { to: '/inventory', label: 'Products', module: 'inventory' },
      { to: '/suppliers', label: 'Suppliers', module: 'inventory' },
      { to: '/pricing', label: 'Service prices', module: 'inventory' },
    ],
  },
  {
    key: 'projects', label: 'Projects & Installations', icon: 'fa-screwdriver-wrench',
    tabs: [
      { to: '/projects', label: 'Project board', module: 'operations' },
      { to: '/activities', label: 'All jobs', module: 'operations' },
      { to: '/fuel', label: 'Fuel', module: 'operations' },
      { to: '/mileage', label: 'Mileage', module: 'operations' },
      { to: '/journeys', label: 'Journeys', module: 'operations' },
    ],
  },
  {
    key: 'finance', label: 'Finance & Payments', icon: 'fa-credit-card',
    tabs: [
      { to: '/financial', label: 'Income & expenses', module: 'finance' },
      { to: '/payments', label: 'Payments', module: 'sales' },
    ],
  },
  {
    key: 'shop', label: 'Online shop', icon: 'fa-store',
    tabs: [
      { to: '/shop-orders', label: 'Shop orders', module: 'admin', feature: 'operator' },
      { to: '/shop-products', label: 'Shop products', module: 'admin', feature: 'operator' },
      { to: '/shop-settings', label: 'Shop settings', module: 'admin', feature: 'operator' },
    ],
  },
  { key: 'reports', label: 'Reports & Analytics', icon: 'fa-chart-column', tabs: [{ to: '/reports', label: 'Reports', module: 'finance' }] },
  {
    key: 'settings', label: 'Settings', icon: 'fa-gear',
    tabs: [
      { to: '/company', label: 'Company profile', module: 'admin' },
      { to: '/team', label: 'Team & roles', module: 'admin' },
      { to: '/activity-log', label: 'Activity log', module: 'admin' },
      { to: '/activity-types', label: 'Job types', module: 'operations' },
      { to: '/financial-categories', label: 'Finance categories', module: 'finance' },
      { to: '/locations', label: 'Locations', module: 'operations' },
      { to: '/platform-usage', label: 'Platform usage', module: 'any', feature: 'operator' },
      { to: '/account', label: 'My account', module: 'any' },
    ],
  },
];

// Extra paths that belong to a section (document pages under /quotations/…, /invoices/…).
const PREFIXES = { sales: ['/quotations', '/invoices'], customers: ['/customers'] };

export function sectionOf(pathname) {
  const hit = SECTIONS.find((s) => s.tabs.some((t) => (t.end ? pathname === t.to : pathname === t.to || pathname.startsWith(`${t.to}/`)))
    || (PREFIXES[s.key] || []).some((p) => pathname.startsWith(p)));
  return hit || null;
}

export const initials = (text) => String(text || '?')
  .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
