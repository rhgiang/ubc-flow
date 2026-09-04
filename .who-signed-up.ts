// Run against prod:  $env:DATABASE_URL = "<neon string>"  then  npx tsx .who-signed-up.ts
// Read-only. Prints signup dates and domains, never passwords or content.
import { db } from './src/lib/db';

async function main() {
  const users = await db.user.findMany({
    select: { email: true, createdAt: true, verifiedAt: true, emailVerified: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`total accounts: ${users.length}\n`);
  for (const u of users) {
    const domain = u.email.split('@')[1];
    const probe = u.email.startsWith('probe-') ? '  <- my test probe, ignore' : '';
    const flags = [
      u.emailVerified ? 'email-verified' : 'unverified',
      u.verifiedAt ? 'workday-verified' : null,
    ].filter(Boolean).join(', ');
    console.log(`${u.createdAt.toISOString().slice(0, 16)}  @${domain.padEnd(20)} ${flags}${probe}`);
  }
  const reviews = await db.courseReview.count();
  const irs = await db.instructorReview.count();
  console.log(`\ncourse reviews: ${reviews} | instructor reviews: ${irs}`);
}
main().then(() => process.exit(0));
