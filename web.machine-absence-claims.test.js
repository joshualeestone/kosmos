'use strict';
/**
 * Kosmos must not tell a person what is or is not on their computer.
 *
 * Josh, after the first install outside this team missed both of that person's
 * agents and the screen said "There are none on this computer yet": **"the most
 * catastrophic flaw in the entire system."** The sentence was not a bug report,
 * it was a claim we had no standing to make, and it was wrong in front of the
 * one person it was about.
 *
 * ⭐ THE CLASS IS NOT "AGENTS". It is any sentence asserting the ABSENCE of
 * something on the person's machine, when all Kosmos can actually know is the
 * absence of its own record. 2026-08-27 turned up a second instance in a
 * completely different panel: Settings > Plus said "Plus is off, so nothing can
 * reach this Mac right now", in a panel about who can reach the Mac. Kosmos
 * knows nothing about SSH or Screen Sharing, and a false absence of ACCESS is
 * worse than a false absence of AGENTS, because a person acts on it and skips a
 * check they would otherwise run.
 *
 * ⚠️ A SWEEP CANNOT DO THIS JOB. Sweeping found the instance; it protects
 * nothing after the day it ran, and the corpus it was written for sits outside
 * any guard installed later. This is the forward half. The backward half was a
 * sweep of all 178 user-facing sources, which found no other live instance.
 *
 * 🛑 KEYED TO THE PROBLEM, NOT TO THE FIX. The patterns below describe the
 * SHAPE Josh ruled against, a claim about the machine, so a differently-worded
 * new instance is caught. They deliberately do not pin the wording that
 * replaced either instance: someone finding better words must not fail this.
 *
 *   node --test web.machine-absence-claims.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

/* Comments and CSS are not shown to anybody, and both discuss these sentences
   at length precisely because they are the rulings. Counting them would make
   the guard fire on its own documentation. */
const blank = (m) => m[0].replace(/[^\n]/g, ' ');
function rendered(html) {
  return html
    .replace(/<style\b[\s\S]*?<\/style>/gi, (...m) => blank(m))
    .replace(/<!--[\s\S]*?-->/g, (...m) => blank(m))
    .replace(/\/\*[\s\S]*?\*\//g, (...m) => blank(m));
}

/* Each pattern is a claim about the PERSON'S MACHINE rather than about Kosmos.
   Naming Kosmos, or hedging to what we can see, is what makes a sentence
   sayable, so both are permitted by construction: the patterns require the
   absence word and the machine noun with no scope word between them. */
const FORBIDDEN = [
  { re: /\bnothing can reach this (?:Mac|computer)\b/i,
    why: 'Kosmos cannot know about SSH, Screen Sharing, or anything else on the machine' },
  { re: /\bthere are (?:none|no agents) on this (?:Mac|computer)\b/i,
    why: 'Kosmos can only know it has no record, not that the machine has none' },
  { re: /\bno agents on this (?:Mac|computer)\b/i,
    why: 'same claim, shorter wording' },
  { re: /\byour (?:Mac|computer) (?:has|is) (?:empty|nothing)\b/i,
    why: 'a claim about the machine rather than about our records' },
];

test('no sentence claims what is absent from the person\'s computer', () => {
  const text = rendered(PAGE);
  const found = FORBIDDEN
    .filter((f) => f.re.test(text))
    .map((f) => `${f.re} : ${f.why}`);
  assert.deepEqual(found, [],
    'these are claims about the machine, which Kosmos has no standing to make');
});

test('CONTROL: the guard fires on the exact sentences that were shipped', () => {
  const shipped = [
    'Plus is off, so nothing can reach this Mac right now.',
    'There are none on this computer yet.',
  ];
  for (const s of shipped) {
    assert.ok(FORBIDDEN.some((f) => f.re.test(s)),
      `the guard must catch a sentence that actually reached a person: ${s}`);
  }
  const fine = [
    'Plus is off, so no device can reach Kosmos on this Mac right now.',
    'This is not saying you have none, it is saying we cannot see them.',
    'We cannot read your agents right now.',
  ];
  for (const s of fine) {
    assert.ok(!FORBIDDEN.some((f) => f.re.test(s)),
      `the guard must not fire on a sentence that is honest: ${s}`);
  }
});
