'use strict';
/**
 * #1732: a SOURCE pin against the Windows-hostile path-separator class.
 *
 * The defect that motivated this (github.js splitting AGENT_WORKFORCE_GH_CANDIDATES
 * on a hardcoded ':') shipped as far as iteration 45 of #1606 because it is
 * INVISIBLE to every behavioural test on this fleet: `path.delimiter` IS ':' on
 * POSIX, so a hardcoded ':' and `path.delimiter` behave identically here and a
 * green suite on macOS is no evidence about Windows. The fix (0835830f) used
 * `path.delimiter`; the guard for it must NOT be a behavioural arm (which would
 * carry the same POSIX blindness as the code -- "a guard blind on the same axis as
 * the code is not a guard"). It must read the SOURCE.
 *
 * This is that guard, generalised from the one instance to the whole class, which
 * is the #1732 ask ("one instance shipped this far unnoticed" -> catch the NEXT
 * one). It scans engine/ source for a hardcoded ':' or ';' used as a
 * `.split`/`.join` separator and requires every occurrence to be EXPLICITLY
 * CLASSIFIED:
 *   - a PATH / env-var list separator MUST use `path.delimiter` (';' on Windows),
 *     so it never appears as a ':'/'; ' literal here and this guard stays silent; or
 *   - a genuinely non-path use (MIME parameters, cookie attributes, a hex/colour
 *     string, filename sanitisation) is declared on the ALLOW list below with a
 *     reason AND a count.
 *
 * 🛑 WHAT THIS CATCHES, AND WHAT IT DOES NOT (stated so nobody gets the false
 * confidence #1732 was about, this time via syntax instead of platform). The
 * SEP_LITERAL patterns match a ':'/'; ' separator written AT the split/join call
 * site as a string literal, a template literal, or a single-char regex literal,
 * with or without a limit argument. They deliberately do NOT follow a separator
 * through a VARIABLE (`const SEP = ':'; x.split(SEP)`): a static line scan cannot,
 * and that indirection is itself a smell -- if you find yourself hoisting a path
 * separator into a const, use `path.delimiter`. No such indirection exists in the
 * tree today (grep-verified); this note is the honest disclosure of the residual.
 *
 *   node --test engine/win32-separator-guard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE_DIR = __dirname;

// A `.split`/`.join` whose separator argument is a hardcoded single ':' or ';',
// in any of the shapes a static scan can see at the call site:
//   - a string OR template literal: '...' , "..." , `...`  (with optional limit arg)
//   - a single-char regex literal:  /:/  /;/  (with optional flags / limit arg)
// path.delimiter is NOT a literal, so the fixed path splits never match -- and a
// REGRESSION of one of them to a literal ':' WOULD match and, being un-allow-listed,
// fail here. See the docblock for the one shape this cannot see (variable indirection).
const SEP_PATTERNS = [
  /\.(?:split|join)\(\s*(['"`])[:;]\1\s*(?:,[^)]*)?\)/,   // quoted / template literal
  /\.(?:split|join)\(\s*\/[:;]\/[a-z]*\s*(?:,[^)]*)?\)/,  // single-char regex literal
];
function isSeparatorHit(line) { return SEP_PATTERNS.some((rx) => rx.test(line)); }

/**
 * The reviewed non-path allow list. Each entry: the file, a distinctive substring
 * of the line, HOW MANY lines in that file are expected to match it, and WHY it is
 * not a path separator. The count is load-bearing: keying on (file, snippet) alone
 * would let a SECOND, genuinely-hostile line in the same file that happens to
 * contain the same snippet be blessed silently. Asserting the exact count means a
 * new identical-looking line trips the guard (count too high) and a removed one
 * trips it too (dead entry -- count too low), so the list cannot silently loosen.
 */
const ALLOW = [
  { file: 'attachments.js', snippet: ".split(';')[0]", count: 2, why: 'MIME content-type parameter strip (text/html;charset=..), not a path' },
  { file: 'unfurl.js', snippet: ".split(';')[0]", count: 2, why: 'MIME content-type parameter strip, not a path' },
  { file: 'unfurl.js', snippet: "hex.split(':')", count: 1, why: 'splitting a hex/colour string, not a path' },
  { file: 'unfurl.js', snippet: "low.split(':')", count: 1, why: 'splitting a hex string, not a path' },
  { file: 'boardauth.js', snippet: "String(raw).split(';')", count: 1, why: 'HTTP cookie/header attributes are ;-separated, not a path' },
  { file: 'projects.js', snippet: ".split(':').join('-')", count: 1, why: 'filename sanitiser: replace chars illegal in a filename (incl. : on Windows) with -, cross-platform by intent' },
  { file: 'projects.js', snippet: ".split(':').join('')", count: 1, why: 'filename sanitiser: the emptiness-check mirror of the line above' },
];

