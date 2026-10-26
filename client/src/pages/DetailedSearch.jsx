import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ActivityLog, Options, ProgressBar, SectionsChecklist, includedSections } from '../components/FormParts.jsx';
import ResultsPanel from '../components/ResultsPanel.jsx';
import { useFormOptions } from '../hooks/useFormOptions.js';
import { useSearchJob } from '../hooks/useSearchJob.js';
import { api } from '../utils/api.js';
import { ddmmyyyyToInput, inputToDdmmyyyy } from '../utils/dates.js';
import { KEYS, readJson, remove } from '../utils/storage.js';

const INITIAL = {
  dbBench: '', judge: '', authJudge: '', coram: '', caseType: '', caseNo: '', caseYear: '',
  petName: '', respName: '', petAdv: '', respAdv: '', aliases: '', aliasField: 'respondname',
  fromDate: '', toDate: '', reportType: 'none', outputFilename: '',
};

/** Form values pre-filled from the AI Assistant's "Edit in form" button (read once, then discarded). */
function readPrefill() {
  const f = readJson(KEYS.assistantPrefill);
  remove(KEYS.assistantPrefill);
  if (!f) return null;
  return {
    ...(f.db_bench != null && { dbBench: f.db_bench }),
    ...(f.case_type != null && { caseType: f.case_type }),
    ...(f.case_no != null && { caseNo: f.case_no }),
    ...(f.case_year != null && { caseYear: f.case_year }),
    ...(f.petitioner_name != null && { petName: f.petitioner_name }),
    ...(f.respondent_name != null && { respName: f.respondent_name }),
    ...(f.petitioner_adv != null && { petAdv: f.petitioner_adv }),
    ...(f.respondent_adv != null && { respAdv: f.respondent_adv }),
    ...(f.coram != null && { coram: f.coram }),
    ...(f.from_date && { fromDate: ddmmyyyyToInput(f.from_date) }),
    ...(f.to_date && { toDate: ddmmyyyyToInput(f.to_date) }),
    ...(Array.isArray(f.aliases) && f.aliases.length && { aliases: f.aliases.join('\n') }),
    ...(f.alias_field && { aliasField: f.alias_field }),
    ...(f.report_type && { reportType: f.report_type }),
  };
}

/** The form values for a saved search's parameters (the inverse of what submit() sends). */
function formFromCriteria(c) {
  return {
    dbBench: c.db_bench ?? '', judge: c.judge ?? '', authJudge: c.author_judge ?? '', coram: c.coram ?? '',
    caseType: c.case_type ?? '', caseNo: c.case_no ?? '', caseYear: c.case_year ?? '',
    petName: c.petitioner_name ?? '', respName: c.respondent_name ?? '', petAdv: c.petitioner_adv ?? '', respAdv: c.respondent_adv ?? '',
    aliases: (c.aliases ?? []).join('\n'), aliasField: c.alias_field || 'respondname',
    fromDate: ddmmyyyyToInput(c.from_date), toDate: ddmmyyyyToInput(c.to_date),
    reportType: c.report_type || 'none', outputFilename: c.output_filename ?? '',
  };
}

