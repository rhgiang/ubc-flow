/**
 * Reads a REAL Workday export and writes a redacted fixture with the same
 * structure but fabricated identity. Run manually; never commit its input.
 *   npx tsx scripts/make-fixture.ts rgschedule/View_My_Courses.xlsx tests/fixtures/workday-current.xlsx
 */
import ExcelJS from 'exceljs';

const FAKE_STUDENT = 'Test Student (99999999) - Faculty of Science';

async function main() {
  const [, , input, output] = process.argv;
  if (!input || !output) throw new Error('usage: make-fixture <input> <output>');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(input);

  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const a = row.getCell(1);
      // Column A carries "Name (studentnumber) - Faculty". Replace wholesale.
      if (typeof a.value === 'string' && /\(\d{6,10}\)/.test(a.value)) {
        a.value = FAKE_STUDENT;
      }
    });
  });

  await wb.xlsx.writeFile(output);
  console.log(`wrote ${output}`);
}

main();
