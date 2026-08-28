import * as cheerio from 'cheerio';
import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { getProgram, selectable } from '@/guidance/registry';
import { effectiveRules } from '@/guidance/registry';
import { codesIn, validateProgram } from '@/guidance/validate';
import { obligations, walk, type Rule } from '@/guidance/rules';

/**
 * Check a transcribed program against the world, in three directions.
 *
 * Structure — internal consistency, no I/O.
 * Catalogue — every course code names a real UBC course.
 * Source — every code in the file appears on the Calendar page it cites.
 *
 * The third is the one that catches transcription error. A code in the file
 * but not on the page is a requirement we invented, which is the dangerous
 * direction: it tells a student to take something their degree does not ask
 * for. The reverse — codes on the page we did not transcribe — is reported
 * too, but as information rather than failure, because a Calendar page names
 * plenty of courses that are not requirements.
 *
 * This does NOT prove the transcription correct. Credit counts, choose-N
 * numbers, and which rules are grouped under which year still need a human
 * against the page. It removes the mechanical errors so that review is short.
 */

/**
 * Course codes on a Calendar page, honouring its subject-carrying shorthand.
 *
 * The Calendar rarely repeats a subject. It writes "CPSC_V 110 (or 103 and
 * 107)" and "CPSC_V 310, 313, 320", so most numbers appear bare and inherit
 * the nearest preceding subject. Matching only "SUBJ NNN" finds a fraction of
 * what is really there and reports the rest as invented — which is exactly
 * the false alarm that would make this check worth ignoring.
 *
 * The carried subject is dropped at a sentence end, so a number in unrelated
 * prose two paragraphs later is not attributed to it.
 *
 * Footnote markers are glued straight onto the number in the rendered table —
 * "CPSC_V 1213" is CPSC 121 with footnote 3 — so a course number is read as
 * exactly three digits and any digits trailing it are consumed as the marker.
 */
export function codesOnPage(html: string): Set<string> {
  const text = cheerio.load(html).text();
  const out = new Set<string>();
  // A subject token, a bare course number, or a sentence break.
  const token = /([A-Z]{2,5})_[VO]|(\d{3}[A-Z]?)\d*|([.;:]\s)/g;
  let subject: string | null = null;
  for (const m of text.matchAll(token)) {
    if (m[1]) subject = m[1];
    else if (m[2] && subject) out.add(`${subject} ${m[2]}`);
    else if (m[3]) subject = null;
  }
  return out;
}

export async function verifyPrograms(): Promise<number> {
  const known = new Set(selectable.map((p) => p.code));
  for (const p of selectable) for (const e of p.extends) known.add(e);

  let errors = 0;

  for (const program of selectable) {
    console.log(`\n=== ${program.name} (${program.code}) ===`);

    // 1. Structure.
    const issues = validateProgram(program, known);
    for (const i of issues) {
      if (i.severity === 'error') errors++;
      console.log(`  ${i.severity === 'error' ? 'ERROR  ' : 'warn   '} ${i.ruleId}: ${i.message}`);
    }
    if (issues.length === 0) console.log('  structure: ok');

    // 2. Every code names a real course.
    const rules = effectiveRules(program);
    const codes = codesIn(rules);
    const rows = await db.course.findMany({
      where: { campus: 'V', OR: codes.map((c) => codeWhere(c)) },
      select: { number: true, credits: true, subject: { select: { code: true } } },
    });
    const real = new Map(rows.map((r) => [`${r.subject.code} ${r.number}`, r.credits]));
    const missing = codes.filter((c) => !real.has(c));
    if (missing.length > 0) {
      // Not an error, and usually not a transcription mistake either.
      // Course rows are only ever created by the sections scraper — it holds
      // the single course.upsert in the codebase — so the catalogue is really
      // "courses offered in a term we have scraped". A course on hiatus, or
      // one running in a term outside that window, is simply absent. MATH 102
      // and 104 are current UBC courses that no scraped term happens to offer.
      // The solver ignores a code it cannot resolve, so the cost is a narrower
      // set of alternatives, not a wrong plan.
      console.log(
        `  warn    ${missing.length} code(s) named by the Calendar but absent from the ` +
          `catalogue: ${missing.join(', ')}`,
      );
    } else {
      console.log(`  catalogue: all ${codes.length} codes resolve`);
    }

    // 3. The rules add up to the credential.
    //
    // The check that catches double counting. Faculty-wide requirements are
    // constraints on how a student spends their credits, not extra credits on
    // top — Arts and breadth come OUT of the elective allowance. Stating both
    // in full makes a 120-credit degree total 150 and stretches the plan by a
    // year and a half, which is invisible until someone counts.
    let sum = 0;
    for (const rule of obligations(rules)) {
      if (rule.constraint) continue; // restricts other credits, adds none
      if (rule.kind === 'credits') sum += rule.n;
      else if (rule.kind === 'course') sum += real.get(rule.code) ?? 3;
      else if (rule.kind === 'chooseN') {
        // One branch satisfies one unit of the choice, so cost is n branches.
        const branch = rule.of[0];
        const each =
          branch?.kind === 'credits'
            ? branch.n
            : branch?.kind === 'course'
              ? (real.get(branch.code) ?? 3)
              : 3;
        sum += each * rule.n;
      }
    }
    if (sum !== program.totalCredits) {
      errors++;
      console.log(
        `  ERROR   rules total ${sum} credits but the degree is ${program.totalCredits} — ` +
          `${sum > program.totalCredits ? `${sum - program.totalCredits} over, likely double-counted` : `${program.totalCredits - sum} short`}`,
      );
    } else {
      console.log(`  credits: rules total ${sum}, matching the degree`);
    }

    // 4. Every code appears on the page it cites.
    const pages = new Map<string, Set<string>>();
    for (const url of sourceUrls(rules)) {
      try {
        pages.set(url, codesOnPage(await fetchText(url)));
      } catch (e) {
        console.log(`  warn    could not fetch ${url}: ${(e as Error).message}`);
      }
    }
    const onAnyPage = new Set([...pages.values()].flatMap((s) => [...s]));
    const invented = codes.filter((c) => !onAnyPage.has(c));
    if (invented.length > 0) {
      errors += invented.length;
      console.log(
        `  ERROR   ${invented.length} code(s) in the file but on NO cited page: ${invented.join(', ')}`,
      );
    } else {
      console.log(`  source: every code appears on a cited Calendar page`);
    }
  }

  console.log(
    `\n${errors === 0 ? 'PASS' : `FAIL — ${errors} error(s)`}. ` +
      'Credit counts, choose-N numbers and rule grouping still need a human against the Calendar.',
  );
  return errors;
}

function codeWhere(code: string) {
  const [subject, number] = code.split(' ');
  return { subject: { code: subject }, number };
}

function sourceUrls(rules: Rule[]): string[] {
  const urls = new Set<string>();
  walk(rules, (r) => {
    if (r.sourceUrl) urls.add(r.sourceUrl);
  });
  return [...urls];
}

export { getProgram };
