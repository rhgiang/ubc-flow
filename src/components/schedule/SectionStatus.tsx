/**
 * "Open" / "Waitlist" / "Full" for a section row - one component so the
 * builder sidebar, the saved-courses list and the course overlay all colour
 * and word a status identically. UBC's raw value for full is "Closed", which
 * students read as cancelled; "Full" says what they mean.
 */
export default function SectionStatus({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <p
      title="As of the last daily catalogue refresh"
      className={`text-xs ${
        status === 'Closed'
          ? 'text-danger'
          : status === 'Waitlist'
            ? 'text-info'
            : 'text-text-tertiary'
      }`}
    >
      {status === 'Closed' ? 'Full' : status}
    </p>
  );
}
