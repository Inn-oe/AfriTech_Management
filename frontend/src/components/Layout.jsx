import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

// `module` is the permission group needed to see the link (see auth.py on the server).
const NAV = [
  { to: '/', label: 'Dashboard', icon: 'fa-gauge-high', end: true, module: 'dashboard' },
  { section: 'Sales' },
  { to: '/customers', label: 'Customers', icon: 'fa-users', module: 'customers' },
  { to: '/quotations', label: 'Quotations', icon: 'fa-file-signature', module: 'sales' },
  { to: '/invoices', label: 'Invoices', icon: 'fa-file-invoice-dollar', module: 'sales' },
  { to: '/payments', label: 'Payments', icon: 'fa-money-bill-wave', module: 'sales' },
  { section: 'Operations' },
  { to: '/inventory', label: 'Inventory', icon: 'fa-boxes-stacked', module: 'inventory' },
  { to: '/suppliers', label: 'Suppliers', icon: 'fa-truck', module: 'inventory' },
  { to: '/activities', label: 'Activities', icon: 'fa-list-check', module: 'operations' },
  { to: '/financial', label: 'Financial', icon: 'fa-chart-line', module: 'finance' },
  { section: 'Fleet Tracking' },
  { to: '/fuel', label: 'Fuel', icon: 'fa-gas-pump', module: 'operations' },
  { to: '/mileage', label: 'Mileage', icon: 'fa-road', module: 'operations' },
  { to: '/journeys', label: 'Journeys', icon: 'fa-car', module: 'operations' },
  { section: 'Settings' },
  { to: '/activity-types', label: 'Activity Types', icon: 'fa-tags', module: 'operations' },
  { to: '/financial-categories', label: 'Financial Categories', icon: 'fa-folder-tree', module: 'finance' },
  { to: '/locations', label: 'Locations', icon: 'fa-location-dot', module: 'operations' },
  { to: '/pricing', label: 'Pricing', icon: 'fa-dollar-sign', module: 'inventory' },
  { section: 'Company' },
  { to: '/company', label: 'Company Profile', icon: 'fa-building', module: 'admin' },
  { to: '/team', label: 'Team & Roles', icon: 'fa-user-shield', module: 'admin' },
  { to: '/activity-log', label: 'Activity Log', icon: 'fa-clock-rotate-left', module: 'admin' },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { user, company, can, logout } = useAuth();

  useEffect(() => setOpen(false), [pathname]);

  // Keep only links the user may open, then drop section titles left with nothing under them.
  const visible = NAV.filter((item) => item.section || can(item.module));
  const items = visible.filter((item, i) => !item.section || (visible[i + 1] && !visible[i + 1].section));

  return (
    <div className="app-shell">
      <nav className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-header text-center">
          <i className="fas fa-solar-panel fa-2x text-warning mb-2" />
          <div className="fw-bold text-white text-break">{company?.name}</div>
        </div>
        <div className="sidebar-nav">
          {items.map((item) =>
            item.section ? (
              <div key={item.section} className="nav-section">{item.section}</div>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                <i className={`fas ${item.icon} fa-fw me-3`} />
                {item.label}
              </NavLink>
            ),
          )}
        </div>
        <div className="sidebar-footer d-flex align-items-center gap-2">
          <NavLink to="/account" className="flex-grow-1 min-w-0 text-decoration-none text-reset" title="My account">
            <div className="text-white text-truncate">{user?.name}</div>
            <div className="text-truncate">{user?.role_label}</div>
          </NavLink>
          <button type="button" className="btn btn-sm btn-outline-light" onClick={logout} title="Log out" aria-label="Log out">
            <i className="fas fa-right-from-bracket" />
          </button>
        </div>
      </nav>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}

      <div className="main-area">
        <header className="topbar d-lg-none">
          <button type="button" className="btn btn-link text-dark" aria-label="Open menu" onClick={() => setOpen(true)}>
            <i className="fas fa-bars fa-lg" />
          </button>
          <span className="fw-semibold text-truncate">{company?.name}</span>
        </header>
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
