import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTermOption, parseSubjectOption, parseCatalogForm } from '@/scrape/parse-catalog';

describe('parseTermOption', () => {
  it('parses a winter term', () => {
    expect(parseTermOption('1449', '2025-26 Winter Term 1 (UBC-V)')).toEqual({
      ubcPeriodId: '1449',
      name: '2025-26 Winter Term 1 (UBC-V)',
      year: 2025,
      session: 'W',
      termNumber: 1,
      campus: 'V',
    });
  });

  it('parses a summer session with no term number', () => {
    expect(parseTermOption('1452', '2026 Summer Session (UBC-V)')).toEqual({
      ubcPeriodId: '1452',
      name: '2026 Summer Session (UBC-V)',
      year: 2026,
      session: 'S',
      termNumber: null,
      campus: 'V',
    });
  });

  it('parses an Okanagan term', () => {
    expect(parseTermOption('1457', '2025-26 Winter Term 1 (UBC-O)').campus).toBe('O');
  });
});

describe('parseSubjectOption', () => {
  it('parses a Vancouver subject', () => {
    expect(parseSubjectOption('1810', 'Computer Science (Vancouver)')).toEqual({
      ubcSubjectId: '1810',
      name: 'Computer Science',
      campus: 'V',
    });
  });

  it('parses an Okanagan subject', () => {
    expect(parseSubjectOption('1704', 'Agricultural Sciences (Okanagan)')).toEqual({
      ubcSubjectId: '1704',
      name: 'Agricultural Sciences',
      campus: 'O',
    });
  });
});

describe('parseCatalogForm', () => {
  const html = readFileSync('tests/fixtures/course-search-form.html', 'utf8');

  it('extracts many subjects and terms', () => {
    const { terms, subjects } = parseCatalogForm(html);
    expect(terms.length).toBeGreaterThan(5);
    expect(subjects.length).toBeGreaterThan(50);
  });

  it('skips the "- Any -" placeholder option', () => {
    const { subjects } = parseCatalogForm(html);
    expect(subjects.some((s) => s.name.includes('Any'))).toBe(false);
  });

  it('finds Computer Science Vancouver', () => {
    const { subjects } = parseCatalogForm(html);
    expect(subjects).toContainEqual(
      expect.objectContaining({ name: 'Computer Science', campus: 'V' }),
    );
  });
});
