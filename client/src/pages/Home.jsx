import { Link } from 'react-router-dom';

import Icon from '../components/Icon.jsx';

const TOOLS = [
  {
    to: '/assistant',
    icon: 'message-circle',
    title: 'AI Assistant',
    text: "Describe what you're looking for in plain language. The assistant interprets your query and guides you to the right fields, no form knowledge required.",
  },
  {
    to: '/search',
    icon: 'search',
    title: 'Detailed Search',
    text: 'Full control, filter by bench, judge, parties, advocate names, date range, and more. Handles multi-entity searches and long date windows automatically.',
  },
  {
    to: '/quick-search',
    icon: 'zap',
    title: 'Quick Search',
    text: 'Look up a specific case instantly using its exact Bench, Case Type, Case Number, and Case Year. Fastest path when you have the full reference.',
  },
];

export default function Home() {
  return (
    <main className="home-content">
      <div className="home-hero">
        <div className="home-hero__badge-row">
          <span className="home-hero__badge"><Icon name="shield-check" /> Auto CAPTCHA solving</span>
          <span className="home-hero__badge"><Icon name="activity" /> Live progress tracking</span>
          <span className="home-hero__badge"><Icon name="download" /> Excel · PDF · Markdown export</span>
        </div>
        <div className="home-hero__body">
          <div className="home-hero__text">
            <h2>Karnataka High Court Case Research Tool</h2>
            <p>
              Retrieve and analyse case records from the Karnataka Judiciary portal automatically. Search by bench, judge,
              party names, date ranges, or case reference. Results are collated and ready to download in seconds.
            </p>
            <p className="home-hero__sub">
              Use the <strong>AI Assistant</strong> to describe what you need in plain language and let it guide you to the
              right search. Or go directly to <strong>Detailed Search</strong> for full filter control, or{' '}
              <strong>Quick Search</strong> when you have an exact case reference.
            </p>
          </div>
          <Link to="/assistant" className="home-hero__cta">
            <Icon name="message-circle" />
            Start with AI Assistant
            <Icon name="arrow-right" />
          </Link>
        </div>
      </div>

      <div className="home-tools-label">
        <span><Icon name="layout-grid" /> Search Tools</span>
      </div>
      <div className="home-feature-grid">
        {TOOLS.map((tool) => (
          <Link key={tool.to} to={tool.to} className="home-feature-card">
            <div className="home-feature-card__icon"><Icon name={tool.icon} /></div>
            <div className="home-feature-card__content">
              <h3>{tool.title}</h3>
              <p>{tool.text}</p>
            </div>
            <span className="home-feature-card__arrow"><Icon name="arrow-right" /></span>
          </Link>
        ))}
      </div>
    </main>
  );
}
