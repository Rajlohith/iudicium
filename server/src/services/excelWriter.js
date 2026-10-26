/**
 * Writing the workbook: a Summary sheet, and one "Case Details" sheet
 * built dynamically from each case's structured section data (see
 * scraper/section_structure.py) -- no column layout is hardcoded to a
 * particular section's name or fields. Whatever sections/columns the
 * scraped cases actually have determine the sheet's shape.
 *
 * Layout of "Case Details":
 *   - Sections that hold ONE value per case (Case Information's fields,
 *     the Judgment PDF link, Prayer Information's narrative, ...) become
 *     merged column bands. Their values are written once per case and
 *     merged vertically down that case's whole block of rows.
 *   - Sections that repeat (Party Information, Judgment/Daily Orders
 *     tables, ...) become their own column bands too, but each entry
 *     gets its own row -- appended one after another underneath the
 *     case's single-value row, leaving unrelated columns blank on that
 *     row. A case's block is therefore as tall as it needs to be.
 *
 * Which sections end up in which group, and which columns each needs,
 * is decided by scanning every case first (see buildSchema).
 */

import ExcelJS from 'exceljs';

import { SECTION_ORDER } from '../config.js';
import { excelSafe, splitPartyNames } from '../utils/text.js';

// ----------------------------------------------------------------------
// Style helpers
// ----------------------------------------------------------------------

const NAVY = '1F3A5F';
const GOLD = '8C6D2F';
const REPEAT_PURPLE = '5B4B8A';
const LIGHT_GRAY = 'F6F4EE';
const STRIPE = 'EFEBDD';
const BORDER_COLOR = 'D6D2C2';
// Hyperlink text. (The original port used a near-white blue, which was
// unreadable on the light cell backgrounds.)
const LINK_BLUE = '1F5FA8';

const argb = (hex) => `FF${hex}`;
const thin = { style: 'thin', color: { argb: argb(BORDER_COLOR) } };
const CELL_BORDER = { left: thin, right: thin, top: thin, bottom: thin };
const solid = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });

function bandStyle(cell, bg) {
  cell.font = { bold: true, color: { argb: argb('FFFFFF') }, size: 10, name: 'Calibri' };
  cell.fill = solid(bg);
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = CELL_BORDER;
}

function fieldHeaderStyle(cell) {
  cell.font = { bold: true, color: { argb: argb('FFFFFF') }, size: 9, name: 'Calibri' };
  cell.fill = solid(NAVY);
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  cell.border = CELL_BORDER;
}

function dataStyle(cell, { bg = null, bold = false, wrap = true, valign = 'top' } = {}) {
  cell.font = { bold, color: { argb: argb('1B1B17') }, size: 10, name: 'Calibri' };
  if (bg) cell.fill = solid(bg);
  cell.alignment = { horizontal: 'left', vertical: valign, wrapText: wrap };
  cell.border = CELL_BORDER;
}

// ----------------------------------------------------------------------
// Summary sheet
// ----------------------------------------------------------------------

