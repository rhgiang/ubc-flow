import { type Instrumentation } from 'next';

/**
 * Server-side error reporting, in one place.
 *
 * The alternative was wrapping all thirty-odd server actions in try/catch so
 * each could log its own failure. This catches strictly more - actions, route
 * handlers and Server Component renders alike - without touching any of them,
 * and it cannot miss a new action somebody forgets to wrap.
 *
 * It deliberately does NOT change what the user sees. The client components
 * already catch a rejected action and show their own message, and app/error.tsx
 * covers a failed render; this is the half that was missing, which is anyone
 * being able to find out afterwards that it happened.
 */
/**
 * Vercel's free tier keeps console logs for about an hour and log drains are
 * a paid feature, so the JSON line below evaporates before anyone reads it.
 * The durable sink is the Resend account the site already sends mail with:
 * each error also lands in ALERT_EMAIL's inbox, at most one email per
 * fifteen minutes per server instance so an error loop cannot burn the
 * 100-a-day quota. Unset ALERT_EMAIL and only the console line happens.
 *
 * ponytail: per-instance cooldown, not a shared one - several warm lambdas
 * can each send once per window. Acceptable noise at this traffic; a
 * DB-backed cooldown is the upgrade if it ever isn't.
 */
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
let lastAlertAt = 0;

/**
 * The few request headers worth reporting, as "name: value" lines.
 *
 * An allow list, never the whole header bag: these reports go to an inbox,
 * and `cookie` and `authorization` are in there. Nothing here carries a
 * credential.
 *
 * These four are the ones that identify the error this was added for.
 * "Invalid Server Actions request." (digest @E80) is Next.js refusing a
 * Server Action whose `origin` disagrees with the host it arrived at, which
 * it treats as CSRF. Which two values disagreed is the whole diagnosis, and
 * the report used to carry neither, so every one of those alerts was a
 * question nobody could answer: the console line Next logs beside it names
 * them, and Vercel drops console logs after about an hour.
 */
const REPORTED_HEADERS = ['origin', 'host', 'x-forwarded-host', 'user-agent'] as const;

function headerLines(headers: NodeJS.Dict<string | string[]>): string[] {
  return REPORTED_HEADERS.flatMap((name) => {
    const value = headers[name];
    if (value === undefined) return [];
    return [`${name}: ${Array.isArray(value) ? value.join(', ') : value}`];
  });
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const message = err instanceof Error ? err.message : String(err);
  // The same digest app/error.tsx prints to the user as "Reference". It is the
  // only thing tying the screen they saw to the line below, so a support
  // question can be answered with more than a shrug.
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err ? String(err.digest) : undefined;

  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      kind: context.routeType, // 'action' | 'render' | 'route' | 'proxy'
      route: context.routePath,
      path: request.path,
      method: request.method,
      digest,
      message,
      headers: headerLines(request.headers),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

  const alertTo = process.env.ALERT_EMAIL;
  if (!alertTo || process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (Date.now() - lastAlertAt < ALERT_COOLDOWN_MS) return;
  lastAlertAt = Date.now();

  try {
    // Imported lazily: this file also loads in the edge runtime, where the
    // Prisma client behind sendMail's module graph cannot exist.
    const { sendMail } = await import('@/lib/mail');
    await sendMail(
      alertTo,
      `ubcflow error: ${message.slice(0, 80)}`,
      [
        `Route: ${context.routeType} ${context.routePath}`,
        `Path:  ${request.method} ${request.path}`,
        digest ? `Reference shown to the user: ${digest}` : null,
        '',
        ...headerLines(request.headers),
        '',
        message,
        '',
        err instanceof Error ? err.stack : '',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    );
  } catch (mailErr) {
    // The alert failing must never make the original error worse.
    console.error('error alert failed:', mailErr);
  }
};
