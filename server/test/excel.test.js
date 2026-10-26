import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import ExcelJS from 'exceljs';

import { buildSchema, writeCombinedWorkbook } from '../src/services/excelWriter.js';

const table = (title, rows) => ({ kind: 'tables', tables: [{ title, headers: Object.keys(rows[0] ?? {}), rows }] });

const cases = [
  {
    base_row: { 'Case Type': 'WP', 'Case No': '1', 'Case Year': '2024', 'Petitioner V/S Respondent Name': 'A V/S B' },
    case_info_structured: { kind: 'fields', pairs: [['Status', 'Pending']] },
    sections_structured: {
      'Party Information': table('Petitioners', [{ Name: 'A' }, { Name: 'A2' }]),
      'Prayer Information': { kind: 'narrative', text: 'Prayer text' },
    },
    judgment_pdf: 'x.pdf',
  },
  {
    base_row: { 'Case Type': 'WA', 'Case No': '2', 'Case Year': '2023', 'Petitioner V/S Respondent Name': 'C' },
    case_info_structured: null,
    sections_structured: { 'Party Information': { kind: 'narrative', text: 'free text \u0007 here' } },
  },
];

describe('buildSchema', () => {
  it('classifies single-value vs repeating sections and orders columns', () => {
    const { singleValue, repeating } = buildSchema(cases);
    assert.deepEqual([...singleValue.keys()], ['Case Identity', 'Case Information', 'Judgment PDF', 'Prayer Information']);
    assert.deepEqual([...repeating.keys()], ['Party Information']);
    assert.deepEqual([...repeating.get('Party Information').keys()], ['Table', 'Name', 'Text']);
  });
});

describe('writeCombinedWorkbook', () => {
  it('writes Summary + Case Details with merged blocks, links and cleaned text', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'iud-'));
    try {
      const file = path.join(dir, 'out.xlsx');
      await writeCombinedWorkbook(file, cases);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);

      const summary = wb.getWorksheet('Summary');
      assert.deepEqual(summary.getRow(2).values.slice(1, 7), [1, 'WP', '1', '2024', 'A', 'B']);
      assert.equal(summary.getRow(3).getCell(5).value, 'C'); // no V/S -> petitioner only

      const details = wb.getWorksheet('Case Details');
      assert.equal(details.getCell(1, 1).value, 'Case Identity');
      // Case 1 has 2 party rows -> its single-value cells are merged over rows 3-4.
      assert.ok(details.getCell(4, 1).isMerged);
      assert.equal(details.getCell(5, 1).value, 'WA'); // case 2 starts on row 5
      const pdfCell = details.getRow(3).getCell(5); // Case Identity(3) + Case Information(1) -> File is col 5
      assert.equal(pdfCell.value.hyperlink, 'pdfs/x.pdf');
      const lastCol = details.columnCount;
      assert.equal(details.getRow(5).getCell(lastCol).value, 'free text  here'); // control char removed (whitespace left as-is, like the Python writer)
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a valid, empty workbook when nothing was found', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'iud-'));
    try {
      const file = path.join(dir, 'empty.xlsx');
      await writeCombinedWorkbook(file, []);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Case Details']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
