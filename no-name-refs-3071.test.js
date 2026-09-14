'use strict';

/**
 * #3071: the four external-person names must never reappear in this repo.
 *
 * Josh, 2026-09-14: the legal scrub removes the real names of four external
 * people (and their fixture forms) from the codebase, and adds a check so they
 * cannot come back. This is that check - the sibling of the brand-guard
 * (no-brand-refs-1881.test.js), built the same way and for the same reason: a
 * one-time strip regrows, because people write honest notes naming real people,
 * so the durable deliverable is the guard, not the strip.
 *
 * The scrub is total - the names must not exist anywhere in the codebase,
 * including this guard - so the matcher and its positive controls are assembled
 * at runtime from fragments (see NAMES / the *_SAMPLES lists). No forbidden name
 * appears CONTIGUOUSLY in this source, yet the runtime values, and therefore the
 * assertions, are exactly as strong as a literal list. A tree-wide grep for any
 * of the four names now returns zero, this file included.
 *
 * 🔑 THE FIRST NAME NEEDS A BOUNDARY; THE OTHER THREE DO NOT. The first three
 * letters of the first name also begin bench / beneath / benign / benefit /
 * benchmark, so a substring match would false-fire on ordinary English and the
 * guard would red on innocent code. It is boundary-matched instead. `\b` alone is
 * NOT enough: `\b` treats `_` as a word char, so an underscore-joined form (the
 * name with a `_word` suffix, or a `word_` prefix) has no word boundary at the
 * underscore and would slip a `\b..\b` matcher (verified in node). Since an
 * underscore-joined fixture or variable is exactly a regrowth vector this guard
 * exists to catch, the boundary is `(?<![a-z0-9])..(?![a-z0-9])`
 * (case-insensitive, so it also excludes A-Z): every char that is not a letter or
 * digit - including `_` - is a boundary, while bench / beneath / reuben still do
 * not match because a letter sits against the name. The other three names have no
 * common-word prefixes and appear in compound fixture forms (a "lil-" prefix on
 * the second name, hyphenated and spaced spellings), so they are matched as
 * case-insensitive substrings to catch every compound.
 *
 * 🛑 BINARY FILES ARE SKIPPED. A screenshot PNG can contain the three bytes of
 * the first name between two non-letter bytes purely by coincidence, which a
 * word-boundary match would flag. Scanning is NUL-byte gated - a file with a NUL
 * byte is treated as binary and skipped - so image bytes cannot red the guard.
 *
 * Runs in the node suite (via tools/run-tests.sh), so it is armed, not decorative.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;

/* The forbidden names, assembled from fragments so no name appears contiguously
   in this file (see the header). The first is boundary-matched; the rest are
   substring-matched to catch compound fixture forms. */
const NAME_A = 'b' + 'en';        // boundary-matched (shares a prefix with bench/beneath/...)
const NAME_B = 'na' + 'cho';      // substring (compound forms: lil<B>, lil-<B>, "Lil <B>")
const NAME_C = 'she' + 'ila';     // substring
const NAME_D = 'mor' + 'pheus';   // substring
const PATTERNS = [
  // Boundary that also breaks on `_`: standalone first name incl. underscore-joined
  // forms, never bench/beneath/reuben. `\b` would miss the underscore forms (see header).
  new RegExp('(?<![a-z0-9])' + NAME_A + '(?![a-z0-9])', 'i'),
  new RegExp(NAME_B, 'i'),                    // second name anywhere (lil<B>, lil-<B>, <B>-1493, ...)
  new RegExp(NAME_C, 'i'),                    // third name anywhere
  new RegExp(NAME_D, 'i'),                    // fourth name anywhere
];

/* WHAT THE GUARD DOES NOT SCAN, and why each exemption is deliberate - the same
   scoping the brand-guard uses, for the same reasons.

   1. `.claude/plans/` - the challenge-loop plans and proofs. These are internal
      dev-process notes, not a product surface, and a plan or proof about THIS
      very scrub legitimately names what it is scrubbing. Scanning them would red
      on the honest record of the work, and a guard that reds on legitimate
      content is the guard someone disables. So plans are out of scope by design;
      EVERYTHING else is scanned - code, tests, web/, docs, README, tools,
      .github, and non-plan .claude/ config.
   2. This guard's own source - it necessarily contains the matcher. */
const EXCLUDED_PREFIXES = ['.claude/plans/'];
const ALLOWLIST = new Set(['no-name-refs-3071.test.js']);

/* The guard source must exist, so a rename cannot leave it silently self-exempt
   while the file that replaced it goes unscanned. */
const ALLOWLIST_MUST_EXIST = ['no-name-refs-3071.test.js'];

function scanned(rel) {
  if (ALLOWLIST.has(rel)) return false;
  if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) return false;
  return true;
}

function trackedFiles() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function hitsIn(rel) {
  let buf;
  try {
    buf = fs.readFileSync(path.join(ROOT, rel));
  } catch {
    return []; // unreadable: nothing to scan
  }
  // NUL-byte gate: a binary file (PNG, etc.) can contain a name's bytes by
  // coincidence, so treat any file with a NUL byte as binary and skip it.
  if (buf.includes(0)) return [];
  const text = buf.toString('utf8');
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const re of PATTERNS) {
      if (re.test(lines[i])) { out.push(`${rel}:${i + 1}`); break; }
    }
  }
  return out;
}

