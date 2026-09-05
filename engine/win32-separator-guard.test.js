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
 * one, not just re-pin this one). It scans engine/ source for a hardcoded ':' or
 * ';' used as a `.split`/`.join` separator and requires every occurrence to be
 * EXPLICITLY CLASSIFIED:
 *   - a PATH / env-var list separator MUST use `path.delimiter` (';' on Windows),
 *     so it never appears as a ':'/'; ' literal here and this guard stays silent; or
 *   - a genuinely non-path use (MIME parameters, cookie attributes, a hex/colour
 *     string, filename sanitisation) is declared on the ALLOW list below with a
 *     reason.
 *
 * A NEW `.split(':')` / `.split(';')` (or `.join`) that is neither on the allow
 * list nor switched to `path.delimiter` fails this test. That forces the
 * platform-hostile decision to be made and reviewed at authoring time -- on the
 * Mac -- rather than discovered on Windows. The allow list is the honest resolution
 * of the card's own point: a by-shape scan cannot tell a path split from a MIME
 * split statically, so the human declares which it is, once, in a reviewed place.
 *
 *   node --test engine/win32-separator-guard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE_DIR = __dirname;

// A `.split(...)` or `.join(...)` whose sole argument is a quoted single ':' or ';'.
// Matches both quote styles. `path.delimiter` is NOT a string literal, so the fixed
// path-list splits (github.js, discover.js) never match -- and a REGRESSION of one
// of them back to a literal ':' WOULD match and, being un-allow-listed, fail here.
const SEP_LITERAL = /\.(?:split|join)\(\s*(['"])[:;]\1\s*\)/;

/**
 * The reviewed non-path allow list. Each entry: the file, a distinctive substring
 * of the line, and WHY it is not a path separator. A hit passes only if its line
 * contains an allow-listed snippet for its file. If a line's content drifts, the
 * author re-confirms it here (cheap); if a genuinely new separator split appears,
 * nothing matches and the test fails until it is classified.
 */
const ALLOW = [
  { file: 'attachments.js', snippet: ".split(';')[0]", why: 'MIME content-type parameter strip (text/html;charset=..), not a path' },
  { file: 'unfurl.js', snippet: ".split(';')[0]", why: 'MIME content-type parameter strip, not a path' },
  { file: 'unfurl.js', snippet: "hex.split(':')", why: 'splitting a hex/colour string, not a path' },
  { file: 'unfurl.js', snippet: "low.split(':')", why: 'splitting a hex string, not a path' },
  { file: 'boardauth.js', snippet: "String(raw).split(';')", why: 'HTTP cookie/header attributes are ;-separated, not a path' },
  { file: 'projects.js', snippet: ".split(':').join('-')", why: 'filename sanitiser: replace chars illegal in a filename (incl. : on Windows) with -, cross-platform by intent' },
  { file: 'projects.js', snippet: ".split(':').join('')", why: 'filename sanitiser: the emptiness check mirror of the line above' },
];

function scanEngineSeparatorHits() {
  const hits = [];
  for (const name of fs.readdirSync(ENGINE_DIR)) {
    if (!name.endsWith('.js') || name.endsWith('.test.js')) continue;
    const full = path.join(ENGINE_DIR, name);
    let src;
    try { src = fs.readFileSync(full, 'utf8'); } catch { continue; }
    src.split('\n').forEach((line, idx) => {
      if (SEP_LITERAL.test(line)) hits.push({ file: name, line: idx + 1, text: line.trim() });
    });
  }
  return hits;
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
    + 'path (MIME/cookie/hex/filename), add it to ALLOW in this file with a reason. '
    + 'Unclassified hits: ' + JSON.stringify(unclassified),
  );
});

test('#1732 the allow list has no dead entries (every entry still matches a real line)', () => {
  // A guard that keeps stale allow entries silently loosens over time: a snippet
  // that no longer matches anything is a rule protecting nothing, and it would let
  // a future author copy a "known-safe" entry that no longer reflects the code.
  const hits = scanEngineSeparatorHits();
  const dead = ALLOW.filter((a) => !hits.some((h) => h.file === a.file && h.text.includes(a.snippet)));
  assert.deepEqual(dead, [], 'ALLOW entries that match no current line (remove them): ' + JSON.stringify(dead));
});

test('#1732 the known env-var PATH splits use path.delimiter, never a literal (positive pin)', () => {
  // The two env-var path-list splits the sweep found. Assert the FIX is present in
  // source, so a regression to a literal ":" is caught here even before the first
  // test's allow-list miss -- and so this guard documents WHERE the class lives.
  for (const [name, marker] of [
    ['github.js', 'override.split(path.delimiter)'],
    ['discover.js', 'split(path.delimiter)'],
  ]) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, name), 'utf8');
    assert.ok(src.includes(marker),
      `${name} should split its env-var path list on path.delimiter (found no "${marker}"); `
      + 'a hardcoded ":" here is Windows-hostile (#1732).');
  }
});
