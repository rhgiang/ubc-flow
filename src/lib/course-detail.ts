import { db } from '@/lib/db';
import { aggregateDistributions, type GradeSummary } from '@/grades/aggregate';
import { aggregateInstructorReviews } from '@/reviews/aggregate';
import type { SectionMeetingTime } from '@/lib/search';
import type { HistoricalGradeTerm } from '@/components/HistoricalGradesTimeline';
import type { Requirement } from '@/prereqs/parse';

/** Our own verified-enrolment reviews for one instructor, across all their
 *  courses — the same basis the professor page uses. Null when unrated. */
export type InstructorRatingSummary = {
  count: number;
  likedPercent: number | null;
  clear: number | null;
  engaging: number | null;
};

/**
 * An instructor's historical grade average FOR THIS COURSE, from UBC's own
 * published distributions (2021S onward — see the note on `courseAverage`).
 *
 * This is an average GRADE, not a teaching-quality score: a demanding course
 * taught well can sit below its own mean. The UI must label it as such.
 */
export type InstructorGradeHistory = {
  average: number;
  offerings: number;
  students: number;
  /** Buckets summed across this instructor's offerings, for the course-vs-instructor chart. */
  distribution: GradeSummary['distribution'];
  /** At least one contributing offering was co-taught, so the figure is shared. */
  coTaught: boolean;
};

export type CourseSectionDetail = {
  sectionId: string;
  sectionCode: string;
  activity: string | null;
  status: string | null;
  meetings: string;
  /** Carried so the overlay can build a complete SectionHit when a student
   *  adds a section from here, without a second round trip. */
  meetingTimes: SectionMeetingTime[];
  enrolTotal: number | null;
  enrolCap: number | null;
  instructors: {
    name: string;
    slug: string;
    rating: InstructorRatingSummary | null;
    grades: InstructorGradeHistory | null;
  }[];
};

export type CourseDetail = {
  courseId: string;
  code: string;
  title: string;
  description: string | null;
  credits: number | null;
  /** Link to the full course page — the overlay is never a redirect. */
  href: string;
  sections: CourseSectionDetail[];
  grades: GradeSummary;
  /** Weighted mean across ALL of this course's graded offerings — the baseline
   *  an instructor's own average is compared against. Null when ungraded. */
  courseAverage: number | null;
  historical: {
    average: number | null;
    averagePast5Years: number | null;
    minSectionAverage: number | null;
    maxSectionAverage: number | null;
    stddev: number | null;
  } | null;
  historicalByTerm: HistoricalGradeTerm[];
  prereqTree: Requirement | null;
  coreqTree: Requirement | null;
  prereqText: string | null;
  coreqText: string | null;
};

/**
 * Everything the schedule builder's course overlay shows, in one call.
 *
 * Sections are scoped to the term being planned — a section from another term
 * could not be added to this schedule, so showing it would be an invitation to
 * a dead end. The grade and requirement data is course-wide and term-agnostic.
 */
