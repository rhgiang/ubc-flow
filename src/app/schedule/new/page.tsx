import { db } from '@/lib/db';
import ScheduleBuilder from '@/components/ScheduleBuilder';
import { isPlannableTerm } from '@/schedule/terms';

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; termId?: string }>;
}) {
  const { name = '', termId = '' } = await searchParams;

  const terms = await db.term.findMany({
    where: { campus: 'V' },
    orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
  });
  const plannableTerms = terms.filter(isPlannableTerm);

  return <ScheduleBuilder initialName={name} initialTermId={termId} terms={plannableTerms} />;
}
