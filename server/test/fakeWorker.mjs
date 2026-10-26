// A stand-in for scraper/worker.py that speaks the same (file-based) protocol, for JobManager tests.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [, , mode, specPath] = process.argv;
const behaviour = process.env.FAKE_BEHAVIOUR || 'ok';
const emit = (type, payload) => process.stdout.write(`${JSON.stringify({ type, payload })}\n`);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stopped = () => existsSync(spec.stop_file);

if (mode === 'judges') {
  emit('result', { judges: [{ value: '1', label: 'JUSTICE X' }] });
  process.exit(0);
}
if (behaviour === 'crash') {
  process.stderr.write("Traceback...\nModuleNotFoundError: No module named 'playwright'\n");
  process.exit(1);
}
if (behaviour === 'error') {
  emit('error', 'site unreachable');
  process.exit(1);
}
if (behaviour === 'hang') await sleep(60_000);
if (behaviour === 'silent-then-ok') await sleep(300);

emit('log', 'started');
const cases = [];
for (let i = 0; i < 20 && !stopped(); i += 1) {
  emit('case_progress', { done: i + 1, total: 20, label: 'x' });
  cases.push({ base_row: { 'Case Type': 'WP', 'Case No': String(i), 'Case Year': '2024', 'Petitioner V/S Respondent Name': 'A V/S B' }, case_info_text: '', sections_data: {}, sections_structured: {}, judgment_pdf: null });
  await sleep(50);
}
writeFileSync(spec.result_path, JSON.stringify(cases));
emit('result', { result_path: spec.result_path, case_count: cases.length, duplicates_skipped: 0, cancelled: stopped() });
