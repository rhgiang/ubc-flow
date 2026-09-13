import { describe, it, expect } from 'vitest';
import {
  parseUbcCourseCode,
  secondsToTime,
  parseDays,
  buildIncludedMap,
  parseSectionNode,
} from '@/scrape/parse-nodes';

describe('parseUbcCourseCode', () => {
  it('splits a Vancouver code', () => {
    expect(parseUbcCourseCode('CPSC_V 221')).toEqual({
      subjectCode: 'CPSC',
      campus: 'V',
      number: '221',
    });
  });

  it('splits an Okanagan code', () => {
    expect(parseUbcCourseCode('EXCH_O 580')).toEqual({
      subjectCode: 'EXCH',
      campus: 'O',
      number: '580',
    });
  });

  it('keeps a lettered course number', () => {
    expect(parseUbcCourseCode('MATH_V 100A')?.number).toBe('100A');
  });

  it('returns null on an unparseable code', () => {
    expect(parseUbcCourseCode('nonsense')).toBeNull();
  });
});

describe('secondsToTime', () => {
  it('converts a whole hour', () => {
    expect(secondsToTime(50400)).toBe('14:00');
  });

  it('converts a half hour', () => {
    expect(secondsToTime(34200)).toBe('09:30');
  });

  it('handles midnight', () => {
    expect(secondsToTime(0)).toBe('00:00');
  });

  it('passes null through', () => {
    expect(secondsToTime(null)).toBeNull();
  });
});

describe('parseDays', () => {
  it('maps UBC day codes to three-letter days', () => {
    expect(parseDays(['m', 'w', 'f'])).toEqual(['Mon', 'Wed', 'Fri']);
  });

  it('distinguishes t from th', () => {
    expect(parseDays(['t', 'th'])).toEqual(['Tue', 'Thu']);
  });

  it('returns empty for an unscheduled section', () => {
    expect(parseDays([])).toEqual([]);
    expect(parseDays(null)).toEqual([]);
  });

  it('ignores unknown codes rather than emitting junk', () => {
    expect(parseDays(['m', 'zz'])).toEqual(['Mon']);
  });
});