export default function DetailedSearch() {
  const { options } = useFormOptions();
  const job = useSearchJob('detailed');
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

  const [form, setForm] = useState(() => (rerun ? { ...INITIAL, ...formFromCriteria(rerun) } : { ...INITIAL, ...readPrefill() }));
  const [sections, setSections] = useState(() => (Array.isArray(rerun?.included_sections) ? new Set(rerun.included_sections) : null)); // Set of ticked section names; null = all
  const [judges, setJudges] = useState({ status: 'idle', items: [] }); // idle | loading | error | ready

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const sectionNames = options?.sections ?? [];
  const selected = sections ?? new Set(sectionNames);

  // Judge / Author Judge are populated live from the court site once a bench is chosen.
  useEffect(() => {
    if (!form.dbBench) {
      setJudges({ status: 'idle', items: [] });
      return undefined;
    }
    let active = true;
    setJudges({ status: 'loading', items: [] });
    api('/api/judges', { method: 'POST', body: { db_bench: form.dbBench } })
      .then((data) => active && setJudges({ status: 'ready', items: (data.judges || []).filter((j) => j.value) }))
      .catch(() => active && setJudges({ status: 'error', items: [] }));
    return () => {
      active = false;
    };
  }, [form.dbBench]);

  const judgePlaceholder = useMemo(
    () => ({ idle: '-- Select bench first --', loading: 'Loading…', error: 'Could not load', ready: '-- Select --' })[judges.status],
    [judges.status],
  );

  const submit = (e) => {
    e.preventDefault();
    const criteria = {
      db_bench: form.dbBench,
      aliases: form.aliases.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      alias_field: form.aliasField,
      from_date: inputToDdmmyyyy(form.fromDate),
      to_date: inputToDdmmyyyy(form.toDate),
      judge: form.judge || null,
      author_judge: form.authJudge || null,
      coram: form.coram || null,
      case_type: form.caseType || null,
      case_no: form.caseNo || null,
      case_year: form.caseYear || null,
      petitioner_name: form.petName || null,
      respondent_name: form.respName || null,
      petitioner_adv: form.petAdv || null,
      respondent_adv: form.respAdv || null,
      report_type: form.reportType || null,
      output_filename: form.outputFilename || null,
      included_sections: includedSections(sectionNames, selected),
    };

    if (!criteria.db_bench) return alert('Please select a bench.');
    const hasDates = criteria.from_date && criteria.to_date;
    const hasCaseNoSearch = criteria.case_type && criteria.case_no && criteria.case_year;
    if (!hasDates && !hasCaseNoSearch) {
      return alert('Enter a Date of Order range, or fill in Case Type + Case Number + Case Year.');
    }
    return job.start(criteria);
  };

  return (
    <>
      <main className="layout">
        <section className="card search-card">
          <form onSubmit={submit}>
            <div className="field-group">
              <label className="field-label" htmlFor="dbBench">Select Bench <span className="req">*</span></label>
              <select id="dbBench" required value={form.dbBench} onChange={(e) => setForm((p) => ({ ...p, dbBench: e.target.value, judge: '', authJudge: '' }))}>
                <Options placeholder="-- Select --" items={options?.db_bench} />
              </select>
            </div>

            <div className="grid-3">
              <div className="field-group">
                <label className="field-label" htmlFor="judge">Judge <span className="opt">(optional)</span></label>
                <select id="judge" value={form.judge} onChange={set('judge')}>
                  <Options placeholder={judgePlaceholder} items={judges.items} />
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="authJudge">Author Judge <span className="opt">(optional)</span></label>
                <select id="authJudge" value={form.authJudge} onChange={set('authJudge')}>
                  <Options placeholder={judgePlaceholder} items={judges.items} />
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="coram">Coram <span className="opt">(optional)</span></label>
                <select id="coram" value={form.coram} onChange={set('coram')}>
                  <Options placeholder="-- Select --" items={options?.coram} />
                </select>
              </div>
            </div>

            <div className="grid-3">
              <div className="field-group">
                <label className="field-label" htmlFor="caseType">Case Type <span className="opt">(optional)</span></label>
                <select id="caseType" value={form.caseType} onChange={set('caseType')}>
                  <Options placeholder="-- Select --" items={options?.case_types} />
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="caseNo">Case Number <span className="opt">(optional)</span></label>
                <input
                  type="text" id="caseNo" maxLength={6} inputMode="numeric" placeholder="e.g. 48907"
                  value={form.caseNo} onChange={(e) => setForm((p) => ({ ...p, caseNo: e.target.value.replace(/\D/g, '') }))}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="caseYear">Case Year <span className="opt">(optional)</span></label>
                <select id="caseYear" value={form.caseYear} onChange={set('caseYear')}>
                  <Options placeholder="Select Year" items={options?.case_years.map((y) => ({ value: String(y), label: String(y) }))} />
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="petName">Petitioner Name <span className="opt">(optional)</span></label>
                <input type="text" id="petName" value={form.petName} onChange={set('petName')} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="respName">Respondent Name <span className="opt">(optional)</span></label>
                <input type="text" id="respName" value={form.respName} onChange={set('respName')} />
              </div>
            </div>

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="petAdv">Petitioner Advocate <span className="opt">(optional)</span></label>
                <input type="text" id="petAdv" value={form.petAdv} onChange={set('petAdv')} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="respAdv">Respondent Advocate <span className="opt">(optional)</span></label>
                <input type="text" id="respAdv" value={form.respAdv} onChange={set('respAdv')} />
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="aliases">Search multiple entities <span className="opt">(optional)</span></label>
              <p className="hint">One name per line, or comma-separated. Each is searched in turn, applied to the field chosen on the right.</p>
              <div className="grid-alias">
                <textarea id="aliases" rows={3} placeholder={'e.g.\nSri Nandeesh, ABC Constructions Pvt Ltd'} value={form.aliases} onChange={set('aliases')} />
                <select id="aliasField" value={form.aliasField} onChange={set('aliasField')}>
                  <option value="respondname">Applies to: Respondent Name</option>
                  <option value="petname">Applies to: Petitioner Name</option>
                </select>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Date of Order</label>
              <p className="hint">
                Required unless Case Type + Case Number + Case Year are all filled in. Ranges longer than 90 days are split
                into consecutive windows automatically.
              </p>
              <div className="grid-2">
                <div>
                  <label className="field-label-sm" htmlFor="fromDate">From</label>
                  <input type="date" id="fromDate" value={form.fromDate} onChange={set('fromDate')} />
                </div>
                <div>
                  <label className="field-label-sm" htmlFor="toDate">To</label>
                  <input type="date" id="toDate" value={form.toDate} onChange={set('toDate')} />
                </div>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Report Type <span className="opt">(optional)</span></label>
              <div className="radio-row">
                {(options?.report_type ?? []).map((opt) => (
                  <label key={opt.value}>
                    <input type="radio" name="reportType" value={opt.value} checked={form.reportType === opt.value} onChange={set('reportType')} /> {opt.label}
                  </label>
                ))}
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

        {job.results && <ResultsPanel results={job.results} onClear={job.dismissResults} />}
      </main>
    </>
  );
}
