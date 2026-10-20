'use client';

import { courseColorIndex } from '@/schedule/colors';

/**
 * The course badge, in the colour that course carries everywhere else. The
 * colour is hashed from the raw name, not the shortened one, so two courses
 * that shorten alike still differ and a course keeps its colour if the
 * shortening rules ever change.
 *
 * Its own module because both DeadlinesList and TodoBoard draw it, and
 * DeadlinesList already imports TodoBoard - importing it back would be a
 * genuine cycle rather than a type-only one.
 */
export default function CoursePill({ name, label }: { name: string; label: string }) {
  const slot = courseColorIndex(name);
  return (
    <span
      className="inline-block shrink-0 rounded-pill px-1.5 py-0.5 text-xs font-medium"
      style={{ background: `var(--course-${slot}-bg)`, color: `var(--course-${slot}-accent)` }}
    >
      {label}
    </span>
  );
}
