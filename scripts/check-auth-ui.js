/**
 * Does the UI notice that you signed in?
 *
 * The nav and the home hero both read the session in a browser-side effect, so
 * that pages can be served from the CDN instead of re-rendered per request.
 * That read went stale for a whole tab once: signing in left the home login
 * card on screen and left Account still opening the login overlay, so a
 * perfectly good sign-in looked like nothing had happened. Nothing in the unit
 * suite could see it - it only exists in a real browser, across the moment the
 * session changes.
 *
 * Only the client-side session read is faked, so every assertion here is about
 * what the client does with the answer; nothing depends on a server session.
 *
 *   node scripts/check-auth-ui.js [base-url]   # default http://localhost:3000
 */
const { chromium, devices } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'] });
  await ctx.addInitScript(() => localStorage.setItem('theme', 'light'));

  let signedIn = false;
  await ctx.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: signedIn ? JSON.stringify({ user: { id: 'u1', email: 'x@example.invalid' } }) : 'null',
    }),
  );

  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const passwordFields = () => page.locator('form input[name="password"]').count();
  const checks = {};

  checks['home shows the login card while signed out'] = (await passwordFields()) > 0;

  // Exactly the transition a real sign-in makes.
  signedIn = true;
  await page.evaluate(() => window.dispatchEvent(new Event('ubcflow:session-changed')));
  await page.waitForTimeout(900);

  checks['home drops the login card once signed in'] = (await passwordFields()) === 0;

  await page.getByRole('button', { name: /open menu/i }).click();
  await page.waitForTimeout(300);
  const account = page.getByRole('link', { name: 'Account' });
  checks['Account points at the account page, not the login overlay'] =
    (await account.count()) > 0 && /\/onboarding/.test((await account.first().getAttribute('href')) ?? '');

  await browser.close();

  let failed = 0;
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed ? `\n${failed} failing` : '\nall good');
  process.exit(failed ? 1 : 0);
})();
