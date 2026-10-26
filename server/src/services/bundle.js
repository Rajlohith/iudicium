/**
 * If any case in a run captured a Judgment PDF, zip the workbook together
 * with just those PDFs (under a pdfs/ folder, matching the relative
 * hyperlinks the Excel sheet already points at) and return the zip's path.
 * Otherwise leave the plain .xlsx as-is.
 */

import { createWriteStream } from 'node:fs';
import { access, unlink } from 'node:fs/promises';
import path from 'node:path';

import archiver from 'archiver';

const exists = (p) => access(p).then(() => true, () => false);

export async function bundleOutput(xlsxPath, cases, { pdfDir, log = () => {} }) {
  const pdfNames = [...new Set(cases.map((c) => c.judgment_pdf).filter(Boolean))].sort();
  if (!pdfNames.length) return xlsxPath;

  const zipPath = xlsxPath.replace(/\.xlsx$/i, '') + '.zip';
  try {
    await new Promise((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);

      archive.file(xlsxPath, { name: path.basename(xlsxPath) });

      const pending = pdfNames.map(async (name) => {
        const safe = path.basename(name); // never let a name climb out of pdfs/
        const src = path.join(pdfDir, safe);
        if (await exists(src)) archive.file(src, { name: `pdfs/${safe}` });
      });
      Promise.all(pending).then(() => archive.finalize(), reject);
    });

    await unlink(xlsxPath).catch(() => {});
    log(`Bundled ${pdfNames.length} judgment PDF(s) with the workbook into ${path.basename(zipPath)}.`);
    return zipPath;
  } catch (err) {
    await unlink(zipPath).catch(() => {});
    log(`Could not bundle judgment PDFs (keeping the plain workbook): ${err?.message ?? err}`);
    return xlsxPath;
  }
}
