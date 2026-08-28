#!/usr/bin/env node
'use strict';
/**
 * Which merged PRs say whether a person should see them, and which say nothing?
 *
 * 🛑 WHY THIS EXISTS (#1025). Baron was about to cut 0.5.71 with five branches on
 * `main`, went looking for something that said they were ready, and found only a
 * challenge-loop proof file reading `converged: false` -- **a judgement about a
 * review loop, which is a different question from whether the work should reach a
 * person.** He correctly declined to read it as readiness and asked each owner by
 * hand. That does not scale, and the incautious version of it ships whatever is
 * sitting there.
 *
 * ⭐ THE CARD ASKS ONE QUESTION THAT IS REALLY TWO, and only one of them is open:
 *   1. IS IT READY?  The org convention already answers this: merging IS the
 *      declaration. Nothing here re-asks it.
 *   2. SHOULD A PERSON SEE IT IN WHAT THEY READ?  No artifact carries this, and
 *      it is the one somebody does by hand every release.
 *
 * 🔑 A MISSING ANSWER IS NOT A "NO", AND THIS TOOL REFUSES TO MERGE THEM. Three
 * merges on 2026-08-27 were correct, ready and deliberately NOT user-visible
 * (#1170, #1175, #1176: sentence values byte-identical, storage only). A PR that
 * says nothing looks exactly like those and is not the same thing. Silence is
 * reported as SILENT, never as `no`.
 *
 * ⚠️ MEASURED BEFORE BUILDING, because I had assumed otherwise and said so on the
 * card: of 25 merged PRs sampled (14 mine, 11 others), **2 carried the fact.**
 * Absence is the common case, not the edge, so a field with no way to notice its
 * absence would sit where it is and read as a convention.
 *
 *   node tools/check-ship-declaration.js <base-ref>
 *
 * Read-only. It prints a table and CHANGES NOTHING; what goes in release notes is
 * a person's call and this only tells them where the answer is missing.
 */

const { execFileSync } = require('node:child_process');

/**
 * The declaration a PR body may carry, as a line a cutter can grep.
 *
 * ⚠️ DELIBERATELY TOLERANT OF WORDING AND STRICT ABOUT POLARITY. People write
 * "not user-visible" and "user-visible: no" and both mean the same thing; nobody
 * should have to learn a syntax to be counted. What it will NOT do is guess from
 * a body that merely contains the words in passing, which is why the negative
 * forms are checked FIRST -- "not user-visible" contains "user-visible".
 *
 * @returns {'visible'|'internal'|'silent'}
 */
function declarationIn(body) {
  const text = String(body == null ? '' : body).toLowerCase();
  if (/\bnot user-visible\b|\buser-visible[:\s]+no\b|\binternal only\b/.test(text)) return 'internal';
  if (/\buser-visible\b/.test(text)) return 'visible';
  return 'silent';
}

function mergedSince(baseRef) {
  const out = execFileSync('gh', [
    'pr', 'list', '--state', 'merged', '--limit', '100',
    '--json', 'number,title,body,mergedAt',
  ], { encoding: 'utf8' });
  const all = JSON.parse(out);
  if (!baseRef) return all;
  const since = execFileSync('git', ['log', '-1', '--format=%cI', baseRef], { encoding: 'utf8' }).trim();
  return all.filter((p) => p.mergedAt && p.mergedAt >= since);
}

function main() {
  const baseRef = process.argv[2];
  const rows = mergedSince(baseRef).map((p) => ({
    n: p.number,
    say: declarationIn(p.body),
    title: (p.title || '').slice(0, 58),
  }));
  const counts = { visible: 0, internal: 0, silent: 0 };
  for (const r of rows) counts[r.say] += 1;

  for (const r of rows.sort((a, b) => a.n - b.n)) {
    const tag = { visible: 'SHOW  ', internal: 'internal', silent: 'SILENT' }[r.say];
    console.log(`${tag}  #${r.n}  ${r.title}`);
  }
  console.log(`\n${rows.length} merged: ${counts.visible} say show, ${counts.internal} say internal, `
    + `${counts.silent} SAY NOTHING.`);
  if (counts.silent) {
    console.log('\nSILENT is not "no". A PR that said nothing looks exactly like one that\n'
      + 'deliberately said internal, and they are not the same thing.\n'
      + '\n⚠️ If that count is most of them, this is NOT yet a shorter list than asking\n'
      + 'everybody, and saying otherwise would be the tool flattering itself. It is a\n'
      + 'measurement of a convention that does not exist yet. It becomes the short list\n'
      + 'as declarations appear, and until then its job is to show the size of the gap.');
  }
}

if (require.main === module) main();
module.exports = { declarationIn };
