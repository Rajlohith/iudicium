import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import Icon from './Icon.jsx';

const EMAILS = ['1337av@gmail.com', 'rajlohith3@protonmail.ch', 'nikhita.ananthas@gmail.com', 'roshmtt@gmail.com'];

export default function Footer() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const show = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  };

  return (
    <footer className="site-footer">
      <div className="site-footer__top">
        <Link to="/" className="site-footer__brand">
          <img className="site-footer__brand-svg" src="/iudicium-logo.svg" alt="iudicium logo" />
          iudicium.
        </Link>
        <div className="site-footer__links">
          <a href="https://judiciary.karnataka.gov.in/judgments.php" target="_blank" rel="noopener noreferrer" className="site-footer__link">
            Official Judgements Portal
          </a>
          <a href="https://github.com/Rajlohith/iudicium" target="_blank" rel="noopener noreferrer" className="site-footer__link">
            <Icon name="github" />
            GitHub Repository
          </a>
        </div>
        <div className="site-footer__contact" onMouseEnter={show} onMouseLeave={hideSoon}>
          <button
            type="button"
            className="site-footer__contact-btn"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation(); // touch fallback
              setOpen((o) => !o);
            }}
          >
            <Icon name="mail" />
            Contact
            <Icon name="chevron-down" className="contact-chevron" />
          </button>
          <div className={`site-footer__contact-panel${open ? ' open' : ''}`}>
            {EMAILS.map((email) => (
              <a key={email} href={`mailto:${email}`} className="site-footer__email">
                <Icon name="at-sign" />
                {email}
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="site-footer__bottom">
        <div className="site-footer__disclaimer">
          <strong>Unofficial student project.</strong> Not affiliated with Karnataka High Court, CMC, NIC, the Centre for
          e-Governance, or any government body. Always verify results against the official Karnataka High Court portal.
        </div>
        <div className="site-footer__copy">&copy; 2026 Adithi V, B R Lohith Raj, Nikitha Anantha Subramanian &amp; Rosh Martin</div>
      </div>
    </footer>
  );
}
