'use strict';

/**
 * #1881: Book.io and Stuff.io must never reappear in this repo.
 *
 * Josh, 2026-09-02: remove every Book.io and Stuff.io reference from Kosmos "in
 * any way, shape, or form," and add a check so they cannot come back. This is
 * that check. The one-time strip regrows on its own - the strings arrived
 * because people write honest incident notes naming real accounts, and they
 * will keep doing so - so the durable deliverable is this guard, not the strip.
 *
 * 🛑 THE ESCAPED FORM IS WHY A NAIVE MATCHER MISSES ONE. A regex literal in a
 * test wrote the domain as `recorded@book\.io` (a backslash before the dot).
 * The substring `book.io` does not occur in `book\.io` (the char after `book`
 * is `\`, not `.`), so a plain literal search skipped it and a plain literal
 * strip left it behind. This matcher makes the separator flexible - an optional
 * backslash and an optional `-`/`.` between the name and its suffix - so the
 * escaped, hyphenated, dotted and run-together spellings are all one pattern.
 *
 * Runs in the node suite (via tools/run-tests.sh), so it is armed, not decorative.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;

/* The forbidden spellings, case-insensitive. `\\?[-.]?` between the name and
   `io` absorbs an escaped dot (`book\.io`), a hyphen (`book-io`), a plain dot
   (`book.io`) or nothing (`bookio`). `booktoken` and `$STUFF` are their own
   shapes. */
const PATTERNS = [
  /book\\?[-.]?io/i,   // book-io, book.io, bookio, book\.io
  /booktoken/i,
  /stuff\\?[-.]?io/i,  // stuff.io, stuff-io, stuffio, stuff\.io
  /\$stuff/i,          // $STUFF
];

/* Files whose PURPOSE is to name the forbidden patterns, so they are exempt.
   Kept minimal and literal so a reader can audit it. Adding to this list is how
   the guard is made to stop guarding a file, so each entry earns its place:
   this guard's own source names every pattern; this card's plan and proof
   document the cleanup. */
const ALLOWLIST = new Set([
  'no-brand-refs-1881.test.js',
  '.claude/plans/strip-1881.md',
  '.claude/plans/strip-1881-pre-challenge.md',
]);

/* Allowlist entries that must exist on disk, so a rename or delete cannot leave
   the guard silently exempting a path that no longer exists (and, worse, no
   longer scanning the file that took its place). The proof file is written later
   by the challenge-loop, so it is deliberately not in this must-exist set. */
const ALLOWLIST_MUST_EXIST = ['no-brand-refs-1881.test.js', '.claude/plans/strip-1881.md'];

function trackedFiles() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function hitsIn(rel) {
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return []; // unreadable/binary: nothing to scan
  }
  const out = [];
  /* Line-based, so a token split across a hard wrap would be missed (the fleet's
     "phrase-spanning-a-wrap" failure mode). Acceptable for the actual targets
     here - emails, URLs and $STUFF are single tokens that do not wrap mid-token -
     and a whole-file scan would only cost the file:line the failure message needs. */
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const re of PATTERNS) {
      if (re.test(lines[i])) { out.push(`${rel}:${i + 1}`); break; }
    }
  }
  return out;
}

test('#1881: the matcher can fail - it matches every forbidden spelling and rejects neutral controls', () => {
  // POSITIVE control: a guard that cannot fail is not a guard. Every spelling,
  // including the escaped one that slipped through the first pass.
  for (const sample of [
    'book-io', 'book.io', 'bookio', 'booktoken', 'Book.io', 'BOOK-IO',
    'josh@book\\.io', 'https://book.io/', 'book-io/claude-setup',
    'stuff.io', 'stuff-io', 'stuffio', 'josh@stuff\\.io', '$STUFF', '$stuff',
  ]) {
    assert.ok(PATTERNS.some((re) => re.test(sample)), `matcher missed a forbidden spelling: ${sample}`);
  }
  // NEGATIVE control: it must not fire on neutral text, or a clean tree passes
  // for the wrong reason.
  for (const ok of [
    'agent@example.com', 'other@example.com', 'recorded@example.com',
    'a notebook entry', 'the textbook index', 'this book is on the shelf', 'kosmos',
  ]) {
    assert.ok(!PATTERNS.some((re) => re.test(ok)), `matcher false-fired on neutral text: ${ok}`);
  }
});

test('#1881: no allowlisted path has been renamed out from under the guard', () => {
  for (const rel of ALLOWLIST_MUST_EXIST) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)),
      `allowlisted path ${rel} does not exist - it was renamed or deleted, so the guard is exempting nothing while the file that replaced it goes unscanned. Update ALLOWLIST.`);
  }
});

test('#1881: no Book.io or Stuff.io reference anywhere in the tracked tree', () => {
  const files = trackedFiles();
  assert.ok(files.length > 100,
    `git ls-files returned only ${files.length} files; the enumeration looks broken and every clean result below would be a false pass`);
  const offenders = [];
  for (const rel of files) {
    if (ALLOWLIST.has(rel)) continue;
    offenders.push(...hitsIn(rel));
  }
  assert.deepEqual(offenders, [],
    'Book.io / Stuff.io references reappeared. Replace real accounts with neutral example identities (agent@example.com), rewrite prose to make its point without naming either company, and retarget tooling refs to joshualeestone/claude-setup:\n  ' + offenders.join('\n  '));
});
