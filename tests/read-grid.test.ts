import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkbookGrid } from '@/upload/read-grid';

describe('readWorkbookGrid', () => {
  it('reads the current-courses fixture into a grid', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    expect(grid.length).toBeGreaterThan(3);
    // Headers sit on row 3 (index 2); rows 1-2 are title banners.
    expect(grid[2].join('|')).toContain('Course Listing');
  });

  it('reads the academic-record fixture into a grid', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    expect(grid.length).toBeGreaterThan(2);
    expect(grid.flat().join('|')).toContain('Transfer Credit');
  });

  it('pads short rows so column indexes stay stable', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const widths = new Set(grid.map((r) => r.length));
    expect(widths.size).toBe(1);
  });

  it('rejects a non-xlsx buffer rather than throwing something opaque', async () => {
    await expect(readWorkbookGrid(Buffer.from('this is not a spreadsheet'))).rejects.toThrow();
  });
});
