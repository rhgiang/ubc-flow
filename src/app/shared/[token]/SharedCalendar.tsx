'use client';

import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import type { SectionHit } from '@/lib/search';

/**
 * The builder's calendar with every control left off. Passing no onRemove or
 * onSwap is what makes it read-only — the component already hides those when
 * they are absent, so this needs no read-only mode of its own.
 */
export default function SharedCalendar({ sections }: { sections: SectionHit[] }) {
  const entries: CalendarEntry[] = sections.flatMap((s) =>
    s.meetingTimes.map((m, i) => ({
      id: `${s.sectionId}-${i}`,
      sectionId: s.sectionId,
      label: `${s.code} ${s.sectionCode}`,
      courseCode: s.code,
      // No courseId: that is what makes a block clickable into the course
      // overlay, and this page is for looking, not navigating.
      courseId: null,
      day: m.day,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : null,
      instructor: s.instructors[0] ?? null,
    })),
  );
  return <ScheduleCalendar entries={entries} />;
}
