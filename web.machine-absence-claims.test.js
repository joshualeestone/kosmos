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
const path = require('node:path');

/**
 * 🛑 THE PAGE IS NOT THE ONLY PLACE A SENTENCE CAN COME FROM, and the first
 * version of this guard read only `web/index.html`. The sweep behind it covered
 * 178 sources; the guard covered one. That gap is the shape where a defect lands
 * in the half nobody guarded: `engine/machine.js` builds check sentences that
 * `web/index.html:28077` renders with `checks.map((c) => frCheckRow(c))`, so a
 * claim about the person's machine can be authored in the engine and never pass
 * through the file this test used to read.
 *
 * ⭐ A SOURCE ASSERTION IS THE RIGHT INSTRUMENT HERE, NOT A LAZY ONE. This
 * sentence renders only when Plus is off AND devices are registered; driving
 * that from a test needs a board, a Plus account and a paired device. Where a
 * path cannot be driven, insisting on a behaviour test leaves it unguarded and
 * the suite green, which is the same false coverage by a more respectable route.
 */
const SOURCES = [
  /* PLUS_PAGE steers the first entry so the whole guard can be aimed at an
     older copy of the page. That is how it is proven able to fail: run it
     against the file 0.5.89 actually shipped and it must go red. */
  process.env.PLUS_PAGE || 'web/index.html',
  'install/pkg-resources/welcome.html',
  'install/pkg-scripts/installing.html',
];
for (const f of fs.readdirSync('engine')) {
  if (f.endsWith('.js') && !f.endsWith('.test.js')) SOURCES.push(path.join('engine', f));
}

/**
 * 🛑 DO NOT ADD `*.test.js` TO SOURCES, INCLUDING THIS FILE. Measured 2026-08-27:
 * aim this guard at its own test file and **5 patterns trip**.
 *
 * ⚠️ AND COMMENT-STRIPPING IS NOT WHAT PROTECTS IT. The forbidden sentences live
 * in the CONTROL ARRAYS below as real string literals, which no comment filter
 * touches. The only thing keeping this green is that `.test.js` is out of scope.
 *
 * ⭐ Splinter's generalisation, and this file is an instance of it: ANY DETECTOR
 * KEYED ON A LITERAL WILL MATCH THE PROSE THAT DESCRIBES IT, and the write-up is
 * usually the first false positive. He broadcast a warning quoting a UI string
 * and then grepped six panes for that string, matching his own announcement
 * every time.
 *
 * 📌 Written down because the obvious improvement to this file is to widen its
 * scope, which is what I did to it an hour before writing this. The next person
 * to be thorough gets a red suite that looks like a real defect in the product.
 * A limit written down is a design decision; the same limit unwritten is an
 * invitation.
 */
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

/* Comments and CSS are not shown to anybody, and both discuss these sentences
   at length precisely because they are the rulings. Counting them would make
   the guard fire on its own documentation. */
const blank = (m) => m[0].replace(/[^\n]/g, ' ');
function rendered(html) {
  return html
    .replace(/<style\b[\s\S]*?<\/style>/gi, (...m) => blank(m))
    .replace(/<!--[\s\S]*?-->/g, (...m) => blank(m))
    .replace(/\/\*[\s\S]*?\*\//g, (...m) => blank(m))
    /* ⚠️ `//` LINE COMMENTS TOO, now that .js files are in scope. The engine
       discusses these rulings in prose at length, exactly as the page does, and
       counting that prose would make the guard fire on its own documentation. */
    .replace(/(^|[\n])[ \t]*\/\/[^\n]*/g, (m0, p1) => p1 + m0.slice(p1.length).replace(/[^\n]/g, ' '));
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
  const found = [];
  for (const src of SOURCES) {
    let text;
    try { text = rendered(fs.readFileSync(src, 'utf8')); } catch { continue; }
    for (const f of FORBIDDEN) {
      if (f.re.test(text)) found.push(`${src}: ${f.re} : ${f.why}`);
    }
  }
  assert.deepEqual(found, [],
    'these are claims about the machine, which Kosmos has no standing to make');
});

test('the guard actually reads every source it claims to', () => {
  /* 🛑 A SCOPE LIST IS A CLAIM AND IT ROTS. A renamed or moved file would make
     this guard silently narrower while staying green, which is the exact failure
     it was widened to fix. Assert the files are there and readable. */
  assert.ok(SOURCES.length > 20, `expected the engine to be enumerated, got ${SOURCES.length}`);
  const missing = SOURCES.filter((f) => !fs.existsSync(f));
  assert.deepEqual(missing, [], 'a source in scope has moved, so the guard is narrower than it reads');
  assert.ok(SOURCES.includes('engine/machine.js'),
    'engine/machine.js builds the check sentences the page renders, so it must be in scope');
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

/**
 * 🛑 EVERY PATTERN NEEDS ITS OWN TWO ARMS, AND TWO OF MINE HAD NEITHER.
 *
 * The control above uses the two sentences that actually shipped. Measured
 * 2026-08-27: those two exercise patterns 1 and 2 and **never touch 3 or 4**.
 * Either of those could be typo'd into matching nothing and this suite would
 * stay green, so the guard would silently protect half of what it claims to.
 *
 * ⭐ Found by running PigeonPete's finding against my own work rather than
 * reading it. He dropped a must-start-the-line rule from a different check and
 * the suite stayed green, because every row in the acceptance bar failed a
 * DIFFERENT clause too, so no row ever exercised the rule he removed. The
 * acceptance bar had a hole and the card did not know. Same shape here, one
 * project along: a bar assembled from real-world examples covers the patterns
 * those examples happen to hit, and silently abandons the rest.
 *
 * ⇒ A pattern list is only as good as its WEAKEST-covered entry, and coverage
 *   by accident is what a shipped-examples control gives you.
 */
test('CONTROL: every pattern is exercised, positively and negatively', () => {
  const arms = [
    { hits: 'Plus is off, so nothing can reach this Mac right now.',
      misses: 'Plus is off, so no device can reach Kosmos on this Mac right now.' },
    { hits: 'There are none on this computer yet.',
      misses: 'There are none in Kosmos yet.' },
    { hits: 'You have no agents on this computer.',
      misses: 'You have no agents in Kosmos.' },
    { hits: 'Your Mac is empty.',
      misses: 'Kosmos is empty on this Mac.' },
  ];
  assert.equal(arms.length, FORBIDDEN.length,
    'every pattern needs its own pair; a new pattern without one is unexercised');
  FORBIDDEN.forEach((f, i) => {
    assert.ok(f.re.test(arms[i].hits),
      `pattern ${i + 1} must fire on the claim it exists for: ${arms[i].hits}`);
    assert.ok(!f.re.test(arms[i].misses),
      `pattern ${i + 1} must not fire on the honest rewording: ${arms[i].misses}`);
  });
});
