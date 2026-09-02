'use strict';
/**
 * #1732 -- make the Windows-hostile-assumption CLASS visible on an all-macOS fleet.
 *
 * ============================================================================
 * WHY THIS TEST EXISTS, AND WHY IT IS A SOURCE SCAN AND NOT A BEHAVIOURAL ARM
 * ============================================================================
 * This fleet is macOS-only and the product branches on `process.platform`. A
 * behavioural arm for a win32 branch CANNOT FAIL on a machine that never takes
 * the branch, so a green suite here is no evidence about Windows. Worse: a test
 * that hardcodes a POSIX fixture tests the POSIX path even when run on Windows,
 * so running the suite on a real Windows box would still not catch this class.
 *
 * Two real Windows defects have already shipped invisibly and were each found by
 * luck, late, and pinned one-at-a-time:
 *   - engine/github.js (#1592): split AGENT_WORKFORCE_GH_CANDIDATES on a hardcoded
 *     ':'. On Windows a real override is `C:\tools\gh.exe;D:\alt\gh.exe`, so ':'
 *     yields three broken fragments and gh reports missing with no diagnostic.
 *     FOUND AT ITERATION 45 of a challenge loop. Fixed to split(path.delimiter).
 *   - engine/store.js dataRootFor (#1510): joined with the AMBIENT `path` (which
 *     off Windows is path.posix), so the win32 branch answered with '/'. Fixed by
 *     joinerFor(platform) -> path.win32|path.posix, and a test that asks the
 *     function about win32 FROM macOS.
 * Both were the same shape: a platform-dependent operation using a hardcoded
 * POSIX constant instead of the platform-aware API. This card is the meta-card:
 * stop finding them one at a time by luck.
 *
 * ============================================================================
 * WHAT THIS TEST DOES (a coverage RATCHET, deliberately curated, not a lint)
 * ============================================================================
 * A blanket static lint for hardcoded ':'/'/'/ was measured and rejected: the raw
 * scan is ~all false positives (MIME ';', IPv6 ':', a name sanitizer) and missed
 * both real bugs. Instead this enumerates the current candidate sites, classifies
 * each in the INVENTORY below with a disposition + reason, and REDS on any
 * candidate that is NOT classified -- i.e. it fires exactly when someone ADDS a
 * new hardcoded platform coupling, which is when a reviewer should think about
 * Windows. It also reds on a STALE inventory entry (a classified site removed
 * from source), so the inventory cannot rot into a vacuous pass.
 *
 * STATED LIMIT (do not oversell this): the ratchet only covers Windows-hostility
 * that takes one of the ENUMERATED syntactic shapes below. The known corpus is
 * n=2 and both fit; a subtler assumption (\r\n vs \n in a file the Windows side
 * parses, a case-insensitive-FS assumption, a POSIX-only child process) would
 * slip through. This reduces the surface; it does not close it. See
 * docs/windows-source-coupling-1732.md.
 *
 * RECOMMENDED FIX-SHAPE for a real hit (from docs/windows-source-coupling-1732.md):
 * make the platform-dependent function platform-INJECTABLE -- fn(platform =
 * process.platform) -- so a macOS test can assert the win32 branch, exactly as
 * engine/platform.js and store.dataRootFor already do. A source-pin (github.js)
 * is the fallback when injection is impractical.
 *
 * COMMENT HANDLING: lines that are wholly a line-comment, a block-comment
 * opener, or a block-comment continuation are stripped before scanning (see
 * isCommentLine), which removes the comment-only false candidates. Trailing
 * inline comments and slashes-inside-strings can still surface; those are
 * handled by classifying them in the INVENTORY. This is a heuristic, not a JS
 * parser -- kept zero-dependency on purpose.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const ENGINE = __dirname;
const REF = 'docs/windows-source-coupling-1732.md';

// --- the product source set --------------------------------------------------
// SCOPE = the code that RUNS ON THE WINDOWS TARGET (the app a Windows agent
// runs): engine/*.js + top-level *.js + bin/*.js, minus *.test.js.
// tools/*.js is DELIBERATELY EXCLUDED: it is dev/CI/release tooling that runs on
// the macOS fleet, never on a user's Windows box, so its POSIX assumptions (e.g.
// process.env.HOME in insert-release-entry.js / check-block-delivery.js) are
// correct for where it runs and are NOT in this class. Widen this set only to
// code that ships to / executes on Windows.
function productFiles() {
  const files = [];
  const dirScan = [
    { dir: ENGINE, prefix: 'engine' },
    { dir: path.join(REPO, 'bin'), prefix: 'bin' },
  ];
  for (const { dir, prefix } of dirScan) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.js') && !e.name.endsWith('.test.js')) {
        files.push(path.join(prefix, e.name));
      }
    }
  }
  for (const e of fs.readdirSync(REPO, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.js') && !e.name.endsWith('.test.js')) {
      files.push(e.name);
    }
  }
  return files.sort();
}

// True for a line that is wholly a comment. Line-based heuristic, not a JS
// parser (kept zero-dependency): it catches line comments, block-comment
// openers, and JSDoc-style continuation lines (^\s*\*), which covers this
// codebase's comment style and the current corpus. RESIDUAL, stated so a
// reviewer need not rediscover it: a block-comment CONTINUATION line that does
// NOT start with '*' (e.g. an indented emoji-led line inside a /* */ block)
// survives, and conversely a code line that begins with '*' (an operator-led
// continuation) would be wrongly stripped. Neither occurs in the current corpus
// -- this codebase puts operators at line END, not line START -- so both are
// theoretical; any surviving comment that produces a spurious candidate is
// caught by classifying it in the INVENTORY.
function isCommentLine(line) {
  return /^\s*\/\//.test(line) || /^\s*\*/.test(line) || /^\s*\/\*/.test(line);
}

