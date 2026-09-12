import type { ExamListItem } from '@/schedule/exams';

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** "Surnames ADI–SUN" — an en dash, not the hyphen UBC's table uses. */
function formatAlphaSplit(alphaSplit: string): string {
  return `Surnames ${alphaSplit.replace('-', '–')}`;
}

/**
 * One exam's card. Matches the visual language of EnrolledCourseCard: same
 * rounded-card/border/surface shell, same accent-on-code + secondary-title
 * header pattern.
 */
function ExamRow({ item }: { item: ExamListItem }) {
  const body = (
    <>
      <p className="text-sm text-text-secondary">
        {item.date ? formatDate(item.date) : 'Date TBA'}
        {item.startTime ? ` · ${item.startTime}` : ''}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {item.location ?? 'Location TBA — check with your instructor'}
        {item.alphaSplit ? ` · ${formatAlphaSplit(item.alphaSplit)}` : ''}
      </p>
      {item.notes && <p className="mt-1 text-sm text-text-tertiary">{item.notes}</p>}
    </>
  );

  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-brand-accent">{item.courseLabel}</span>
        {item.sectionCode && (
          <span className="text-sm text-text-tertiary">Section {item.sectionCode}</span>
        )}
      </div>
      <p className="text-xs text-text-tertiary">
        {item.source === 'ubc' ? 'UBC exam schedule' : 'From your syllabus — double-check this date'}
      </p>
      {item.cancelled ? (
        <div className="mt-1 line-through decoration-2 opacity-70">{body}</div>
      ) : (
        <div className="mt-1">{body}</div>
      )}
    </div>
  );
}

export default function ExamList({ items }: { items: ExamListItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        UBC hasn&apos;t published the final exam schedule for this term yet — it usually appears
        partway through term.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ExamRow key={item.id} item={item} />
      ))}
    </div>
  );
}
