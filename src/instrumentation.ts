import { type Instrumentation } from 'next';

/**
 * Server-side error reporting, in one place.
 *
 * The alternative was wrapping all thirty-odd server actions in try/catch so
 * each could log its own failure. This catches strictly more — actions, route
 * handlers and Server Component renders alike — without touching any of them,
 * and it cannot miss a new action somebody forgets to wrap.
 *
 * It deliberately does NOT change what the user sees. The client components
 * already catch a rejected action and show their own message, and app/error.tsx
 * covers a failed render; this is the half that was missing, which is anyone
 * being able to find out afterwards that it happened.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
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
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
};
