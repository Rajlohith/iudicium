import { collectSections, tableColumns } from '../components/SectionViews.jsx';

/** Builds cases.pdf in the browser. jsPDF is loaded on demand: it is large and rarely needed. */
export async function exportPdf(cases) {
  if (!cases.length) return;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = margin;

  const addPageIfNeeded = (needed) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const tableStyles = { fontSize: 7.5, cellPadding: 1.5, textColor: [27, 27, 23], overflow: 'linebreak' };

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(31, 58, 95);
  doc.text('iudicium. — Case Search Results', margin, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 106, 92);
  doc.text(`Generated: ${new Date().toLocaleString()}   |   ${cases.length} case(s)`, margin, y);
  y += 8;

  doc.setDrawColor(214, 210, 194);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  cases.forEach((c, idx) => {
    addPageIfNeeded(20);

    // Case heading
    doc.setFillColor(31, 58, 95);
    doc.rect(margin, y - 4, contentW, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(`${idx + 1}. ${c.case_type || ''} ${c.case_no || ''}/${c.case_year || ''}`, margin + 2, y);
    y += 5;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`${c.petitioner || '—'} v/s ${c.respondent || '—'}`, margin + 2, y);
    y += 7;

    if (c.judgment_pdf) {
      addPageIfNeeded(6);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(140, 109, 47);
      doc.text(`Judgment PDF: pdfs/${c.judgment_pdf}  (included in the Excel .zip download)`, margin, y);
      doc.setFont('helvetica', 'normal');
      y += 6;
    }

    collectSections(c).forEach(([name, text, structured]) => {
      addPageIfNeeded(12);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(31, 58, 95);
      doc.text(name, margin, y);
      doc.setDrawColor(31, 58, 95);
      doc.line(margin, y + 1, pageW - margin, y + 1);
      y += 5;

      if (structured?.kind === 'tables' && structured.tables.length) {
        structured.tables.forEach((table) => {
          if (table.title) {
            addPageIfNeeded(6);
            doc.setFontSize(8.5);
            doc.setFont('helvetica', 'bolditalic');
            doc.setTextColor(140, 109, 47);
            doc.text(table.title, margin, y);
            doc.setFont('helvetica', 'normal');
            y += 4;
          }
          const cols = tableColumns(table);
          autoTable(doc, {
            startY: y,
            head: [cols],
            body: (table.rows || []).map((row) => cols.map((h) => String(row[h] || ''))),
            margin: { left: margin, right: margin },
            styles: tableStyles,
            headStyles: { fillColor: [31, 58, 95], textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [246, 244, 238] },
          });
          y = doc.lastAutoTable.finalY + 4;
        });
      } else if (structured?.kind === 'fields' && structured.pairs.length) {
        autoTable(doc, {
          startY: y,
          body: structured.pairs.map(([k, v]) => [k, v]),
          margin: { left: margin, right: margin },
          styles: tableStyles,
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42, textColor: [31, 58, 95] } },
          theme: 'grid',
        });
        y = doc.lastAutoTable.finalY + 4;
      } else {
        const bodyText = (structured?.text ? structured.text : text || '').trim();
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(27, 27, 23);
        doc.splitTextToSize(bodyText, contentW - 4).forEach((line) => {
          addPageIfNeeded(4.5);
          doc.text(line, margin + 2, y);
          y += 4.5;
        });
        y += 3;
      }
    });

    // Separator between cases
    doc.setDrawColor(214, 210, 194);
    doc.setLineDash([2, 2]);
    addPageIfNeeded(6);
    doc.line(margin, y, pageW - margin, y);
    doc.setLineDash([]);
    y += 6;
  });

  doc.save('cases.pdf');
}
