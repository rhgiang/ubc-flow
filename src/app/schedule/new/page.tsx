import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import ScheduleBuilder from '@/components/ScheduleBuilder';
import { isPlannableTerm } from '@/schedule/terms';
import { listSwitchableSchedules } from '@/schedule/switcher';

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    name?: string;
    termId?: string;
    import?: string;
    fromImport?: string;
  }>;
}) {
  const { name = '', termId = '', import: importFlag, fromImport } = await searchParams;

  const [terms, session] = await Promise.all([
    db.term.findMany({
      where: { campus: 'V' },
      orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
    }),
    auth(),
  ]);
  // This page renders for signed-out visitors too, who have nothing to switch to.
  const schedules = await listSwitchableSchedules(session?.user?.id, terms);

  return (
    <ScheduleBuilder
      mode={{ kind: 'draft' }}
      initialName={name}
      initialTermId={termId}
      initialSections={[]}
      terms={terms.filter(isPlannableTerm)}
      schedules={schedules}
      openImport={importFlag === '1'}
      loadPendingImport={fromImport === '1'}
    />
  );
}