function writeSummarySheet(ws, summaryRows) {
  const headers = ['#', 'Case Type', 'Case No', 'Year', 'Petitioner', 'Respondent'];
  const widths = [5, 14, 10, 8, 45, 45];

  headers.forEach((h, i) => {
    bandStyle(ws.getCell(1, i + 1), NAVY);
    ws.getCell(1, i + 1).value = h;
    ws.getColumn(i + 1).width = widths[i];
  });
  ws.getRow(1).height = 20;

  summaryRows.forEach((row, i) => {
    const rowIdx = i + 2;
    const values = [row.SlNo, row['Case Type'], row['Case No'], row.Year, row.Petitioner, row.Respondent];
    const bg = rowIdx % 2 === 0 ? LIGHT_GRAY : null;
    values.forEach((val, j) => {
      const cell = ws.getCell(rowIdx, j + 1);
      cell.value = val;
      dataStyle(cell, { bg, wrap: j + 1 >= 5 });
    });
    ws.getRow(rowIdx).height = 15;
  });

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

// ----------------------------------------------------------------------
// Case Details sheet -- schema discovery
// ----------------------------------------------------------------------

const structuredOf = (c) => c.sections_structured ?? {};
const pairsToMap = (pairs) => new Map(pairs ?? []);

/** Add `key` to an insertion-ordered Set-like Map if it isn't there yet. */
const touch = (map, key) => {
  if (!map.has(key)) map.set(key, true);
};

/**
 * One pass over every case to decide:
 *   singleValue: Map<groupName, Map<field, true>>
 *   repeating:   Map<groupName, Map<column, true>>
 *                (each repeating section also gets a leading "Table"
 *                sub-column if any of its tables, in any case, had a
 *                distinct title)
 *
 * A section is "repeating" if it produced at least one table in at
 * least one case; otherwise it's single-valued everywhere.
 */
export function buildSchema(cases) {
  const tableSomewhere = new Set();
  for (const c of cases) {
    for (const [name, data] of Object.entries(structuredOf(c))) {
      if (data?.kind === 'tables') tableSomewhere.add(name);
    }
  }

  const singleValue = new Map();
  const repeating = new Map();
  const needsTableTitle = new Set();

  // Case Identity always first, always single-valued.
  singleValue.set('Case Identity', new Map(['Case Type', 'Case No', 'Case Year'].map((f) => [f, true])));

  // Case Information, if any case has it structured as fields.
  const ciFields = new Map();
  for (const c of cases) {
    const ci = c.case_info_structured;
    if (ci?.kind === 'fields') {
      for (const [label] of ci.pairs) touch(ciFields, label);
    }
  }
  if (ciFields.size) singleValue.set('Case Information', ciFields);

  // Judgment PDF -- a one-column pseudo-section, single-valued.
  if (cases.some((c) => c.judgment_pdf)) singleValue.set('Judgment PDF', new Map([['File', true]]));

  // Every other section, in the site's own order.
  for (const { name: sectionName } of SECTION_ORDER) {
    const cols = new Map();
    const isRepeating = tableSomewhere.has(sectionName);

    for (const c of cases) {
      const data = structuredOf(c)[sectionName];
      if (!data) continue;

      if (isRepeating) {
        if (data.kind === 'tables') {
          for (const table of data.tables) {
            if (table.title) needsTableTitle.add(sectionName);
            for (const row of table.rows) {
              for (const key of Object.keys(row)) touch(cols, key);
            }
          }
        } else if (data.kind === 'fields') {
          for (const [label] of data.pairs) touch(cols, label);
        } else if (data.kind === 'narrative') {
          touch(cols, 'Text');
        }
      } else if (data.kind === 'fields') {
        for (const [label] of data.pairs) touch(cols, label);
      } else if (data.kind === 'narrative') {
        touch(cols, sectionName);
      }
    }

    if (!cols.size) continue;

    if (isRepeating) {
      const ordered = new Map();
      if (needsTableTitle.has(sectionName)) ordered.set('Table', true);
      for (const key of cols.keys()) touch(ordered, key);
      repeating.set(sectionName, ordered);
    } else {
      singleValue.set(sectionName, cols);
    }
  }

  return { singleValue, repeating };
}

// ----------------------------------------------------------------------
// Case Details sheet -- writing
// ----------------------------------------------------------------------

function valueForSingle(c, baseRow, group, field) {
  if (group === 'Case Identity') return baseRow[field] ?? '';
  if (group === 'Judgment PDF') return c.judgment_pdf || '';
  if (group === 'Case Information') {
    const ci = c.case_info_structured;
    return ci?.kind === 'fields' ? (pairsToMap(ci.pairs).get(field) ?? '') : '';
  }
  const data = structuredOf(c)[group];
  if (!data) return '';
  if (data.kind === 'fields') return pairsToMap(data.pairs).get(field) ?? '';
  if (data.kind === 'narrative') return data.text;
  return '';
}

function writeCaseDetailsSheet(ws, cases) {
  const { singleValue, repeating } = buildSchema(cases);

  let col = 1;
  const fieldCol = new Map(); // `${group}\u0000${field}` -> column index
  const groupSpan = new Map(); // group -> [startCol, endCol]
  const key = (group, field) => `${group}\u0000${field}`;

  const writeBand = (group, fields, bg, label = group) => {
    const startCol = col;
    for (const f of fields) {
      fieldCol.set(key(group, f), col);
      col += 1;
    }
    const endCol = col - 1;
    groupSpan.set(group, [startCol, endCol]);

    // Style the whole band first, so merged cells carry the colour too.
    for (let c = startCol; c <= endCol; c += 1) bandStyle(ws.getCell(1, c), bg);
    ws.getCell(1, startCol).value = label;
    if (endCol > startCol) ws.mergeCells(1, startCol, 1, endCol);

    fields.forEach((f, i) => {
      const c = startCol + i;
      const cell = ws.getCell(2, c);
      cell.value = f;
      fieldHeaderStyle(cell);
      const isWide = f === 'Text' || f === 'Prayer Details' || f.includes('Notes') || f.includes('Address');
      ws.getColumn(c).width = isWide ? 55 : 24;
    });
  };

  for (const [group, fields] of singleValue) writeBand(group, [...fields.keys()], GOLD);
  for (const [group, fields] of repeating) writeBand(group, [...fields.keys()], REPEAT_PURPLE, `${group}  (repeats)`);

  ws.getRow(1).height = 20;
  ws.getRow(2).height = 24;
  const identityEnd = groupSpan.get('Case Identity')?.[1] ?? 3;
  ws.views = [{ state: 'frozen', xSplit: identityEnd, ySplit: 2 }];

  // --- write each case's block ------------------------------------------
  let row = 3;
  cases.forEach((c, caseIdx) => {
    const baseRow = c.base_row ?? {};
    const bg = caseIdx % 2 === 1 ? STRIPE : null;

    const repeatRowCounts = [];
    for (const group of repeating.keys()) {
      const data = structuredOf(c)[group];
      if (!data) continue;
      repeatRowCounts.push(data.kind === 'tables' ? data.tables.reduce((n, t) => n + t.rows.length, 0) : 1);
    }
    const nRows = Math.max(1, repeatRowCounts.reduce((a, b) => a + b, 0));
    const endRow = row + nRows - 1;

    // Single-value bands: write once, merge down the block.
    for (const [group, fields] of singleValue) {
      for (const f of fields.keys()) {
        const colIdx = fieldCol.get(key(group, f));
        const val = valueForSingle(c, baseRow, group, f);
        const cell = ws.getCell(row, colIdx);
        cell.value = excelSafe(val);
        dataStyle(cell, { bg, valign: 'middle' });

        if (group === 'Judgment PDF' && val) {
          cell.value = { text: excelSafe(val), hyperlink: `pdfs/${val}` };
          cell.font = { color: { argb: argb(LINK_BLUE) }, underline: 'single', size: 10, name: 'Calibri' };
        }
        if (endRow > row) {
          // Style the rest of the merged range so the stripe/border show on every row.
          for (let r = row + 1; r <= endRow; r += 1) dataStyle(ws.getCell(r, colIdx), { bg, valign: 'middle' });
          ws.mergeCells(row, colIdx, endRow, colIdx);
        }
      }
    }

    // Repeating bands: one row per entry, stacked.
    let r = row;
    for (const [group, fields] of repeating) {
      const data = structuredOf(c)[group];
      if (!data) continue;

      const entries = [];
      if (data.kind === 'tables') {
        for (const table of data.tables) {
          for (const tableRow of table.rows) {
            const entry = { ...tableRow };
            if (fields.has('Table') && table.title) entry.Table = table.title;
            entries.push(entry);
          }
        }
      } else if (data.kind === 'fields') {
        entries.push(Object.fromEntries(data.pairs));
      } else if (data.kind === 'narrative') {
        entries.push({ Text: data.text });
      }

      for (const entry of entries) {
        for (const f of fields.keys()) {
          const cell = ws.getCell(r, fieldCol.get(key(group, f)));
          cell.value = excelSafe(entry[f] ?? '');
          dataStyle(cell, { bg });
        }
        ws.getRow(r).height = 30;
        r += 1;
      }
    }

    row = endRow + 1;
  });

  const colA = ws.getColumn(1);
  colA.width = Math.max(colA.width || 0, 14);
}

// ----------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------

/** Write the Summary sheet and the single dynamically-built Case Details sheet. */
export async function writeCombinedWorkbook(filename, cases) {
  const wb = new ExcelJS.Workbook();

  const summaryRows = cases.map((c, i) => {
    const baseRow = c.base_row ?? {};
    const [petitioner, respondent] = splitPartyNames(baseRow['Petitioner V/S Respondent Name'] ?? '');
    return {
      SlNo: i + 1,
      'Case Type': excelSafe(baseRow['Case Type'] ?? ''),
      'Case No': excelSafe(baseRow['Case No'] ?? ''),
      Year: excelSafe(baseRow['Case Year'] ?? ''),
      Petitioner: excelSafe(petitioner),
      Respondent: excelSafe(respondent),
    };
  });
  writeSummarySheet(wb.addWorksheet('Summary'), summaryRows);

  writeCaseDetailsSheet(wb.addWorksheet('Case Details'), cases);

  await wb.xlsx.writeFile(filename);
}
