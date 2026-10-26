import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ActivityLog, Options, ProgressBar, SectionsChecklist, includedSections } from '../components/FormParts.jsx';
import ResultsPanel from '../components/ResultsPanel.jsx';
import { useFormOptions } from '../hooks/useFormOptions.js';
import { useSearchJob } from '../hooks/useSearchJob.js';
import { KEYS, readJson, remove } from '../utils/storage.js';

/** Form values pre-filled from the AI Assistant's "Edit in form" button (read once, then discarded). */
function readPrefill() {
  const f = readJson(KEYS.assistantPrefill);
  remove(KEYS.assistantPrefill);
  if (!f) return {};
  return {
    ...(f.db_bench != null && { dbBench: f.db_bench }),
    ...(f.case_type != null && { caseType: f.case_type }),
    ...(f.case_no != null && { caseNo: f.case_no }),
    ...(f.case_year != null && { caseYear: f.case_year }),
  };
}

export default function QuickSearch() {
  const { options } = useFormOptions();
  const job = useSearchJob('quick');
  const location = useLocation();
  const navigate = useNavigate();

  // "Run again" from the account page: fill the form with the saved search and run it straight away.
  const rerun = useRef(location.state?.rerun ?? null).current;
  const rerunStarted = useRef(false);
  useEffect(() => {
    if (!rerun || rerunStarted.current) return;
    rerunStarted.current = true;
    navigate(location.pathname, { replace: true, state: null }); // a page refresh must not run it again
    job.start(rerun);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = useState(() => ({
    dbBench: '', caseType: '', caseNo: '', caseYear: '', outputFilename: '',
    ...(rerun
      ? { dbBench: rerun.db_bench ?? '', caseType: rerun.case_type ?? '', caseNo: rerun.case_no ?? '', caseYear: rerun.case_year ?? '', outputFilename: rerun.output_filename ?? '' }
      : readPrefill()),
  }));
  const [sections, setSections] = useState(() => (Array.isArray(rerun?.included_sections) ? new Set(rerun.included_sections) : null));

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const sectionNames = options?.sections ?? [];
  const selected = sections ?? new Set(sectionNames);

  const submit = (e) => {
    e.preventDefault();
    if (!form.dbBench || !form.caseType || !form.caseNo || !form.caseYear) {
      return alert('Please fill in Bench, Case Type, Case Number, and Case Year.');
    }
    return job.start({
      db_bench: form.dbBench,
      case_type: form.caseType,
      case_no: form.caseNo,
      case_year: form.caseYear,
      output_filename: form.outputFilename || null,
      included_sections: includedSections(sectionNames, selected),
    });
  };

  return (
    <main className="layout">
      <section className="card search-card">
        <form onSubmit={submit}>
          <p className="hint">Looks up a single case using its exact reference. The CAPTCHA is solved automatically.</p>

          <div className="field-group">
            <label className="field-label" htmlFor="dbBench">Select Bench <span className="req">*</span></label>
            <select id="dbBench" required value={form.dbBench} onChange={set('dbBench')}>
              <Options placeholder="-- Select --" items={options?.db_bench} />
            </select>
          </div>

          <div className="grid-3">
            <div className="field-group">
              <label className="field-label" htmlFor="caseType">Case Type <span className="req">*</span></label>
              <select id="caseType" required value={form.caseType} onChange={set('caseType')}>
                <Options placeholder="-- Select --" items={options?.case_types} />
              </select>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="caseNo">Case Number <span className="req">*</span></label>
              <input
                type="text" id="caseNo" maxLength={6} inputMode="numeric" placeholder="e.g. 48907" required
                value={form.caseNo} onChange={(e) => setForm((p) => ({ ...p, caseNo: e.target.value.replace(/\D/g, '') }))}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="caseYear">Case Year <span className="req">*</span></label>
              <select id="caseYear" required value={form.caseYear} onChange={set('caseYear')}>
                <Options placeholder="Select Year" items={options?.case_years.map((y) => ({ value: String(y), label: String(y) }))} />
              </select>
            </div>
          </div>

          <SectionsChecklist names={sectionNames} selected={selected} onChange={setSections} />

          <div className="field-group">
            <label className="field-label" htmlFor="outputFilename">Save results as <span className="opt">(optional)</span></label>
            <input type="text" id="outputFilename" placeholder="Case_Search_Results.xlsx" value={form.outputFilename} onChange={set('outputFilename')} />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={job.running}>▶ Run Search</button>
            <button type="button" className="btn btn-danger" disabled={!job.running} onClick={job.stop}>■ Stop</button>
          </div>

          <ProgressBar progress={job.progress} />
        </form>
      </section>

      <ActivityLog logs={job.logs} onClear={job.clearLog} />

      {job.results && <ResultsPanel results={job.results} onClear={job.dismissResults} filters={false} />}
    </main>
  );
}
