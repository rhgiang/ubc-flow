# ubc-flow

## Scraping

Course data comes from three jobs that must run in order: `scrape:catalog` (terms and
subjects) → `scrape:sections` (courses, sections, meeting times, instructors) →
`scrape:descriptions` (cleans up raw HTML descriptions left by `scrape:sections` into
plain text plus prerequisite/corequisite text). Run `npm run scrape:all` to run all
three in the correct order; it's also what the scheduled GitHub Actions workflow
(`.github/workflows/scrape.yml`) runs daily to keep data fresh.