<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.png">
    <img src="docs/brand/logo-light.png" alt="UBC Flow" width="320">
  </picture>
</p>

Course planning for UBC students: course and professor reviews, real grade
distributions, a schedule builder that syncs to your calendar, and term-by-term
degree guidance.

Live at **[www.ubcflow.com](https://www.ubcflow.com)**. Next.js 16 (App Router)
on Postgres via Prisma, deployed on Vercel.

---

## Running it locally

Postgres is expected on **port 5442**, database `ubcflow`.

```bash
cp .env.example .env      # then fill it in, see below
npm install               # postinstall runs `prisma generate`
npx prisma migrate deploy
npm run dev
```

### Environment

| Key | What it's for |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | NextAuth session signing. `openssl rand -hex 32` |
| `SERVER_SECRET` | Server-side token signing |
| `NEXTAUTH_URL` | **Public origin.** Verification and password-reset emails are built from it; leave it unset in production and every link points at the recipient's own machine |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth. Redirect URI is `<origin>/api/auth/callback/google` |
| `RESEND_API_KEY` / `MAIL_FROM` | Transactional email. `MAIL_FROM` must be an address on a domain verified in Resend; the sandbox sender only delivers to the Resend account owner, which fails silently for everyone else |
| `FEED_ENCRYPTION_KEY` | 32 hex bytes, encrypts stored Canvas feed URLs. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Not rotatable without every student reconnecting |
| `ANTHROPIC_API_KEY` | Syllabus assessment extraction. Costs real money per call; the feature is capped per user per day |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob, private store, holds uploaded syllabus PDFs |
| `NEXT_PUBLIC_GA_ID` | Google Analytics. The only `NEXT_PUBLIC_` variable, and the only one that reaches the browser |
| `ALERT_EMAIL` | Optional. Where `src/instrumentation.ts` sends server errors |

### After pulling schema changes

`npx prisma generate`. This is not optional and the failure is confusing: a
dev server started *before* the client was regenerated keeps the old one in
memory, and every signed-in page 500s with `Unknown field 'status'` or
similar. Turbopack hot-reloads your source, not a binary in `node_modules`.
**restart the dev server too.**

---

## Data pipeline

Three scrapers that must run **in order**, because each depends on rows the
previous one wrote:

```
scrape:catalog        terms and subjects
  └─ scrape:sections  courses, sections, meeting times, instructors
       └─ scrape:descriptions   raw HTML → plain text + prereq/coreq text
            └─ enrich:prereqs   parses that text into the prereq graph
```

`npm run scrape:all` runs the chain correctly. It is also what
`.github/workflows/scrape.yml` runs weekly. Running them out of order does not
error. It silently writes against missing foreign rows.

`scrape:exams` (UBC's final exam table) runs on its own, daily, from
`.github/workflows/exams.yml`. It needs courses and the term to already exist.

Separate, run manually:

- `ingest:grades` / `ingest:historical-grades`: UBC PAIR distributions
- `scrape:faculties`: populates `Subject.faculty`, which breadth rules depend on
- `guidance:verify`: checks every guidance rule resolves to a real course

---

## Architecture notes

**`src/guidance/`** is the degree-requirements engine. Program requirements are
**checked-in TypeScript files** (`src/guidance/programs/*.ts`), not database
rows. A requirement change should arrive as a reviewable diff, not a silent
update, and this data is hand-transcribed from the UBC Calendar. Programs
compose via `extends`, so faculty-wide rules (Science core, Arts core) are
written once and inherited. `progress.ts` and `solver.ts` are pure functions,
which is where the tests concentrate.

**`src/scrape/`, `src/grades/`, `src/prereqs/`** are batch jobs, each with a
`jobs/*.run.ts` entry point. They talk to the DB directly and are not part of
the request path.

**`src/instrumentation.ts`** reports every server error, actions, route
handlers and RSC renders, from one place via `onRequestError`. The logged
`digest` is the same value `app/error.tsx` shows the user as "Reference", so a
support question maps to a log line.

---

## Gotchas

- **`npm run lint` is not clean, and hasn't been for a while.** The standing
  offenders are `set-state-in-effect` in the schedule components
  (`ScheduleBuilder`, `FindCoursesPanel`, `WorkdayImportOverlay`,
  `useCourseDetail`) and one `prefer-const` in `solver.ts`. If those are all
  you see, your change didn't cause them.
- **404s return HTTP 200.** Adding `loading.tsx` made those routes stream, and
  a streamed response can't change its status after headers are sent. Next
  marks the page `noindex` automatically, so search is unaffected. This is
  documented Next behaviour, not a bug, but 404s won't show in analytics.
- **`ubcflow.com` 308-redirects to `www.ubcflow.com`.** Check the `www` host,
  or curl with `-L`.
- **Vercel's deployment list is newest-first, not yours-first.** When verifying
  a deploy, match on the commit SHA, otherwise you can watch someone else's
  build succeed and think you shipped.

---

## Testing

```bash
npm test          # vitest
npm run test:watch
```

The engine tests need no database: `progress.ts` and `solver.ts` are pure.
The solver's invariant is the one that matters: **a plan never violates a
prerequisite and never places a course in a term it isn't offered.**

---

## Licence

Copyright (C) 2026 Ryan Giang.

[GNU AGPL v3](LICENSE). Read it, run it, learn from it, fork it. If you run a
modified copy as a service other people can reach, publish your changes.

The guidance data in `src/guidance/programs/` is hand-transcribed from UBC's
published degree requirements and is original work; the AGPL covers it along
with the code.

## Test fixtures

`tests/fixtures/` holds redacted captures of real inputs, because the parsers
exist to survive shapes nobody would think to invent. Every one was put
through a script that keeps the structure and throws away the person:
`scripts/make-fixture.ts` for a Workday export, `scripts/make-canvas-fixture.ts`
for a Canvas calendar feed. Never commit the raw input to either.
