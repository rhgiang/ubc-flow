'use client';

import CourseScheduleBox, { type SectionRow } from '@/components/CourseScheduleBox';
import { useViewer } from '@/components/ViewerContext';

/**
 * CourseScheduleBox with the viewer's schedules supplied from the browser
 * instead of the server render, so the course page can be static. Signed-out
 * visitors get the same table they always did (no Schedule column); a
 * signed-in student's schedule dropdowns appear once their state loads.
 */
export default function CourseScheduleIsland(props: {
  sections: SectionRow[];
  addToScheduleActions?: Record<string, (formData: FormData) => Promise<void>>;
}) {
  const viewer = useViewer();
  return (
    <CourseScheduleBox
      {...props}
      mySchedules={viewer.signedIn ? viewer.mySchedules : undefined}
    />
  );
}
