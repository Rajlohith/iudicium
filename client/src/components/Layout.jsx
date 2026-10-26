import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import Footer from './Footer.jsx';
import Icon from './Icon.jsx';

const TITLES = {
  '/': 'iudicium.',
  '/assistant': 'AI Assistant',
  '/search': 'Detailed Search',
  '/quick-search': 'Quick Search',
  '/account': 'Account',
  '/guide': 'Guide',
  '/faq': 'FAQ',
};

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { group: 'Tools' },
  { to: '/assistant', label: 'AI Assistant', icon: 'message-circle' },
  { to: '/search', label: 'Detailed Search', icon: 'search' },
  { to: '/quick-search', label: 'Quick Search', icon: 'zap' },
  { group: 'You' },
  { to: '/account', label: 'Account & history', icon: 'history' },
  { group: 'Help' },
  { to: '/guide', label: 'Guide', icon: 'book-open' },
  { to: '/faq', label: 'FAQ', icon: 'help-circle' },
];

const MOBILE_QUERY = '(max-width: 900px)';

export default function Layout() {
  const { connected } = useSocket();
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const title = TITLES[pathname] ?? 'iudicium.';

  useEffect(() => {
    document.title = pathname === '/' ? 'iudicium.' : `${title} — iudicium.`;
    window.scrollTo(0, 0);
  }, [pathname, title]);

  // The mobile menu closes on navigation, on Escape, and when the window grows back to desktop width.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => !media.matches && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    media.addEventListener('change', onChange);
    return () => {
      document.removeEventListener('keydown', onKey);
      media.removeEventListener('change', onChange);
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle('no-scroll', menuOpen);
    return () => document.body.classList.remove('no-scroll');
  }, [menuOpen]);

  return (
    <div className="app-shell">
      {/* Desktop: always collapsed, expands on hover (pure CSS). Mobile: off-canvas, opened by the hamburger. */}
      <aside className={`sidebar sidebar--collapsed${menuOpen ? ' sidebar--mobile-open' : ''}`}>
        <div className="sidebar__top">
          <div className="sidebar__brand">
            <span className="sidebar__logo-btn">
              <img className="sidebar__logo-svg" src="/iudicium-mark.svg" alt="iudicium logo" />
            </span>
            <NavLink to="/" className="sidebar__brand-name label">iudicium.</NavLink>
          </div>
        </div>
        <nav className="sidebar__nav">
          {NAV.map((item) =>
            item.group ? (
              <div key={item.group} className="sidebar__group-label sidebar__group-label--mt">
                <span className="label">{item.group}</span>
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
              >
                <Icon name={item.icon} />
                <span className="label">{item.label}</span>
              </NavLink>
            ),
          )}
        </nav>
      </aside>
      <div className={`sidebar-overlay${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} />

      <div className="app-main">
        <header className="topbar">
          <button
            type="button"
            className="topbar__menu-btn"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name="menu" />
          </button>
          <div className="topbar__title">
            <h1>{title}</h1>
          </div>
          <div className="topbar__right">
            <div className="topbar__status">
              <span className={`dot${connected ? ' connected' : ''}`} />
              <span>{connected ? 'Connected' : 'Reconnecting…'}</span>
            </div>
            <NavLink to="/account" className="topbar__user" title={user.email}>
              <Icon name="user" />
              <span className="topbar__user-name">{user.name}</span>
            </NavLink>
            <button type="button" className="topbar__signout" onClick={signOut} title="Sign out" aria-label="Sign out">
              <Icon name="log-out" />
            </button>
          </div>
        </header>

        <Outlet />
        <Footer />
      </div>
    </div>
  );
}
