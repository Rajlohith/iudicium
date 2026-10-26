import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { runCheck } from '../src/services/diagnostics.js';

describe('runCheck', () => {
  it('explains a Python that does not exist', async () => {
    const report = await runCheck({ pythonBin: 'definitely-not-python', tesseractCmd: null });
    assert.equal(report.ok, false);
    assert.match(report.problems[0], /Python was not found \("definitely-not-python"\).*PYTHON_BIN/);
  });

  it('passes through what the checker reports', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'iud-diag-'));
    try {
      const script = path.join(dir, 'check.js');
      await writeFile(script, 'console.log("noise"); console.log(JSON.stringify({ ok: false, problems: ["missing pytesseract"], python: "x" }))');
      const report = await runCheck({ pythonBin: process.execPath, args: [script], cwd: dir });
      assert.deepEqual(report.problems, ['missing pytesseract']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a checker that crashes instead of printing JSON', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'iud-diag-'));
    try {
      const script = path.join(dir, 'boom.js');
      await writeFile(script, 'console.error("ModuleNotFoundError: No module named scraper"); process.exit(1)');
      const report = await runCheck({ pythonBin: process.execPath, args: [script], cwd: dir });
      assert.equal(report.ok, false);
      assert.match(report.problems[0], /could not run the scraper check: ModuleNotFoundError/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
