import Link from 'next/link';
import type { Requirement } from '@/prereqs/parse';

/** "CPSC 221" -> "cpsc-221", matching the course page's own slug convention. */
function href(code: string): string {
  return `/course/${code.toLowerCase().replace(/\s+/g, '-')}`;
}

export default function RequirementTree({ node }: { node: Requirement }) {
  if (node.type === 'course') {
    // An unresolved code still shows — we just cannot link it (spec 5.2).
    return node.courseId ? (
      <Link href={href(node.code)} className="text-blue-700 hover:underline">
        {node.code}
      </Link>
    ) : (
      <span className="text-slate-700">{node.code}</span>
    );
  }

  if (node.type === 'note') {
    return <span className="text-slate-600">{node.text}</span>;
  }

  // ponytail: the page casts stored JSON `as unknown as Requirement`, so a
  // corrupted row or a future schema change could hand us a `type` this
  // component doesn't recognize. Render nothing rather than assume it's a
  // group and crash reading `.items`.
  if (node.type !== 'and' && node.type !== 'or') {
    return null;
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {node.type === 'or' ? 'One of' : 'All of'}
      </p>
      <ul className="mt-1 space-y-1 border-l pl-4">
        {node.items.map((item, i) => (
          <li key={i}>
            <RequirementTree node={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}
