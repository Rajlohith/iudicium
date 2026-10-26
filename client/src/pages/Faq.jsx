import { Link } from 'react-router-dom';

import Icon from '../components/Icon.jsx';
import { FaqItem } from '../components/Collapsibles.jsx';

export default function Faq() {
  return (
    <main className="home-content">
      <section className="guide-section">
        <div className="guide-section__title">
          <Icon name="help-circle" />
          {' '}
          Frequently Asked Questions
        </div>
        <div className="faq-list">
          <FaqItem>
            <button className="faq-item__q">
              <span>What is the difference between Detailed Search and Quick Search?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">
              <strong>Detailed Search</strong>
              {' '}
              lets you filter cases across a date range by bench, judge, case type, and party names (petitioner or respondent). Use it when you need to find multiple cases or don't have an exact case reference.
              <br />
              <br />
              {' '}
              <strong>Quick Search</strong>
              {' '}
              mirrors the court website's "Quick Search by Case No." page, it looks up a single specific case using its exact Case Type, Case Number, and Year. Use it when you already have the full case reference.
            </div>
          </FaqItem>
          <FaqItem>
            <button className="faq-item__q">
              <span>How do I use the AI Assistant?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">
              Type your query in plain English. For example:
              {' '}
              <em>"Find writ petitions filed by Nandeesh against the State of Karnataka in 2023"</em>
              . The assistant interprets your request and can guide you to the right search tool, suggest what fields to fill, or answer general questions about the application.
            </div>
          </FaqItem>
          <FaqItem>
            <button className="faq-item__q">
              <span>How do I run a Detailed Search?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">
              Go to
              {' '}
              <Link to="/search">Detailed Search</Link>
              . Select a
              {' '}
              <strong>Bench</strong>
              {' '}
              (required), then optionally choose a judge, case type, party names, advocate names, and a date range. Click
              {' '}
              <strong>▶ Run Search</strong>
              . The app auto-solves the CAPTCHA and retrieves results page by page. When complete, download an Excel file of all results using the
              {' '}
              <strong>Download Excel</strong>
              {' '}
              button.
            </div>
          </FaqItem>
          <FaqItem>
            <button className="faq-item__q">
              <span>How do I run a Quick Search?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">
              Go to
              {' '}
              <Link to="/quick-search">Quick Search</Link>
              . Select a
              {' '}
              <strong>Bench</strong>
              , then choose the
              {' '}
              <strong>Case Type</strong>
              , enter the
              {' '}
              <strong>Case Number</strong>
              , and select the
              {' '}
              <strong>Case Year</strong>
              . All three are required. Click
              {' '}
              <strong>▶ Run Search</strong>
              . The CAPTCHA is solved automatically and the case details are fetched directly from the court website.
            </div>
          </FaqItem>
          <FaqItem>
            <button className="faq-item__q">
              <span>What is the date range limit in Detailed Search?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">The Karnataka Judiciary website limits each query to a maximum of 90 days. If your selected date range is longer, the app automatically splits it into consecutive 90-day windows and runs them in sequence, then combines all results into a single output.</div>
          </FaqItem>
          <FaqItem>
            <button className="faq-item__q">
              <span>How does CAPTCHA solving work?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">The app uses an automated CAPTCHA solver. You don't need to solve CAPTCHAs manually, they are handled transparently for every request. If a CAPTCHA fails, the app retries it automatically before reporting the error.</div>
          </FaqItem>
          <FaqItem>
            <button className="faq-item__q">
              <span>How do I search for multiple party names at once?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">
              In Detailed Search, use the
              {' '}
              <strong>Search multiple entities</strong>
              {' '}
              field. Enter multiple party names, one per line, or comma-separated. The app runs a separate search for each name and combines all results into a single output. Use the dropdown next to the text area to choose whether the names apply to the Petitioner or Respondent field.
            </div>
          </FaqItem>
          <FaqItem>
            <button className="faq-item__q">
              <span>How do I download results?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">
              After a search completes, the Results section gives you a few ways to save what you found:
              <br />
              <br />
              {' '}
              <strong>Excel (.xlsx or .zip)</strong>
              {' '}
              — the main download link, generated automatically as soon as the search finishes. It contains every case detail retrieved: party names, case type, bench, and order information. If any matched case has a judgment PDF attached, the download becomes a
              {' '}
              <strong>.zip</strong>
              {' '}
              file instead, bundling the Excel sheet together with the individual judgment PDFs in a
              {' '}
              <strong>pdfs/</strong>
              {' '}
              folder inside the archive. You can set a custom filename in advance using the
              {' '}
              <em>Save results as</em>
              {' '}
              field before running the search.
              <br />
              <br />
              {' '}
              <strong>PDF export</strong>
              {' '}
              — the
              {' '}
              <strong>Download PDF</strong>
              {' '}
              button builds a formatted PDF report directly in your browser from the cases currently shown on screen, with each case's sections and tables laid out for reading or printing. This is separate from any judgment PDFs bundled in the Excel .zip.
              <br />
              <br />
              {' '}
              <strong>Markdown export</strong>
              {' '}
              — the
              {' '}
              <strong>Download Markdown</strong>
              {' '}
              button saves the same on-screen results as a
              {' '}
              <strong>.md</strong>
              {' '}
              file, useful if you want to paste the results into notes, a wiki, or another document.
              <br />
              <br />
              {' '}
              The PDF and Markdown exports are generated instantly in your browser from whatever is currently displayed, so they're only available after a search has completed and results are visible on the page.
            </div>
          </FaqItem>
          <FaqItem>
            <button className="faq-item__q">
              <span>Why is the connection status showing "Connecting…" or "Reconnecting…"?</span>
              {' '}
              <Icon name="chevron-right" className="faq-chevron" />
            </button>
            <div className="faq-item__a">The application connects to a local backend server via WebSocket to stream live logs and results. If the status stays at "Connecting…" or keeps showing "Reconnecting…", ensure the backend server is running. Refer to the project README for setup and startup instructions.</div>
          </FaqItem>
        </div>
      </section>
    </main>
  );
}
