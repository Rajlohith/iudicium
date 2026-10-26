import { collectSections, tableColumns } from '../components/SectionViews.jsx';
import { downloadBlob } from './download.js';

const mdEscape = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export function exportMarkdown(cases) {
  if (!cases.length) return;

  const lines = [
    '# iudicium. — Case Search Results',
    '',
    `**Generated:** ${new Date().toLocaleString()}`,
    '',
    `**Total cases:** ${cases.length}`,
    '',
    '---',
    '',
  ];

  cases.forEach((c, i) => {
    lines.push(`## ${i + 1}. ${c.case_type || ''} ${c.case_no || ''}/${c.case_year || ''}`, '');
    lines.push(`**${c.petitioner || '—'}** v/s **${c.respondent || '—'}**`, '');
    if (c.judgment_pdf) {
      lines.push(`**Judgment PDF:** [${c.judgment_pdf}](pdfs/${c.judgment_pdf}) *(inside the downloaded .zip)*`, '');
    }

    collectSections(c).forEach(([name, text, structured]) => {
      lines.push(`### ${name}`, '');

      if (structured?.kind === 'tables' && structured.tables.length) {
        structured.tables.forEach((table) => {
          if (table.title) lines.push(`**${table.title}**`, '');
          const cols = tableColumns(table);
          if (cols.length && (table.rows || []).length) {
            lines.push(`| ${cols.map(mdEscape).join(' | ')} |`);
            lines.push(`|${cols.map(() => '---').join('|')}|`);
            table.rows.forEach((row) => lines.push(`| ${cols.map((h) => mdEscape(row[h])).join(' | ')} |`));
            lines.push('');
          }
        });
      } else if (structured?.kind === 'fields' && structured.pairs.length) {
        lines.push('| Field | Value |', '|-------|-------|');
        structured.pairs.forEach(([k, v]) => lines.push(`| **${mdEscape(k)}** | ${mdEscape(v)} |`));
        lines.push('');
      } else {
        const body = (structured?.text ? structured.text : text || '').trim();
        if (body) lines.push(body, '');
      }
    });

    lines.push('---', '');
  });

  downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' }), 'cases.md');
}
