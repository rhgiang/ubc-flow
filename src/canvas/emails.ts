// src/canvas/emails.ts
import { formatVancouver } from './tz';
import type { DeadlineForNotice, Notice, Prefs } from './notices';

/** Absolute base for links in these emails: they are read outside the
 *  browser, so a relative path is no use. Production sets NEXTAUTH_URL. One
 *  definition, shared with the jobs that build the mute and account links. */
export const SITE = process.env.NEXTAUTH_URL ?? 'https://ubcflow.com';

/** A pathological feed would otherwise concatenate into a body Resend
 *  rejects, leaving every claim in that run undelivered and retrying every
 *  four hours forever. Only the rendering is bounded: notify claims every
 *  notice regardless, so nothing capped out here fires again later. */
const MAX_PER_SECTION = 25;

function line(d: DeadlineForNotice): string {
  const when = formatVancouver(d.dueAt, d.allDay);
  return `${d.courseName ? `${d.courseName}: ` : ''}${d.title}\n    due ${when}${d.url ? `\n    ${d.url}` : ''}`;
}

const footer = (muteUrl: string) =>
  `\n\nYou get these because you connected Canvas on UBC Flow. Change lead times or stop them here:\n${muteUrl}`;

export function welcomeEmail(items: DeadlineForNotice[], prefs: Prefs, muteUrl: string) {
  const leads = prefs.leadHours.map((h) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hours`)).join(' and ');
  const list = items.length ? items.map(line).join('\n\n') : 'Nothing due in the next 14 days.';
  return {
    subject: 'Canvas connected: your upcoming deadlines',
    body: `Canvas is connected. Due in the next 14 days:\n\n${list}\n\nFrom now on you get an email ${leads} before each deadline, and one when a prof moves or removes something.${footer(muteUrl)}`,
  };
}

export function reminderEmail(notices: Notice[], muteUrl: string) {
  const leads = notices.filter((n) => n.kind === 'lead');
  const moved = notices.filter((n) => n.kind === 'moved');
  const removed = notices.filter((n) => n.kind === 'removed');
  const soonest = [...leads].sort((a, b) => a.deadline.dueAt.getTime() - b.deadline.dueAt.getTime())[0];
  const parts: string[] = [];
  if (leads.length) parts.push(`${leads.length} due soon`);
  if (moved.length) parts.push(`${moved.length} moved`);
  if (removed.length) parts.push(`${removed.length} removed`);
  const subject = soonest
    ? `${parts.join(', ')}: ${soonest.deadline.courseName} ${soonest.deadline.title}`.trim()
    : parts.join(', ');

  const section = (title: string, ns: Notice[], extra?: (n: Notice) => string) => {
    if (!ns.length) return '';
    const shown = ns.slice(0, MAX_PER_SECTION);
    const rest = ns.length - shown.length;
    const listed = shown.map((n) => line(n.deadline) + (extra ? extra(n) : '')).join('\n\n');
    const more = rest ? `\n\nand ${rest} more. See them all at ${SITE}/deadlines` : '';
    return `${title}\n\n${listed}${more}`;
  };
  const body = [
    section('Due soon', leads),
    section('Moved', moved, (n) => `\n    was ${n.deadline.movedFrom ? formatVancouver(n.deadline.movedFrom, n.deadline.allDay) : 'unknown'}`),
    section('Removed by your instructor', removed),
  ].filter(Boolean).join('\n\n');
  return { subject, body: body + footer(muteUrl) };
}

export function reconnectEmail(accountUrl: string) {
  return {
    subject: 'Your Canvas feed stopped answering',
    body: `UBC Flow could not read your Canvas calendar feed. This usually means the link was regenerated in Canvas. Paste a fresh Calendar Feed link to reconnect:\n${accountUrl}\n\nUntil then, deadline reminders are paused.`,
  };
}
