/**
 * Assigns each entry in ONE day a horizontal column, the way Google Calendar
 * and Notion Calendar lay out overlapping events: entries that overlap in time
 * sit side by side instead of covering each other.
 *
 * Returns, per entry, its 0-based `column` and the `columns` total it should
 * divide width by. `columns` is computed per overlap CLUSTER, not per day, so
 * a lone afternoon class still spans the full width even when the morning has
 * three overlapping ones.
 *
 * Back-to-back entries (one ends exactly when the next starts) do NOT overlap
 * - same rule findConflicts uses.
 */
export function layoutDayColumns<T>(
  entries: T[],
  getRange: (entry: T) => { start: number; end: number },
): Map<T, { column: number; columns: number }> {
  const out = new Map<T, { column: number; columns: number }>();
  const sorted = [...entries].sort((a, b) => {
    const ra = getRange(a);
    const rb = getRange(b);
    return ra.start - rb.start || ra.end - rb.end;
  });

  // A cluster is a run of entries chained by overlap. Everything in one
  // cluster shares a column count so their widths line up.
  let cluster: T[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const assigned = new Map<T, number>();
    for (const entry of cluster) {
      const { start, end } = getRange(entry);
      let col = columnEnds.findIndex((endsAt) => endsAt <= start);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(end);
      } else {
        columnEnds[col] = end;
      }
      assigned.set(entry, col);
    }
    for (const [entry, column] of assigned) {
      out.set(entry, { column, columns: columnEnds.length });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const entry of sorted) {
    const { start, end } = getRange(entry);
    if (cluster.length > 0 && start >= clusterEnd) flush();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();

  return out;
}
