import { GRADE_BUCKETS, type GradeBucket } from '@/grades/parse-csv';

export type DistributionRow = {
  average: number | null;
  count: number | null;
  distribution: Record<string, number | null> | null;
};

export type GradeSummary = {
  sectionCount: number;
  studentCount: number;
  average: number | null;
  distribution: Record<GradeBucket, number | null>;
  /** True when at least one section had a suppressed bucket (spec 6). */
  suppressed: boolean;
};

export function aggregateDistributions(rows: DistributionRow[]): GradeSummary {
  let weighted = 0;
  let weight = 0;
  let studentCount = 0;
  let suppressed = false;

  const distribution = {} as Record<GradeBucket, number | null>;
  for (const bucket of GRADE_BUCKETS) distribution[bucket] = null;

  for (const r of rows) {
    if (r.count !== null && r.count !== undefined) studentCount += r.count;

    // A suppressed average carries no information — skip rather than treat as 0.
    if (r.average !== null && r.count !== null && r.count !== undefined) {
      weighted += r.average * r.count;
      weight += r.count;
    }

    for (const bucket of GRADE_BUCKETS) {
      // Only a bucket key that's explicitly present counts as reported-or-suppressed;
      // an absent key (as opposed to an explicit null) means this row said nothing about it.
      if (!r.distribution || !(bucket in r.distribution)) continue;
      const value = r.distribution[bucket];
      if (value === null) {
        suppressed = true;
        continue;
      }
      distribution[bucket] = (distribution[bucket] ?? 0) + value;
    }
  }

  return {
    sectionCount: rows.length,
    studentCount,
    // Weighted by students: a 300-person lecture must outweigh a 9-person seminar.
    average: weight > 0 ? weighted / weight : null,
    distribution,
    suppressed,
  };
}