// A file's source with wholly-comment lines removed -- used by the positive pins
// so they assert on CODE, not on prose. Without this, a pin's match is satisfied
// by an explanatory comment that merely NAMES the portable API, so it would pass
// on a description of the code rather than the code (the
// raw-source-match-cannot-tell-code-from-a-description-of-code trap).
function codeText(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .filter((l) => !isCommentLine(l))
    .join('\n');
}

// --- the Windows-hostile candidate FAMILIES -----------------------------------
// Each regex matches a SHAPE that is POSIX-valid but potentially Windows-hostile.
// path.delimiter / path.sep / path.join / os.EOL / os.homedir are the portable
// forms and are deliberately NOT matched.
const FAMILIES = [
  {
    name: 'path-delimiter-literal',
    // .split(':') / .join(';') etc -- a hardcoded PATH separator. path.delimiter
    // is ':' on POSIX and ';' on Windows; a literal asserts one platform.
    re: /\.(?:split|join)\((['"])[:;]\1\)/,
  },
  {
    name: 'fs-root-literal',
    // '/tmp' '/home/' '/Users/' '/var/' used as a filesystem path. Windows has
    // none of these; os.tmpdir()/os.homedir() are the portable forms.
    re: /(['"])(?:\/tmp|\/home\/|\/Users\/|\/var\/)/,
  },
  {
    name: 'env-home',
    // process.env.HOME is undefined on Windows (it is USERPROFILE there);
    // os.homedir() is portable.
    re: /process\.env\.HOME\b/,
  },
  {
    name: 'manual-slash-concat',
    // a + '/' + b -- manual path assembly with a hardcoded separator; path.join
    // is portable.
    re: /\+\s*(['"])\/\1\s*\+/,
  },
];

// --- THE INVENTORY ------------------------------------------------------------
// Every CURRENT candidate site, classified. A candidate line is "classified" if
// some entry has the same `file` and the line INCLUDES that entry's `contains`.
// Dispositions:
//   benign-mime      -- ';' is the MIME parameter separator (content-type), not a path
//   benign-nonpath   -- ':' is a non-path separator (IPv6 hextets, hex/color)
//   sanitizer        -- deliberately replaces path-ish chars; already handles '\\'
//   posix-root-fallback -- os.tmpdir() is used; '/tmp' is an extra known root, harmless on Windows
//   macos-only-branch   -- reached only on the macOS path (tmux / launchd), not on Windows
// Add a row ONLY after confirming the site is not a real Windows bug; a real hit
// gets FIXED (and carded per instance), not inventoried.
const INVENTORY = [
  // --- benign MIME ';' parsing (content-type) ---
  { file: 'server.js',           contains: "|| '').split(';')[0].trim().toLowerCase()", disposition: 'benign-mime', why: 'content-type header parse; ; is the MIME param separator' },
  { file: 'server.js',           contains: "|| '').split(';')[0].trim()",               disposition: 'benign-mime', why: 'content-type header parse; ; is the MIME param separator' },
  { file: 'engine/attachments.js', contains: ".toLowerCase().split(';')[0].trim()",     disposition: 'benign-mime', why: 'content-type parse' },
  { file: 'engine/attachments.js', contains: ").split(';')[0].trim().slice(0, 100)",    disposition: 'benign-mime', why: 'content-type parse' },
  { file: 'engine/unfurl.js',    contains: ".toLowerCase().split(';')[0].trim()",       disposition: 'benign-mime', why: 'content-type parse' },
  // --- benign non-path ':' (IPv6 hextets in the SSRF guard) ---
  { file: 'engine/unfurl.js',    contains: "hex.split(':').filter(Boolean)",            disposition: 'benign-nonpath', why: 'IPv6 hextet parse; : is the v6 separator' },
  { file: 'engine/unfurl.js',    contains: "const parts = low.split(':')",              disposition: 'benign-nonpath', why: 'IPv6 hextet parse; : is the v6 separator' },
  // --- name sanitizer (already handles backslash) ---
  { file: 'engine/projects.js',  contains: ".split('/').join('-').split('\\\\').join('-').split(':').join('-')", disposition: 'sanitizer', why: 'name sanitizer; replaces / \\ : with -, Windows-aware' },
  { file: 'engine/projects.js',  contains: ".split('/').join('').split('\\\\').join('').split(':').join('')",    disposition: 'sanitizer', why: 'name sanitizer; strips / \\ :, Windows-aware' },
  // --- posix-root fallbacks (os.tmpdir() used; '/tmp' is a harmless extra) ---
  { file: 'engine/projects.js',  contains: "[os.tmpdir(), '/tmp']",                     disposition: 'posix-root-fallback', why: "os.tmpdir() is the real root; '/tmp' is an extra known root, never matches on Windows" },
  { file: 'engine/status.js',    contains: "[os.tmpdir(), '/tmp']",                     disposition: 'posix-root-fallback', why: "os.tmpdir() is the real root; '/tmp' extra" },
  { file: 'engine/status.js',    contains: "process.env.TMUX_TMPDIR || '/tmp'",         disposition: 'macos-only-branch', why: 'tmux socket path; tmux does not exist on Windows so this branch is macOS-only' },
  // --- macOS-only launchd path ---
  { file: 'engine/machine.js',   contains: "path.join(process.env.HOME || '', 'Library', 'LaunchAgents')", disposition: 'macos-only-branch', why: 'macOS LaunchAgents path; the Library/LaunchAgents branch is macOS-only' },
];

// Collect every candidate: {file, line, lineno, family}.
function collectCandidates() {
  const out = [];
  for (const rel of productFiles()) {
    const abs = path.join(REPO, rel);
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      for (const fam of FAMILIES) {
        if (fam.re.test(line)) {
          out.push({ file: rel, lineno: i + 1, line: line.trim(), family: fam.name });
        }
      }
    }
  }
  return out;
}

function classify(cand) {
  return INVENTORY.find((e) => e.file === cand.file && cand.line.includes(e.contains)) || null;
}

// ============================================================================
// THE RATCHET: every candidate must be classified, and every entry must be live.
// ============================================================================
test('#1732: no unclassified Windows-hostile source coupling', () => {
  const cands = collectCandidates();
  const unclassified = cands.filter((c) => !classify(c));
  if (unclassified.length) {
    const detail = unclassified
      .map((c) => `  ${c.file}:${c.lineno}  [${c.family}]  ${c.line}`)
      .join('\n');
    assert.fail(
      `${unclassified.length} Windows-hostile source coupling(s) not in the #1732 INVENTORY.\n` +
      `Each is a candidate for the class this card exists to catch (POSIX-valid, Windows-hostile,\n` +
      `invisible to every behavioural arm on this all-macOS fleet):\n${detail}\n\n` +
      `If it is a REAL Windows bug: FIX it (prefer a platform-injectable function, see ${REF}) and\n` +
      `card it per instance. If it is genuinely benign/macOS-only: add a classified row to INVENTORY\n` +
      `with a one-line reason. Do NOT widen an existing row's 'contains' just to silence this.`
    );
  }
});

test('#1732: no stale INVENTORY entry (every classified site still exists)', () => {
  const cands = collectCandidates();
  const stale = INVENTORY.filter(
    (e) => !cands.some((c) => c.file === e.file && c.line.includes(e.contains))
  );
  if (stale.length) {
    const detail = stale.map((e) => `  ${e.file}  «${e.contains}»`).join('\n');
    assert.fail(
      `${stale.length} INVENTORY entr(y/ies) no longer match any source candidate.\n` +
      `The coupling was removed or reshaped -- delete the stale row so the inventory stays honest:\n${detail}`
    );
  }
});

// ============================================================================
// POSITIVE PINS for the two known sites -- so this test independently red-guards
// a regression, belt-and-suspenders with each site's own dedicated pin.
// ============================================================================
test('#1732 pin: engine/github.js splits the gh override on path.delimiter, not a literal', () => {
  // codeText, NOT the raw file: github.js JSDoc literally NAMES `.split(path.delimiter)`
  // in a comment, so a raw match would pass on prose even if the code regressed.
  const code = codeText('engine/github.js');
  assert.match(code, /\.split\(path\.delimiter\)/,
    'engine/github.js must split AGENT_WORKFORCE_GH_CANDIDATES on path.delimiter (#1592). ' +
    `A hardcoded ':' breaks the Windows ';' override, invisible to every POSIX arm. See ${REF}.`);
  // Any hardcoded [:;] split/join in the CODE reds -- not anchored to `override.`,
  // so a regression that renames the variable is still caught.
  assert.doesNotMatch(code, /\.(?:split|join)\((['"])[:;]\1\)/,
    'engine/github.js splits/joins on a hardcoded path separator. Use path.delimiter (#1592).');
});

test('#1732 pin: engine/store.js dataRootFor joins with the platform it was asked about', () => {
  const code = codeText('engine/store.js');
  assert.match(code, /joinerFor\s*\(/,
    'engine/store.js must use joinerFor(platform) so dataRootFor joins with the platform it was ' +
    `ASKED ABOUT, not the ambient one (#1510). Otherwise the win32 branch answers with '/'. See ${REF}.`);
});
