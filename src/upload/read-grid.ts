import ExcelJS from 'exceljs';

/**
 * The single I/O boundary of the upload pipeline. Everything downstream is a
 * pure function over the returned grid, which is what keeps the parser
 * testable offline.
 *
 * Rows are padded to a uniform width so column indexes are stable — Workday
 * omits trailing empty cells, which would otherwise shift lookups per row.
 */
export async function readWorkbookGrid(
  buffer: Buffer | ArrayBuffer,
): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);

  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('Workbook contains no worksheets.');

  const rows: string[][] = [];
  let width = 0;

  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      let text = '';
      if (v === null || v === undefined) text = '';
      else if (typeof v === 'object' && 'richText' in v) {
        text = (v.richText as { text: string }[]).map((t) => t.text).join('');
      } else if (v instanceof Date) text = v.toISOString().slice(0, 10);
      else text = String(v);
      cells.push(text.trim());
    });
    width = Math.max(width, cells.length);
    rows.push(cells);
  });

  return rows.map((r) => {
    const padded = r.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
}
