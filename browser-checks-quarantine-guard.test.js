'use strict';

/**
 * #4160: a browser check may not say PASS and exit before it starts a browser,
 * unless it carries a quarantine marker with an expiry, and an expired marker is red.
 *
 * 🛑 WHY. afd16d894 (2026-09-15) put a "TEMP quarantine (revert after 0.6.67 cut)"
 * at the top of regress-a-night.js: it printed `PASS  regress-a-night QUARANTINED`
 * and called process.exit(0) before chromium.launch. Nobody reverted it, and for
 * twelve days every cut's step 3b reported the heaviest page check green while it
 * checked nothing (#1079). The harness sees only exit 0, and a TEMP comment has no
 * clock, so nothing could ever have noticed.
 *
 * 🔑 THE MARKER. A deliberate quarantine is written, within the dozen lines above
 * its exit, as:
 *
 *     // QUARANTINE until=<version> card=#<N>: <reason>
 *
 * It is allowed while package.json's version is BELOW `until`, and red from the
 * first build at or past it, naming the card. The cut runs this test at step 1e with
 * KOSMOS_QUARANTINE_AT_VERSION set to the version it is cutting, so an expiring
 * quarantine refuses BEFORE the version bump, not after it. The harness (tools/browser-checks.sh)
 * separately refuses a run in which a check printed QUARANTINED, unless the
 * operator overrides it, so a quarantine is never reported as a pass either.
 *
 * ⚠️ WHAT IS NOT FLAGGED, so this does not over-reach. The honest skip prints
 * SKIPPED, not PASS ("playwright is not on NODE_PATH - SKIPPED, not passed"), and
 * a PASS followed by exit(0) AFTER the browser launched is a check's normal end.
 * The shape is narrow: a PASS string, then exit(0), before the last launch.
 *
 * ⚠️ WEAKEST PART. "Before the launch" is read from the source text: the LAST
 * non-comment line calling `.launch(` or `.launchPersistentContext(`. A check that
 * starts its browser through a helper with another name would read as having no
 * launch at all, so any early PASS-exit in it is flagged. That fails red, the safe
 * direction, and the message says how to proceed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const DIR = nodePath.join(__dirname, 'docs', 'browser-checks');
/* [ \t], not \s: a marker is one line, so its reason cannot be borrowed from the next line. */
const MARKER = /QUARANTINE[ \t]+until=(\d+)\.(\d+)\.(\d+)[ \t]+card=#(\d+):[ \t]*\S/;
const LAUNCH = /\.launch(?:PersistentContext)?\s*\(/;
const EXIT0 = /process\.exit\(\s*0?\s*\)/;
/* PASS anywhere inside a one-line string ('✓ PASS', `[${n}] PASS`), not only at its start. */
const PASS_STRING = /['"`][^'"`\n]*\bPASS\b/;
/* Case-insensitive whole word, the same test tools/lib/bc-quarantine.sh applies (grep -iw). */
const SAYS_QUARANTINED = /['"`][^'"`\n]*\bquarantined\b/i;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error('not a version: ' + v);
  return [+m[1], +m[2], +m[3]];
}
function atOrPast(cur, until) {
  for (let i = 0; i < 3; i++) if (cur[i] !== until[i]) return cur[i] > until[i];
  return true;
}

/* Returns the problems in one check's source, as strings naming file:line. */
function scan(name, src, version) {
  const lines = src.split('\n');
  /* The LAST launch, ignoring comment lines: a helper defined above the main flow can hold
     the first `.launch(` (render-fields.js does), and measuring from it would read an early
     PASS-exit in the main flow as "after the launch" and pass it (review WARNING 2). */
  let launchAt = -1;
  lines.forEach((l, i) => { if (!COMMENT_LINE.test(l) && LAUNCH.test(l)) launchAt = i; });
  const problems = [];
  lines.forEach((l, i) => {
    if (!EXIT0.test(l) || COMMENT_LINE.test(l)) return;
    if (launchAt >= 0 && i > launchAt) return;
    const near = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
    if (!PASS_STRING.test(near)) return;
    const above = lines.slice(Math.max(0, i - 12), i + 1).join('\n');
    const m = MARKER.exec(above);
    if (!m) {
      problems.push(name + ':' + (i + 1) + ' says PASS and exits 0 before any browser starts, with no '
        + '"QUARANTINE until=<version> card=#<N>: <reason>" marker above it. Either fix the check, or '
        + 'mark the quarantine with the version it must be gone by.');
      return;
    }
    /* The harness can only see a quarantine by the word it prints, so a marked one must print it,
       or it would satisfy this test and still be logged as PASS (review WARNING 3). */
    /* On the SAME line as a PASS string: the harness greps output line by line for PASS and
       quarantined together, so a "quarantined" on a neighbouring line would satisfy a window
       test here and still be logged as a pass there (review round 4). */
    const nearLines = lines.slice(Math.max(0, i - 6), i + 1);
    if (!nearLines.some((x) => PASS_STRING.test(x) && SAYS_QUARANTINED.test(x))) {
      problems.push(name + ':' + (i + 1) + ' is marked as a quarantine but its PASS line does not say QUARANTINED, '
        + 'so tools/browser-checks.sh would log it as a pass. Print QUARANTINED in it.');
      return;
    }
    const until = [+m[1], +m[2], +m[3]];
    if (atOrPast(version, until)) {
      problems.push(name + ':' + (i + 1) + ' is quarantined until ' + until.join('.') + ' (card #' + m[4]
        + ') and this build is ' + version.join('.') + ': the quarantine has expired. Fix the check '
        + 'and remove it; do not move the date without a reason on the card.');
    }
  });
  return problems;
}

/* The cut sets KOSMOS_QUARANTINE_AT_VERSION to the version it is about to cut (release.sh step 1e). */
const VERSION = parseVersion(process.env.KOSMOS_QUARANTINE_AT_VERSION
  || JSON.parse(fs.readFileSync(nodePath.join(__dirname, 'package.json'), 'utf8')).version);

test('no browser check says PASS and exits before its browser starts, unless quarantined with an unexpired marker', () => {
  const scripts = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  assert.ok(scripts.length > 100, 'found ' + scripts.length + ' checks, so this test is looking in the wrong place');
  const problems = scripts.flatMap((f) => scan(f, fs.readFileSync(nodePath.join(DIR, f), 'utf8'), VERSION));
  assert.deepEqual(problems, []);
});

/* Controls: each shape the scan must see, on sources built so the answer is known. */
const QUARANTINED = (marker) => [
  '(async () => {',
  marker,
  "  console.log('PASS  x QUARANTINED for this cut');",
  '  process.exit(0);',
  "  const b = await chromium.launch({ headless: true });",
  '})();',
].join('\n');

test('control: the #1079 shape, unmarked, is red', () => {
  const p = scan('planted.js', QUARANTINED('  /* TEMP quarantine, revert after the cut */'), [0, 7, 1]);
  assert.equal(p.length, 1);
  assert.match(p[0], /planted\.js:4 says PASS and exits 0 before any browser starts/);
});

test('control: a marked quarantine is allowed below its version and red at and past it', () => {
  const src = QUARANTINED('  // QUARANTINE until=0.7.03 card=#1079: stale Settings click');
  assert.deepEqual(scan('m.js', src, [0, 7, 1]), []);
  assert.match(scan('m.js', src, [0, 7, 3])[0], /quarantined until 0\.7\.3 \(card #1079\).*expired/);
  assert.match(scan('m.js', src, [0, 8, 0])[0], /expired/);
});

test('control: a marker without a card or a reason is not a marker', () => {
  assert.equal(scan('a.js', QUARANTINED('  // QUARANTINE until=0.9.00: no card'), [0, 7, 1]).length, 1);
  assert.equal(scan('b.js', QUARANTINED('  // QUARANTINE until=0.9.00 card=#1:'), [0, 7, 1]).length, 1);
});

test('control: the honest skip and a PASS after the launch are not flagged', () => {
  const skip = [
    "try { require('playwright'); } catch { console.log('playwright is not on NODE_PATH - SKIPPED, not passed'); process.exit(0); }",
    'const b = await chromium.launch();',
  ].join('\n');
  assert.deepEqual(scan('s.js', skip, [0, 7, 1]), []);
  const end = ['const b = await chromium.launch();', "console.log('PASS  all');", 'process.exit(0);'].join('\n');
  assert.deepEqual(scan('e.js', end, [0, 7, 1]), []);
});

test('control: the version comparison is numeric, not textual', () => {
  assert.equal(atOrPast([0, 7, 10], [0, 7, 9]), true);
  assert.equal(atOrPast([0, 7, 9], [0, 7, 10]), false);
  assert.equal(atOrPast([0, 10, 0], [0, 9, 99]), true);
  assert.deepEqual(parseVersion('0.7.01'), [0, 7, 1]);
});

test('control (review WARNING 2): the shapes the first scan missed are red', () => {
  /* A helper above the main flow holds the first launch; the real launch is later. */
  const helper = [
    'async function open() { return chromium.launch(); }',
    '(async () => {',
    "  console.log('PASS  x QUARANTINED');",
    '  process.exit(0);',
    '  const b = await chromium.launch();',
    '})();',
  ].join('\n');
  assert.equal(scan('h.js', helper, [0, 7, 1]).length, 1, 'an early PASS-exit before the LAST launch');
  /* PASS mid-string, and a launch that exists only in a comment. */
  const mid = ["// before: chromium.launch({ headless })", "console.log('\u2713 PASS  x');", 'process.exit(0);'].join('\n');
  assert.equal(scan('m.js', mid, [0, 7, 1]).length, 1, "a PASS mid-string with only a commented launch");
  /* The PASS string several lines above the exit (multi-line arguments). */
  const multi = ['console.log(', "  'PASS  x',", '  a,', '  b,', ');', 'process.exit(0);', 'await chromium.launch();'].join('\n');
  assert.equal(scan('ml.js', multi, [0, 7, 1]).length, 1, 'a PASS five lines above the exit');
});

test('control (review WARNING 3): a marked quarantine must print QUARANTINED', () => {
  const quiet = [
    '  // QUARANTINE until=0.9.00 card=#1079: stale click',
    "  console.log('PASS  x (skipped for this cut)');",
    '  process.exit(0);',
    '  await chromium.launch();',
  ].join('\n');
  const p = scan('q.js', quiet, [0, 7, 1]);
  assert.equal(p.length, 1);
  assert.match(p[0], /does not say QUARANTINED/);
});

test('control (review round 2): lower-case quarantined counts, as in the harness; a commented exit is not an exit', () => {
  const lower = [
    '  // QUARANTINE until=0.9.00 card=#1079: stale click',
    "  console.log('PASS  x quarantined for this cut');",
    '  process.exit(0);',
    '  await chromium.launch();',
  ].join('\n');
  assert.deepEqual(scan('l.js', lower, [0, 7, 1]), []);
  const doc = ["// never do: console.log('PASS x'); process.exit(0);", 'await chromium.launch();'].join('\n');
  assert.deepEqual(scan('d.js', doc, [0, 7, 1]), []);
});

test('control (review round 3): the marker must sit within 12 lines of the exit', () => {
  const far = ['// QUARANTINE until=0.9.00 card=#1079: stale click']
    .concat(Array(11).fill('// filler')) /* marker 13 lines above the exit: outside */
    .concat(["console.log('PASS  x QUARANTINED');", 'process.exit(0);', 'await chromium.launch();']).join('\n');
  assert.match(scan('f.js', far, [0, 7, 1])[0], /no "QUARANTINE until=/);
  const near = far.replace('// filler\n', ''); /* 12 lines above: inside */
  assert.deepEqual(scan('n.js', near, [0, 7, 1]), []);
});

test('control (review round 4): quarantined on a neighbouring line does not count', () => {
  const split = [
    '  // QUARANTINE until=0.9.00 card=#1079: stale click',
    "  console.log('hid 1 quarantined post from the feed');",
    "  console.log('PASS  x (skipped for this cut)');",
    '  process.exit(0);',
    '  await chromium.launch();',
  ].join('\n');
  assert.match(scan('s.js', split, [0, 7, 1])[0], /does not say QUARANTINED/);
});
