import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { canReview } from '@/lib/gate';
import { parseCourseCode } from '@/lib/format';
import { ReviewForm } from './form';

export default async function ReviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parsed = parseCourseCode(code);
  if (!parsed) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect(`/login`);

  const course = await db.course.findFirst({
    where: { number: parsed.number, subject: { code: parsed.subjectCode, campus: 'V' } },
    include: {
      subject: true,
      sections: { include: { instructors: { include: { instructor: true } } } },
    },
  });
  if (!course) notFound();

  // The gate decides, server-side. Never render the form to someone who
  // cannot submit — and the action re-checks anyway.
  if (!(await canReview(session.user.id, course.id))) redirect(`/course/${code}`);

  // One instructor teaches many sections; show each once.
  const instructors = [
    ...new Map(
      course.sections
        .flatMap((s) => s.instructors.map((si) => si.instructor))
        .map((i) => [i.id, i]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const existing = await db.courseReview.findUnique({
    where: { userId_courseId: { userId: session.user.id, courseId: course.id } },
  });

  const existingInstructors = await db.instructorReview.findMany({
    where: { userId: session.user.id, courseId: course.id },
  });

  return (
    <ReviewForm
      courseId={course.id}
      courseCode={code}
      courseLabel={`${course.subject.code} ${course.number}`}
      courseTitle={course.title}
      instructors={instructors.map((i) => ({ id: i.id, name: i.name }))}
      existing={
        existing && {
          liked: existing.liked,
          useful: existing.useful,
          difficulty: existing.difficulty,
          workloadHours: existing.workloadHours,
          text: existing.text,
        }
      }
      existingInstructors={existingInstructors.map((r) => ({
        instructorId: r.instructorId,
        liked: r.liked,
        clear: r.clear,
        engaging: r.engaging,
        text: r.text,
      }))}
    />
  );
}