function scanEngineSeparatorHits() {
  const hits = [];
  for (const name of fs.readdirSync(ENGINE_DIR)) {
    if (!name.endsWith('.js') || name.endsWith('.test.js')) continue;
    const full = path.join(ENGINE_DIR, name);
    let src;
    try { src = fs.readFileSync(full, 'utf8'); } catch { continue; }
    src.split('\n').forEach((line, idx) => {
      if (isSeparatorHit(line)) hits.push({ file: name, line: idx + 1, text: line.trim() });
    });
  }
  return hits;
}

// A marker appears in real CODE (not only inside a comment) iff some source line
// contains it where it is not preceded by a `//` on that line and the line is not a
// `*`/`//`/`/*` comment line. Deliberately line-based rather than a full comment
// stripper: it avoids the string-contains-`//` edge cases while closing the
// "a comment quoting the code satisfies the pin" failure (a raw-source match cannot
// tell code from a description of code).
function markerInCode(src, marker) {
  return src.split('\n').some((line) => {
    const at = line.indexOf(marker);
    if (at < 0) return false;
    const t = line.trimStart();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false;
    const slash = line.indexOf('//');
    if (slash >= 0 && slash < at) return false;   // marker sits after a line comment
    return true;
  });
}

test('#1732 every hardcoded :/; split-or-join in engine/ is a path.delimiter fix or a reviewed non-path use', () => {
  const hits = scanEngineSeparatorHits();
  const unclassified = hits.filter(
    (h) => !ALLOW.some((a) => a.file === h.file && h.text.includes(a.snippet)),
  );
  assert.deepEqual(
    unclassified,
    [],
    'A hardcoded ":" or ";" as a .split/.join separator was found that is neither on the '
    + '#1732 non-path allow list nor a path.delimiter fix. If it separates a PATH or an '
    + 'env-var list, use `path.delimiter` (it is ";" on Windows; a literal ":" splits a '
    + 'real Windows override C:\\a;D:\\b into broken fragments). If it is genuinely not a '
    + 'path (MIME/cookie/hex/filename), add it to ALLOW with a reason and count. '
    + 'Unclassified hits: ' + JSON.stringify(unclassified),
  );
});

test('#1732 each allow entry matches EXACTLY its declared count (no new identical hit blessed, no dead entry)', () => {
  const hits = scanEngineSeparatorHits();
  const mismatches = [];
  for (const a of ALLOW) {
    const actual = hits.filter((h) => h.file === a.file && h.text.includes(a.snippet)).length;
    if (actual !== a.count) mismatches.push({ file: a.file, snippet: a.snippet, expected: a.count, actual });
  }
  assert.deepEqual(
    mismatches,
    [],
    'An allow entry no longer matches its declared count. A HIGHER actual means a new '
    + 'line matching a known-safe snippet appeared -- confirm it is genuinely non-path '
    + '(if it is a path, use path.delimiter) and bump the count. A LOWER actual means a '
    + 'dead entry -- remove it. ' + JSON.stringify(mismatches),
  );
});

test('#1732 the known env-var PATH splits use path.delimiter in CODE, never a literal (positive pin)', () => {
  // The two env-var path-list splits the sweep found. Assert the FIX is present in
  // real code (not merely quoted in a comment -- this codebase embeds code-shaped
  // fragments in docblocks), so a regression to a literal ":" is caught here even
  // before the first test's allow-list miss, and so this guard documents WHERE the
  // class lives.
  for (const [name, marker] of [
    ['github.js', 'override.split(path.delimiter)'],
    ['discover.js', '.split(path.delimiter)'],
  ]) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, name), 'utf8');
    assert.ok(markerInCode(src, marker),
      `${name} should split its env-var path list on path.delimiter in CODE (found no `
      + `non-comment "${marker}"); a hardcoded ":" here is Windows-hostile (#1732).`);
  }
});