export async function loadCourseDetail(
  courseId: string,
  termId: string,
): Promise<CourseDetail | null> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: { subject: true },
  });
  if (!course) return null;

  const [sectionRows, gradeRows, historical, historicalByTerm] = await Promise.all([
    db.section.findMany({
      where: { courseId, termId },
      include: {
        meetingTimes: true,
        instructors: { include: { instructor: true } },
      },
      orderBy: { sectionCode: 'asc' },
    }),
    db.gradeDistribution.findMany({
      where: { courseId },
      select: { average: true, count: true, distribution: true },
    }),
    db.courseHistoricalGrades.findUnique({ where: { courseId } }),
    db.courseHistoricalGradesByTerm.findMany({
      where: { courseId },
      select: { year: true, session: true, average: true },
    }),
  ]);

  const code = `${course.subject.code ?? ''} ${course.number}`.trim();

  // Ratings are keyed on instructor, not on (instructor, course) — the data is
  // sparse enough that a per-course split would almost always be empty, and
  // this matches what the professor page already shows.
  const instructorIds = [
    ...new Set(sectionRows.flatMap((s) => s.instructors.map((si) => si.instructorId))),
  ];
  const reviewRows = instructorIds.length
    ? await db.instructorReview.findMany({
        where: { instructorId: { in: instructorIds } },
        select: { instructorId: true, liked: true, clear: true, engaging: true },
      })
    : [];

  const reviewsByInstructor = new Map<string, typeof reviewRows>();
  for (const r of reviewRows) {
    const list = reviewsByInstructor.get(r.instructorId) ?? [];
    list.push(r);
    reviewsByInstructor.set(r.instructorId, list);
  }

  const ratingFor = (instructorId: string): InstructorRatingSummary | null => {
    const rows = reviewsByInstructor.get(instructorId);
    if (!rows || rows.length === 0) return null;
    const agg = aggregateInstructorReviews(rows);
    return {
      count: agg.count,
      likedPercent: agg.likedPercent,
      clear: agg.clear,
      engaging: agg.engaging,
    };
  };

  // GradeDistributionInstructor links each distribution to everyone who taught
  // it. 11% of distributions are co-taught, so a distribution can appear under
  // more than one instructor — that is correct here (each taught those
  // students) but it means a shared offering must never be summed into the
  // course-wide figure twice, which is why courseAverage is computed from
  // gradeRows above rather than from these links.
  const gradeLinks = instructorIds.length
    ? await db.gradeDistributionInstructor.findMany({
        where: { instructorId: { in: instructorIds }, distribution: { courseId } },
        select: {
          instructorId: true,
          distributionId: true,
          // The outer key is the relation to GradeDistribution; the inner
          // `distribution` is that row's bucket JSON.
          distribution: { select: { average: true, count: true, distribution: true } },
        },
      })
    : [];

  // How many instructors share each distribution — used only to flag co-teaching.
  const sharersPerDistribution = new Map<string, number>();
  for (const l of gradeLinks) {
    sharersPerDistribution.set(
      l.distributionId,
      (sharersPerDistribution.get(l.distributionId) ?? 0) + 1,
    );
  }

  const gradesByInstructor = new Map<string, InstructorGradeHistory>();
  for (const instructorId of instructorIds) {
    const mine = gradeLinks.filter(
      (l) =>
        l.instructorId === instructorId &&
        l.distribution.average !== null &&
        l.distribution.count !== null &&
        l.distribution.count > 0,
    );
    if (mine.length === 0) continue;

    // Same weighted-by-students average the course side uses, plus the summed
    // buckets. `mine` is already filtered to rows with a usable average and a
    // positive count, so `average` here is never null.
    const agg = aggregateDistributions(
      mine.map((l) => ({
        average: l.distribution.average,
        count: l.distribution.count,
        distribution: l.distribution.distribution as Record<string, number | null> | null,
      })),
    );
    gradesByInstructor.set(instructorId, {
      average: agg.average!,
      offerings: agg.sectionCount,
      students: agg.studentCount,
      distribution: agg.distribution,
      coTaught: mine.some((l) => (sharersPerDistribution.get(l.distributionId) ?? 1) > 1),
    });
  }

  const courseGrades = aggregateDistributions(
    gradeRows.map((g) => ({
      average: g.average,
      count: g.count,
      distribution: g.distribution as Record<string, number | null> | null,
    })),
  );

  return {
    courseId: course.id,
    code,
    title: course.title,
    description: course.description,
    credits: course.credits,
    href: `/course/${code.toLowerCase().replace(/\s+/g, '-')}`,
    sections: sectionRows.map((s) => ({
      sectionId: s.id,
      sectionCode: s.sectionCode,
      activity: s.activity,
      status: s.status,
      meetings:
        s.meetingTimes
          .filter((m) => m.startTime && m.endTime)
          .map((m) => `${m.day} ${m.startTime}–${m.endTime}`)
          .join(', ') || 'No fixed time',
      meetingTimes: s.meetingTimes.map((m) => ({
        day: m.day,
        startTime: m.startTime,
        endTime: m.endTime,
        building: m.building,
        room: m.room,
      })),
      enrolTotal: s.enrolTotal,
      enrolCap: s.enrolCap,
      instructors: s.instructors.map((si) => ({
        name: si.instructor.name,
        slug: si.instructor.slug,
        rating: ratingFor(si.instructorId),
        grades: gradesByInstructor.get(si.instructorId) ?? null,
      })),
    })),
    grades: courseGrades,
    courseAverage: courseGrades.average,
    historical: historical
      ? {
          average: historical.average,
          averagePast5Years: historical.averagePast5Years,
          minSectionAverage: historical.minSectionAverage,
          maxSectionAverage: historical.maxSectionAverage,
          stddev: historical.stddev,
        }
      : null,
    historicalByTerm,
    // Prisma types these Json columns as JsonValue; the course page casts the
    // same way (src/app/course/[code]/page.tsx).
    prereqTree: course.prereqTree as unknown as Requirement | null,
    coreqTree: course.coreqTree as unknown as Requirement | null,
    prereqText: course.prereqText,
    coreqText: course.coreqText,
  };
}
