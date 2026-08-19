function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

export function normalizeInstructorName(raw: string): { name: string; slug: string } {
  const cleaned = raw.replace(/\s+/g, ' ').trim();

  const [last, first] = cleaned.includes(',')
    ? cleaned.split(',').map((p) => p.trim())
    : [null, null];

  const name = titleCase(last && first ? `${first} ${last}` : cleaned);

  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return { name, slug };
}