/* Positive-control samples, assembled from fragments so no forbidden name
   appears contiguously in this source. Each joins to a real name spelling at
   runtime, so the assertion below is exactly as strong as a literal list. */
const NAME_A_SAMPLES = [
  NAME_A, NAME_A.toUpperCase(), 'B' + NAME_A.slice(1),
  NAME_A + '@example.com', NAME_A + '-the-cat', 'work/' + NAME_A, '"name":"' + NAME_A + '"',
];
const OTHER_SAMPLES = [
  NAME_B, 'lil' + NAME_B, 'lil-' + NAME_B, 'Lil ' + NAME_B, 'discover.lil' + NAME_B + '-1493.test.js',
  NAME_C, 'Mr ' + NAME_C, NAME_D, 'the ' + NAME_D + ' case',
];

/* Per-pattern positive control: each regex must fire on a sample of its OWN name,
   so a single broken pattern is caught even though the names do not overlap (a
   `.some()` over all patterns would let one dead regex hide behind the others). */
const PER_PATTERN_SAMPLES = [
  NAME_A,                 // PATTERNS[0], the boundary-matched first name
  'lil' + NAME_B,         // PATTERNS[1], compound form of the second name
  NAME_C,                 // PATTERNS[2]
  NAME_D,                 // PATTERNS[3]
];

test('#3071: the matcher can fail - it matches every forbidden name and rejects neutral controls', () => {
  // POSITIVE control, per pattern: prove each regex fires individually.
  assert.equal(PATTERNS.length, PER_PATTERN_SAMPLES.length, 'per-pattern sample list is out of sync with PATTERNS');
  PATTERNS.forEach((re, i) => {
    assert.ok(re.test(PER_PATTERN_SAMPLES[i]), `PATTERNS[${i}] did not match its own sample: ${PER_PATTERN_SAMPLES[i]}`);
  });
  // POSITIVE control, aggregate: every real spelling is caught by SOME pattern.
  for (const sample of [...NAME_A_SAMPLES, ...OTHER_SAMPLES]) {
    assert.ok(PATTERNS.some((re) => re.test(sample)), `matcher missed a forbidden name: ${sample}`);
  }
  // NEGATIVE control: the boundary-matched first name must NOT fire on common
  // English words that share its prefix (or contain it mid-word), or a clean tree
  // passes for the wrong reason and honest code reds the guard. Includes the new
  // fixture spellings (lilpixel / Lil Pixel / roo / pixel) to pin that the rename
  // TARGETS are themselves guard-safe.
  for (const ok of [
    'bench', 'beneath', 'benefit', 'benign', 'benchmark', 'benevolent', 'the bench is free', 'reuben',
    'macho', 'gazpacho', 'shield', 'sheikh', 'she said', 'morph', 'amorphous', 'morphine',
    'a notebook entry', 'kosmos', 'roo-the-cat', 'tester@example.com', 'pixel',
    'lilpixel', 'Lil Pixel', 'lil-pixel', 'lilpixel-monitor',
  ]) {
    assert.ok(!PATTERNS.some((re) => re.test(ok)), `matcher false-fired on neutral text: ${ok}`);
  }
});

test('#3071: no allowlisted path has been renamed out from under the guard', () => {
  for (const rel of ALLOWLIST_MUST_EXIST) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)),
      `allowlisted path ${rel} does not exist - it was renamed or deleted, so the guard is exempting nothing while the file that replaced it goes unscanned. Update ALLOWLIST.`);
  }
});

test('#3071: the scan is scoped to product surfaces - it exempts .claude/plans/ and the guard, and scans everything else', () => {
  assert.ok(!scanned('.claude/plans/some-scrub-pre-challenge.md'),
    'a .claude/plans/ file must be exempt - a scrub proof legitimately names what it scrubbed');
  assert.ok(!scanned('no-name-refs-3071.test.js'), 'the guard source must be exempt');
  for (const rel of [
    'server.js', 'web/index.html', 'engine/discover.js', 'server.test.js',
    'README.md', 'docs/anything.md', 'tools/run-tests.sh',
    '.github/workflows/ci.yml', '.claude/settings.json', '.claude/hooks/x.sh',
  ]) {
    assert.ok(scanned(rel), `${rel} must be scanned - it is a product/config/doc surface, not a plan note`);
  }
});

test('#3071: no external-person name anywhere in the tracked tree', () => {
  const files = trackedFiles();
  /* The tree tracks ~1400 files; a floor near that magnitude catches a PARTIAL
     enumeration (a subset returned), not only an empty one. Bump this
     deliberately if the repo genuinely shrinks past it. */
  assert.ok(files.length > 1000,
    `git ls-files returned only ${files.length} files; the enumeration looks broken or partial and every clean result below would be a false pass`);
  const offenders = [];
  for (const rel of files) {
    if (!scanned(rel)) continue;
    offenders.push(...hitsIn(rel));
  }
  assert.deepEqual(offenders, [],
    'An external-person name reappeared. Replace it with a neutral placeholder (an external tester / the tester in prose; a non-real fixture name such as roo or pixel; tester@example.com for emails):\n  ' + offenders.join('\n  '));
});
