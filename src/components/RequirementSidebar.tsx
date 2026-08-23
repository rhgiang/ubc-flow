import Link from 'next/link';
import RequirementTree from '@/components/RequirementTree';
import type { Requirement } from '@/prereqs/parse';

type AntireqRef = { code: string; courseId: string | null };
type LeadsToRef = { code: string; courseId: string };

function courseHref(code: string): string {
  return `/course/${code.toLowerCase().replace(/\s+/g, '-')}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-2 text-sm text-text-secondary">{children}</div>
    </div>
  );
}

// Small print under a parsed tree (or in place of one the parser bailed on) —
// the parser is heuristic (see BAILOUT/AMBIGUOUS in src/prereqs/parse.ts) and
// can misread an ambiguous clause, so the raw calendar text stays one glance
// away for a reader to double-check.
function RawTextFootnote({ text }: { text: string }) {
  return (
    <p className="mt-2 text-xs text-text-secondary">As published in the calendar: {text}</p>
  );
}

export default function RequirementSidebar({
  courseCode,
  prereqTree,
  coreqTree,
  prereqText,
  coreqText,
  antireqs,
  leadsTo,
}: {
  courseCode: string;
  prereqTree: Requirement | null;
  coreqTree: Requirement | null;
  prereqText: string | null;
  coreqText: string | null;
  antireqs: AntireqRef[];
  leadsTo: LeadsToRef[];
}) {
  return (
    <aside className="rounded-card border border-border p-5">
      <Section title={`${courseCode} prerequisites`}>
        {!prereqText ? (
          'No prerequisites'
        ) : (
          <>
            {prereqTree ? (
              <RequirementTree node={prereqTree} />
            ) : (
              <span>Could not be parsed into a structured list.</span>
            )}
            <RawTextFootnote text={prereqText} />
          </>
        )}
      </Section>

      <Section title={`${courseCode} corequisites`}>
        {!coreqText ? (
          'No corequisites'
        ) : (
          <>
            {coreqTree ? (
              <RequirementTree node={coreqTree} />
            ) : (
              <span>Could not be parsed into a structured list.</span>
            )}
            <RawTextFootnote text={coreqText} />
          </>
        )}
      </Section>

      <Section title={`${courseCode} antirequisites`}>
        {antireqs.length === 0 ? (
          'No antirequisites'
        ) : (
          <ul className="space-y-1">
            {antireqs.map((a) => (
              <li key={a.code}>
                {a.courseId ? (
                  <Link href={courseHref(a.code)} className="text-brand-accent hover:underline">
                    {a.code}
                  </Link>
                ) : (
                  <span>{a.code}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`${courseCode} leads to`}>
        {leadsTo.length === 0 ? (
          'No courses require this one'
        ) : (
          <ul className="space-y-1">
            {leadsTo.map((c) => (
              <li key={c.courseId}>
                <Link href={courseHref(c.code)} className="text-brand-accent hover:underline">
                  {c.code}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}
