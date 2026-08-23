import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import ScheduleBuilder from '@/components/ScheduleBuilder';
import { isPlannableTerm } from '@/schedule/terms';
import { listSwitchableSchedules } from '@/schedule/switcher';
import { toSectionHit, sectionHitInclude, type SectionHit } from '@/lib/search';

export default async function SchedulePlannerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Filtering by userId here IS the ownership check: a schedule that exists but
  // belongs to someone else simply doesn't match, so this 404s exactly like a
  // missing schedule.
  const schedule = await db.savedSchedule.findFirst({
    where: { id, userId: session.user.id },
    include: { sections: true },
  });
  if (!schedule) notFound();

  const sectionIds = schedule.sections.map((s) => s.sectionId);
  // ScheduleSection.sectionId is a raw FK with no Prisma relation to Section,
  // so this is a second query rather than a nested include.
  const sections = sectionIds.length
    ? await db.section.findMany({
        where: { id: { in: sectionIds } },
        include: sectionHitInclude,
      })
    : [];

  // Same shape searchSectionsForTerm produces, so the builder holds one type.
  const initialSections: SectionHit[] = sections.map(toSectionHit);

  const terms = await db.term.findMany({
    where: { campus: 'V' },
    orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
  });
  // An existing schedule keeps its own term in the list even if it has since
  // passed — otherwise the select would silently switch it to another term.
  const plannable = terms.filter(isPlannableTerm);
  const termOptions = plannable.some((t) => t.id === schedule.termId)
    ? plannable
    : [...terms.filter((t) => t.id === schedule.termId), ...plannable];

  return (
    <ScheduleBuilder
      mode={{ kind: 'saved', scheduleId: schedule.id }}
      initialName={schedule.name}
      initialTermId={schedule.termId}
      initialSections={initialSections}
      terms={termOptions}
      schedules={await listSwitchableSchedules(session.user.id, terms)}
    />
  );
}