describe('parseSectionNode', () => {
  const included = buildIncludedMap([
    {
      type: 'taxonomy_term--status',
      id: 'status-1',
      attributes: { name: 'Open' },
    },
    {
      type: 'taxonomy_term--instructional_method',
      id: 'method-1',
      attributes: { name: 'Lecture' },
    },
    {
      type: 'taxonomy_term--delivery_mode',
      id: 'delivery-1',
      attributes: { name: 'In person' },
    },
    {
      type: 'node--course',
      id: 'course-1',
      attributes: {
        title: 'Basic Algorithms and Data Structures',
        field_course_code: 'CPSC_V 221',
        field_course_number: '221',
        field_credits: '4.00',
        body: { value: '<p>Design and analysis. Prerequisite: One of CPSC_V 210.</p>' },
      },
      relationships: {
        field_subject: {
          data: { type: 'taxonomy_term--subject', id: 'subject-1810', meta: { drupal_internal__target_id: 1810 } },
        },
      },
    },
  ]);

  const node = {
    type: 'node--section',
    id: 'section-1',
    attributes: {
      title: 'Basic Algorithms and Data Structures :: 2026 :: Sec 101',
      field_section_number: '101',
      field_days: ['m', 'w', 'f'],
      field_start_time: 50400,
      field_end_time: 54000,
      field_instructors: ['Parsa Rajabi'],
      field_is_visible: true,
    },
    relationships: {
      field_course: { data: { type: 'node--course', id: 'course-1' } },
      field_status: { data: { type: 'taxonomy_term--status', id: 'status-1' } },
      field_instructional_method: {
        data: { type: 'taxonomy_term--instructional_method', id: 'method-1' },
      },
      field_delivery_mode: {
        data: { type: 'taxonomy_term--delivery_mode', id: 'delivery-1' },
      },
    },
  };

  it('resolves the course through the included map', () => {
    const r = parseSectionNode(node, included);
    // ponytail: `as given` test asserts through a possibly-null field; strict mode
    // needs the non-null assertion since the brief's course fixture is always present here.
    expect(r.course!.subjectCode).toBe('CPSC');
    expect(r.course!.number).toBe('221');
    expect(r.course!.campus).toBe('V');
    expect(r.course!.title).toBe('Basic Algorithms and Data Structures');
    expect(r.course!.credits).toBe(4);
  });

  it('coerces the subject relationship meta id to a string, matching Subject.ubcSubjectId', () => {
    const r = parseSectionNode(node, included);
    // Verified live: CPSC_V 221's field_subject meta id is 1810, the same numeric
    // id Task 5 stored as Subject.ubcSubjectId for "Computer Science (Vancouver)".
    expect(r.course!.ubcSubjectId).toBe('1810');
  });

  it('returns a null ubcSubjectId when the course node has no subject relationship', () => {
    const courseWithoutSubject = buildIncludedMap([
      {
        type: 'node--course',
        id: 'course-2',
        attributes: {
          title: 'No Subject Course',
          field_course_code: 'CPSC_V 999',
          field_credits: '3.00',
        },
      },
    ]);
    const nodeWithoutSubject = {
      ...node,
      relationships: {
        ...node.relationships,
        field_course: { data: { type: 'node--course', id: 'course-2' } },
      },
    };
    const r = parseSectionNode(nodeWithoutSubject as never, courseWithoutSubject);
    expect(r.course!.ubcSubjectId).toBeNull();
  });

  it('resolves taxonomy relationships to names', () => {
    const r = parseSectionNode(node, included);
    expect(r.status).toBe('Open');
    expect(r.activity).toBe('Lecture');
    expect(r.deliveryMode).toBe('In person');
  });

  it('expands one meeting row per scheduled day', () => {
    const r = parseSectionNode(node, included);
    expect(r.meetings).toEqual([
      { day: 'Mon', startTime: '14:00', endTime: '15:00', building: null, room: null, startDate: null, endDate: null },
      { day: 'Wed', startTime: '14:00', endTime: '15:00', building: null, room: null, startDate: null, endDate: null },
      { day: 'Fri', startTime: '14:00', endTime: '15:00', building: null, room: null, startDate: null, endDate: null },
    ]);
  });

  it('captures the section date range onto every meeting row', () => {
    const node = {
      type: 'node--section',
      id: 'section-dates',
      attributes: {
        field_section_number: '101',
        field_days: ['m', 'w'],
        field_start_time: 50400,
        field_end_time: 54000,
        field_start_date: '2027-01-06',
        field_end_date: '2027-02-12',
        field_instructors: [],
      },
      relationships: {
        field_course: { data: { type: 'node--course', id: 'course-1' } },
      },
    };

    const r = parseSectionNode(node as never, included);
    expect(r.meetings).toHaveLength(2);
    // Same range on every day of the section - they share one enrolment period.
    // Prisma's DateTime? columns need a real Date, not a plain date string
    // (verified against the live backfill), so parseSectionNode converts here.
    for (const m of r.meetings) {
      expect(m.startDate).toEqual(new Date('2027-01-06'));
      expect(m.endDate).toEqual(new Date('2027-02-12'));
    }
  });

  it('leaves meeting dates null when the section has none', () => {
    const node = {
      type: 'node--section',
      id: 'section-nodates',
      attributes: {
        field_section_number: '102',
        field_days: ['f'],
        field_start_time: 50400,
        field_end_time: 54000,
        field_instructors: [],
      },
      relationships: {
        field_course: { data: { type: 'node--course', id: 'course-1' } },
      },
    };

    const r = parseSectionNode(node as never, included);
    expect(r.meetings[0].startDate).toBeNull();
    expect(r.meetings[0].endDate).toBeNull();
  });

  it('normalises instructor names', () => {
    expect(parseSectionNode(node, included).instructorNames).toEqual(['Parsa Rajabi']);
  });

  it('returns null course for a section whose course is missing from included', () => {
    const orphan = {
      ...node,
      relationships: { ...node.relationships, field_course: { data: null } },
    };
    expect(parseSectionNode(orphan as never, included).course).toBeNull();
  });

  it('handles an unscheduled section with no days or times', () => {
    const unscheduled = {
      ...node,
      attributes: {
        ...node.attributes,
        field_days: [],
        field_start_time: null,
        field_end_time: null,
        field_instructors: [],
      },
    };
    const r = parseSectionNode(unscheduled as never, included);
    expect(r.meetings).toEqual([]);
    expect(r.instructorNames).toEqual([]);
  });
});
