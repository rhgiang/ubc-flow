import { db } from '@/lib/db';
import ScheduleBuilder from '@/components/ScheduleBuilder';
import { isPlannableTerm } from '@/schedule/terms';

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

  const terms = await db.term.findMany({
    where: { campus: 'V' },
    orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
  });

  return (
    <ScheduleBuilder
      mode={{ kind: 'draft' }}
      initialName={name}
      initialTermId={termId}
      initialSections={[]}
      terms={terms.filter(isPlannableTerm)}
      openImport={importFlag === '1'}
      loadPendingImport={fromImport === '1'}
    />
  );
}
