// src/canvas/emails.ts
import { formatVancouver } from './tz';
import { shortCourseLabel } from './course-label';
import type { DeadlineForNotice, Notice, Prefs } from './notices';
import {
  FOOTER_ACCOUNT,
  button,
  fallbackLink,
  footerWithMute,
  para,
  renderEmail,
  row,
  section,
} from '@/lib/email-layout';

export const SITE = process.env.NEXTAUTH_URL ?? 'https://ubcflow.com';

/** At most this many items in one section before it stops listing and counts.
 *  A pathological feed must not produce a body Resend refuses, which would
 *  strand every claim in it and retry the same oversized message forever. */
const MAX_PER_SECTION = 25;

/** Every email carries both parts. The text is the accessible one. */
export type Mail = { subject: string; body: string; html: string };

function textLine(d: DeadlineForNotice): string {
  const when = formatVancouver(d.dueAt, d.allDay);
  const course = shortCourseLabel(d.courseName);
  return `${course ? `${course}: ` : ''}${d.title}\n    due ${when}${d.url ? `\n    ${d.url}` : ''}`;
}

const textFooter = (muteUrl: string) =>
  `\n\nYou get these because you connected Canvas on UBC Flow. Change lead times or stop them here:\n${muteUrl}`;

/** Soonest first, then capped. Sorting before the slice matters: a capped
 *  section must show the most urgent, not an arbitrary twenty-five, or the
 *  subject can name something the body leaves out. */
function ordered(ns: Notice[]): { shown: Notice[]; rest: number } {
  const sorted = [...ns].sort((a, b) => a.deadline.dueAt.getTime() - b.deadline.dueAt.getTime());
  return { shown: sorted.slice(0, MAX_PER_SECTION), rest: Math.max(0, sorted.length - MAX_PER_SECTION) };
}

function leadWords(prefs: Prefs): string {
  return prefs.leadHours
    .map((h) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hours`))
    .join(' and ');
}

export function welcomeEmail(items: DeadlineForNotice[], prefs: Prefs, muteUrl: string): Mail {
  const leads = leadWords(prefs);
  const subject = 'Canvas connected: your upcoming deadlines';
  const body =
    `Canvas is connected. Due in the next 14 days:\n\n` +
    `${items.length ? items.map(textLine).join('\n\n') : 'Nothing due in the next 14 days.'}\n\n` +
    `From now on you get an email ${leads} before each deadline, and one when a prof moves or removes something.` +
    textFooter(muteUrl);

  const list = items.length
    ? items
        .map((d) =>
          row({
            title: d.title,
            meta: shortCourseLabel(d.courseName),
            when: formatVancouver(d.dueAt, d.allDay),
            url: d.url,
          }),
        )
        .join('')
    : para('Nothing due in the next 14 days.');

  const html = renderEmail({
    title: subject,
    preheader: items.length
      ? `${items.length} due in the next 14 days.`
      : 'Nothing due in the next 14 days.',
    heading: 'Canvas is connected',
    rows:
      para(`From now on you get an email ${leads} before each deadline, and one whenever an instructor moves or removes something.`) +
      section('Due in the next 14 days') +
      list +
      button('See all your deadlines', `${SITE}/deadlines`),
    footer: footerWithMute(muteUrl),
  });

  return { subject, body, html };
}

export function reminderEmail(notices: Notice[], muteUrl: string): Mail {
  const leads = notices.filter((n) => n.kind === 'lead');
  const moved = notices.filter((n) => n.kind === 'moved');
  const removed = notices.filter((n) => n.kind === 'removed');
  const soonest = [...leads].sort((a, b) => a.deadline.dueAt.getTime() - b.deadline.dueAt.getTime())[0];

  const parts: string[] = [];
  if (leads.length) parts.push(`${leads.length} due soon`);
  if (moved.length) parts.push(`${moved.length} moved`);
  if (removed.length) parts.push(`${removed.length} removed`);
  const subject = soonest
    ? `${parts.join(', ')}: ${shortCourseLabel(soonest.deadline.courseName)} ${soonest.deadline.title}`.trim()
    : parts.join(', ');

  const wasWhen = (n: Notice) =>
    n.deadline.movedFrom ? formatVancouver(n.deadline.movedFrom, n.deadline.allDay) : 'unknown';

  // --- plain text ---
  const textSection = (title: string, ns: Notice[], extra?: (n: Notice) => string) => {
    if (!ns.length) return '';
    const { shown, rest } = ordered(ns);
    const listed = shown.map((n) => textLine(n.deadline) + (extra ? extra(n) : '')).join('\n\n');
    const more = rest ? `\n\nand ${rest} more. See them all at ${SITE}/deadlines` : '';
    return `${title}\n\n${listed}${more}`;
  };
  const body =
    [
      textSection('Due soon', leads),
      textSection('Moved', moved, (n) => `\n    was ${wasWhen(n)}`),
      textSection('Removed by your instructor', removed),
    ]
      .filter(Boolean)
      .join('\n\n') + textFooter(muteUrl);

  // --- html ---
  const htmlSection = (title: string, ns: Notice[], note?: (n: Notice) => string) => {
    if (!ns.length) return '';
    const { shown, rest } = ordered(ns);
    const listed = shown
      .map((n) =>
        row({
          title: n.deadline.title,
          meta: shortCourseLabel(n.deadline.courseName),
          when: formatVancouver(n.deadline.dueAt, n.deadline.allDay),
          note: note ? note(n) : undefined,
          url: n.deadline.url,
        }),
      )
      .join('');
    const more = rest ? para(`and ${rest} more.`) : '';
    return section(title) + listed + more;
  };

  const html = renderEmail({
    title: subject,
    preheader: soonest
      ? `${soonest.deadline.title} is due ${formatVancouver(soonest.deadline.dueAt, soonest.deadline.allDay)}.`
      : parts.join(', '),
    heading: parts.join(', ') || 'Your Canvas deadlines',
    rows:
      htmlSection('Due soon', leads) +
      htmlSection('Moved', moved, (n) => `Was ${wasWhen(n)}`) +
      htmlSection('Removed by your instructor', removed) +
      button('Open your deadlines', `${SITE}/deadlines`),
    footer: footerWithMute(muteUrl),
  });

  return { subject, body, html };
}

export function reconnectEmail(accountUrl: string): Mail {
  const subject = 'Your Canvas feed stopped answering';
  const body =
    `UBC Flow could not read your Canvas calendar feed. This usually means the link was regenerated in Canvas. ` +
    `Paste a fresh Calendar Feed link to reconnect:\n${accountUrl}\n\nUntil then, deadline reminders are paused.`;

  const html = renderEmail({
    title: subject,
    preheader: 'Paste a fresh Calendar Feed link to start them again.',
    heading: 'Your Canvas feed stopped answering',
    rows:
      para('UBC Flow could not read your Canvas calendar feed. This usually means the link was regenerated in Canvas.') +
      para('Until you reconnect, deadline reminders are paused. Your deadlines page still shows the last good read.') +
      button('Reconnect Canvas', accountUrl) +
      fallbackLink(accountUrl),
    footer: FOOTER_ACCOUNT,
  });

  return { subject, body, html };
}
