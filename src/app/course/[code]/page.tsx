import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { parseCourseCode, formatMeeting } from '@/lib/format';

export default async function CoursePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parsed = parseCourseCode(code);
  if (!parsed) notFound();

  const course = await db.course.findFirst({
    where: {
      number: parsed.number,
      subject: { code: parsed.subjectCode, campus: 'V' },
    },
    include: {
      subject: true,
      sections: {
        include: {
          term: true,
          meetingTimes: true,
          instructors: { include: { instructor: true } },
        },
        orderBy: { sectionCode: 'asc' },
      },
    },
  });
  if (!course) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-sm text-slate-500">{course.subject.name}</p>
      <h1 className="text-3xl font-semibold">
        {course.subject.code} {course.number}
      </h1>
      <p className="mt-1 text-lg text-slate-700">{course.title}</p>

      {course.credits !== null && (
        <p className="mt-2 text-sm text-slate-500">{course.credits} credits</p>
      )}
      {course.description && <p className="mt-6 leading-relaxed">{course.description}</p>}

      {course.prereqText && (
        <p className="mt-4 text-sm text-slate-600">
          <span className="font-medium">Prerequisites: </span>
          {course.prereqText}
        </p>
      )}

      <h2 className="mt-10 text-xl font-semibold">Sections</h2>
      {course.sections.length === 0 ? (
        <p className="mt-2 text-slate-500">No scheduled sections.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2 pr-4">Section</th>
                <th className="py-2 pr-4">Term</th>
                <th className="py-2 pr-4">Activity</th>
                <th className="py-2 pr-4">Times</th>
                <th className="py-2">Instructor</th>
              </tr>
            </thead>
            <tbody>
              {course.sections.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{s.sectionCode}</td>
                  <td className="py-2 pr-4">{s.term.name}</td>
                  <td className="py-2 pr-4">{s.activity ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {s.meetingTimes.length
                      ? s.meetingTimes.map((m) => formatMeeting(m)).join(', ')
                      : '—'}
                  </td>
                  <td className="py-2">
                    {s.instructors.length
                      ? s.instructors.map((si) => (
                          <Link
                            key={si.instructorId}
                            href={`/professor/${si.instructor.slug}`}
                            className="text-blue-700 hover:underline"
                          >
                            {si.instructor.name}
                          </Link>
                        ))
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
