import Icon from '../components/Icon.jsx';
import { GuideBlock } from '../components/Collapsibles.jsx';

export default function Guide() {
  return (
    <main className="home-content">
      <GuideBlock defaultCollapsed>
        <div className="guide-block__header">
          <div className="guide-block__header-left">
            <Icon name="message-circle" />
            <div className="guide-block__header-text">
              <h2>AI Assistant</h2>
              <p>Ask questions in plain language</p>
            </div>
          </div>
          <span className="guide-block__chevron">
            <Icon name="chevron-down" />
          </span>
        </div>
        <div className="guide-steps">
          <div className="guide-step">
            <div className="guide-step__num">1</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Open the AI Assistant</p>
              <p className="guide-step__desc">
                Click
                {' '}
                <strong>AI Assistant</strong>
                {' '}
                in the sidebar or from the home screen.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">2</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Type Your Query</p>
              <p className="guide-step__desc">
                Describe what you're looking for in plain English, for example:
                {' '}
                <em>"Find writ petitions filed by Nandeesh against the State of Karnataka in 2023"</em>
                {' '}
                or
                {' '}
                <em>"How do I search for cases from a specific judge?"</em>
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">3</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Send the Message</p>
              <p className="guide-step__desc">
                Press
                {' '}
                <strong>Enter</strong>
                {' '}
                or click the send button. Use
                {' '}
                <strong>Shift + Enter</strong>
                {' '}
                to start a new line without sending.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">4</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Follow the Guidance</p>
              <p className="guide-step__desc">The assistant will interpret your request and guide you to the right search tool, suggest which fields to fill in, or answer general questions about how the application works. Continue the conversation naturally.</p>
              <div className="guide-tip">
                <Icon name="lightbulb" />
                {' '}
                The assistant remembers your conversation for the current session. You can ask follow-up questions without repeating context.
              </div>
            </div>
          </div>
        </div>
      </GuideBlock>
      <GuideBlock defaultCollapsed>
        <div className="guide-block__header">
          <div className="guide-block__header-left">
            <Icon name="search" />
            <div className="guide-block__header-text">
              <h2>Detailed Search</h2>
              <p>Filter cases by bench, judge, parties, and date range</p>
            </div>
          </div>
          <span className="guide-block__chevron">
            <Icon name="chevron-down" />
          </span>
        </div>
        <div className="guide-steps">
          <div className="guide-step">
            <div className="guide-step__num">1</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Open Detailed Search</p>
              <p className="guide-step__desc">
                Click
                {' '}
                <strong>Detailed Search</strong>
                {' '}
                in the sidebar or from the home screen.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">2</div>
            <div className="guide-step__content">
              <p className="guide-step__title">
                Select a Bench
                {' '}
                <span className="req" style={{ color: '#7C2C2C' }}>*</span>
              </p>
              <p className="guide-step__desc">Choose the court bench from the dropdown. This is the only required field. All other filters are optional.</p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">3</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Narrow by Judge or Case Type (optional)</p>
              <p className="guide-step__desc">
                After selecting a bench, the
                {' '}
                <strong>Judge</strong>
                {' '}
                and
                {' '}
                <strong>Author Judge</strong>
                {' '}
                dropdowns populate. You can also filter by
                {' '}
                <strong>Coram</strong>
                ,
                {' '}
                <strong>Case Type</strong>
                ,
                {' '}
                <strong>Case Number</strong>
                , or
                {' '}
                <strong>Case Year</strong>
                .
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">4</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Enter Party or Advocate Names (optional)</p>
              <p className="guide-step__desc">
                Fill in
                {' '}
                <strong>Petitioner Name</strong>
                ,
                {' '}
                <strong>Respondent Name</strong>
                , or their advocate fields to narrow results to specific parties.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">5</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Search Multiple Entities at Once (optional)</p>
              <p className="guide-step__desc">
                Use the
                {' '}
                <strong>Search multiple entities</strong>
                {' '}
                box to enter several party names: one per line or comma-separated. Choose whether the names apply to the Petitioner or Respondent field. Each name is searched separately and all results are merged.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">6</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Set a Date Range</p>
              <p className="guide-step__desc">
                Enter a
                {' '}
                <strong>From</strong>
                {' '}
                and
                {' '}
                <strong>To</strong>
                {' '}
                date for the order date. Required unless Case Type, Number, and Year are all filled in. Ranges longer than 90 days are automatically split and merged.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">7</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Run the Search</p>
              <p className="guide-step__desc">
                Click
                {' '}
                <strong>▶ Run Search</strong>
                . The CAPTCHA is solved automatically. Watch the Activity Log for live progress. When done, click
                {' '}
                <strong>Download Excel</strong>
                {' '}
                to save all results.
              </p>
              <div className="guide-tip">
                <Icon name="lightbulb" />
                {' '}
                Set a custom filename in
                {' '}
                <em>Save results as</em>
                {' '}
                before running — the downloaded file will use that name.
              </div>
            </div>
          </div>
        </div>
      </GuideBlock>
      <GuideBlock defaultCollapsed>
        <div className="guide-block__header">
          <div className="guide-block__header-left">
            <Icon name="zap" />
            <div className="guide-block__header-text">
              <h2>Quick Search</h2>
              <p>Look up a single case by its exact reference</p>
            </div>
          </div>
          <span className="guide-block__chevron">
            <Icon name="chevron-down" />
          </span>
        </div>
        <div className="guide-steps">
          <div className="guide-step">
            <div className="guide-step__num">1</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Open Quick Search</p>
              <p className="guide-step__desc">
                Click
                {' '}
                <strong>Quick Search</strong>
                {' '}
                in the sidebar or from the home screen.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">2</div>
            <div className="guide-step__content">
              <p className="guide-step__title">
                Select a Bench
                {' '}
                <span className="req" style={{ color: '#7C2C2C' }}>*</span>
              </p>
              <p className="guide-step__desc">Choose the bench where the case was filed.</p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">3</div>
            <div className="guide-step__content">
              <p className="guide-step__title">
                Enter the Case Reference
                {' '}
                <span className="req" style={{ color: '#7C2C2C' }}>*</span>
              </p>
              <p className="guide-step__desc">
                Select the
                {' '}
                <strong>Case Type</strong>
                , enter the
                {' '}
                <strong>Case Number</strong>
                , and choose the
                {' '}
                <strong>Case Year</strong>
                . All three fields are required.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step__num">4</div>
            <div className="guide-step__content">
              <p className="guide-step__title">Run the Search</p>
              <p className="guide-step__desc">
                Click
                {' '}
                <strong>▶ Run Search</strong>
                . The CAPTCHA is handled automatically and the case record is fetched directly from the court website and displayed in the Results section below.
              </p>
            </div>
          </div>
        </div>
      </GuideBlock>
    </main>
  );
}
