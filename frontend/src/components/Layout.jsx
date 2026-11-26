import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { initials, sectionOf, SECTIONS } from '../nav.js';
import { Brand } from './Brand.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import SearchPalette from './SearchPalette.jsx';

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const menuRef = useRef(null);
  const { pathname } = useLocation();
  const { user, company, can, features, logout } = useAuth();

  useEffect(() => { setOpen(false); setMenu(false); }, [pathname]);

  // Ctrl/Cmd+K opens search; clicking outside closes the user menu.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); }
    };
    const onClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);

  // Sections and tabs this user may open.
  const sections = SECTIONS
    .map((s) => ({ ...s, tabs: s.tabs.filter((t) => (t.module === 'any' || can(t.module)) && (!t.feature || features[t.feature])) }))
    .filter((s) => s.tabs.length > 0);
  const current = sectionOf(pathname);
  const visible = sections.find((s) => s.key === current?.key);
  const cityLine = (company?.address || '').split('\n').filter(Boolean).pop();

  return (
    <div className="app-shell">
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Main">
        <Brand company={company} />
        <div className="nav-eyebrow">Workspace</div>
        <div className="sidebar-nav">
          {sections.map((s) => (
            <NavLink key={s.key} to={s.tabs[0].to} end={s.key === 'dashboard'}
              className={() => `nav-link ${visible?.key === s.key ? 'active' : ''}`}>
              <i className={`fas ${s.icon}`} />{s.label}
            </NavLink>
          ))}
        </div>
        <div className="sidebar-promo">
          <div className="sun" />
          <div style={{ position: 'relative' }}>Powering smarter<br />solar businesses</div>
        </div>
        <Link to={can('admin') ? '/company' : '/account'} className="sidebar-company" title="Company">
          <span className="avatar square">{initials(company?.name)}</span>
          <span className="min-w-0">
            <span className="d-block fw-semibold small text-truncate">{company?.name}</span>
            {cityLine && <span className="d-block small text-truncate" style={{ opacity: 0.6, fontSize: '0.72rem' }}>{cityLine}</span>}
          </span>
        </Link>
      </nav>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}

      <div className="main-area">
        <header className="topbar">
          <button type="button" className="btn btn-link text-dark d-lg-none p-0" aria-label="Open menu" onClick={() => setOpen(true)}>
            <i className="fas fa-bars fa-lg" />
          </button>
          <div className="crumbs"><span>Workspace</span><span className="sep">/</span><b>{company?.name}</b></div>
          <button type="button" className="search-trigger" onClick={() => setSearch(true)}>
            <i className="fas fa-search" /><span className="text-truncate">Search customers, quotes, products…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="position-relative" ref={menuRef}>
            <button type="button" className="user-chip" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              <span className="avatar">{initials(user?.name)}</span>
              <span className="d-none d-md-block lh-sm">
                <span className="d-block small fw-semibold">{user?.name}</span>
                <span className="d-block text-muted" style={{ fontSize: '0.72rem' }}>{user?.role_label}</span>
              </span>
              <i className="fas fa-chevron-down small text-muted d-none d-md-block" />
            </button>
            {menu && (
              <div className="user-menu" role="menu">
                <div className="px-3 py-2 small text-muted border-bottom mb-1 text-truncate">{user?.email}</div>
                <Link to="/account" role="menuitem"><i className="fas fa-user fa-fw" />My account</Link>
                <button type="button" role="menuitem" onClick={logout}><i className="fas fa-right-from-bracket fa-fw" />Log out</button>
              </div>
            )}
          </div>
        </header>

        <main className="main-content">
          {visible && <div className="eyebrow mb-1">Afritech / <b>{visible.label}</b></div>}
          {visible && visible.tabs.length > 1 && (
            <nav className="section-tabs" aria-label={`${visible.label} sections`}>
              {visible.tabs.map((t) => (
                <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>
              ))}
            </nav>
          )}
          <ErrorBoundary key={pathname}><Outlet /></ErrorBoundary>
        </main>
      </div>
      {search && <SearchPalette onClose={() => setSearch(false)} />}
    </div>
  );
}
