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
 * that takes one of the ENUMERATED syntactic shapes below. The known corpus fits
 * the four families; a subtler assumption (\r\n vs \n in a file the Windows side
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
 * COMMENT HANDLING: a small character scanner (see stripComments) removes line
 * and block comments -- including a closed inline block comment before code on
 * the same line, and comment markers that appear inside a string literal --
 * while PRESERVING string contents, so a real quoted path or a dot-split is
 * still seen. It is not a full JS tokenizer: comment markers inside a REGEX
 * literal or a template-literal interpolation are not special-cased, which no
 * corpus line needs; kept zero-dependency on purpose.
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
// correct for where it runs and are NOT in this class. The same reasoning
// excludes test-support/*.js and docs/browser-checks/*.js (test fixtures and
// render checks, fleet-only). Widen this set only to code that ships to /
// executes on Windows.
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

// Remove comments while PRESERVING string literals, one {lineno, code} per line.
// A small character scanner tracking three states (in a string, in a block
// comment, in neither). It correctly handles: an inline block comment before
// code on the same line; a multi-line block whose middle lines do not start with
// a star; comment markers inside a '...'/"..."/`...` string; and a backtick
// template literal that SPANS lines (string state persists across newlines; '
// and " cannot span a raw newline, so they are cleared at each line end).
//
// It is NOT a full JS tokenizer, and cannot be without a parser (a dependency
// this test forgoes). It can be defeated ONLY by a Windows-hostile coupling
// placed adjacent, on the SAME line, to a construct it cannot tokenize:
//   - a REGEX literal containing a comment marker. A '//' inside a regex is read
//     as a line comment (dropping the rest of THAT line); a '/*' inside a regex
//     is read as a block-comment OPEN and drops lines until the next '*/'. So
//     this vector's miss is NOT bounded to a single line.
//   - a comment marker inside a template-literal ${...} interpolation.
// No corpus line triggers any of these (the negative control is green). The
// residual is real and not claimed to be zero: a coupling is counted the moment
// it does not fall inside such a mistaken span, and a multi-line block swallow
// usually also drops OTHER counts, which tends to red the EXCEED or stale arm --
// but a fully silent miss cannot be excluded without a JS parser, which this
// test forgoes.
function stripComments(src) {
  const out = [];
  let inBlock = false;
  let str = null; // open string delimiter (' " `) or null; persists across lines
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let code = '';
    let j = 0;
    while (j < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', j);
        if (end === -1) { j = line.length; } else { j = end + 2; inBlock = false; }
        continue;
      }
      const ch = line[j];
      if (str) {
        code += ch;
        if (ch === '\\') { code += (line[j + 1] || ''); j += 2; continue; }
        if (ch === str) str = null;
        j++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { str = ch; code += ch; j++; continue; }
      if (ch === '/' && line[j + 1] === '/') { break; }              // line comment to EOL
      if (ch === '/' && line[j + 1] === '*') { inBlock = true; j += 2; continue; } // block open
      code += ch; j++;
    }
    // ' and " cannot legally span a raw newline; only a backtick template can.
    if (str === "'" || str === '"') str = null;
    out.push({ lineno: i + 1, code });
  }
  return out;
}

// A file's source with comments removed (strings preserved) -- used by the
// positive pins so they assert on CODE, not on prose. Without this a pin's match
// is satisfied by an explanatory comment that merely NAMES the portable API (the
// raw-source-match-cannot-tell-code-from-a-description-of-code trap).
function codeText(rel) {
  return stripComments(fs.readFileSync(path.join(REPO, rel), 'utf8'))
    .map((l) => l.code)
    .join('\n');
}

// --- the Windows-hostile candidate FAMILIES -----------------------------------
// Each regex matches a SHAPE that is POSIX-valid but potentially Windows-hostile.
// path.delimiter / path.sep / path.join / os.EOL / os.homedir are the portable
// forms and are deliberately NOT matched. Each `re` is matched GLOBALLY per line
// (see countMatches), so two couplings on one line count as two.
//
// DELIBERATELY NOT a family: manual `a + '/' + b` path concat. It is dominated
// by legitimate URL/string building (which always uses '/', never a path
// separator), so scanning it is nearly all false-red for no coverage of the
// known corpus. The portable fix for a real one is still path.join; it is just
// not worth the merge friction to scan for. (Dropped after iteration 2.)
const FAMILIES = [
  {
    name: 'path-delimiter-literal',
    // .split(':') / .join(';') etc -- a hardcoded PATH separator. path.delimiter
    // is ':' on POSIX and ';' on Windows; a literal asserts one platform.
    // Tolerates inner whitespace and a limit/extra arg: .split( ':' ), .split(':', 2).
    re: /\.(?:split|join)\(\s*(['"])[:;]\1\s*[,)]/,
  },
  {
    name: 'fs-root-literal',
    // '/tmp' '/home/' '/Users/' '/var/' used as a filesystem path. Windows has
    // none of these; os.tmpdir()/os.homedir() are the portable forms. '/tmp' has
    // a right boundary so '/tmpfile'/'/tmpl' do not false-match.
    re: /(['"])(?:\/tmp(?![A-Za-z0-9])|\/home\/|\/Users\/|\/var\/)/,
  },
  {
    name: 'env-home',
    // process.env.HOME is undefined on Windows (it is USERPROFILE there);
    // os.homedir() is portable. Catches dot and bracket access; a destructure
    // (const {HOME} = process.env) is not caught -- documented in the doc's limits.
    re: /process\.env(?:\.HOME\b|\[\s*(['"])HOME\1\s*\])/,
  },
  {
    name: 'fs-const-platform-flag',
    // An fs.constants open flag that is UNDEFINED on win32. OR-ing an undefined
    // value in (`X | undefined === X`) makes the flag SILENTLY VANISH there, with
    // no error and no behavioural signal on macOS where the flag IS defined -- the
    // #1761 / #1776 class (an O_NOFOLLOW symlink guard that evaporates on the one
    // platform the module ships to). Only the win32-UNDEFINED members are listed;
    // the always-defined ones (O_RDONLY/O_WRONLY/O_RDWR/O_CREAT/O_EXCL/O_TRUNC/
    // O_APPEND) never vanish and are deliberately NOT matched, to keep the family
    // low-noise. The portable-fix shape is NOT "use a portable API" (there is none
    // for O_NOFOLLOW) but "make the guard's effect testable regardless of the flag"
    // -- capture it undefined-safe and behaviour-pin the protection platform-
    // independently, as engine/securewrite.js does (its refuseSymlinkTarget hand
    // check runs even when the kernel flag is absent). See
    // docs/windows-source-coupling-1732.md.
    re: /fs\.constants\.O_(?:NOFOLLOW|SYMLINK|DIRECTORY|DIRECT|NOATIME|NONBLOCK|DSYNC|SYNC)\b/,
  },
];

// --- THE INVENTORY ------------------------------------------------------------
// Every CURRENT candidate occurrence, classified by `family` with an expected
// `count` (how many code matches of that family this row accounts for; default
// 1). Classification is COUNT-BASED per (file, family): the ratchet reds when a
// file's actual family-match count EXCEEDS the sum of inventory counts for that
// (file, family). That closes the same-line-injection hole a line-substring
// match had -- a hostile coupling appended to a line that already carries an
// inventoried needle still raises the count, so it still reds. `contains` is a
// distinctive line substring, kept for the stale check and for documentation.
//
// `count` serves BOTH arms: the EXCEED arm sums it as "family matches accounted
// for", and the stale arm asserts `contains` occurs exactly `count` times. These
// coincide because every classified line here carries exactly ONE family match,
// so one row == one line == count occurrences of a distinctive `contains`. A
// future line carrying TWO same-family matches is the one shape this cannot
// represent cleanly (a single `contains` for it would occur once, not twice);
// split it into two rows with line-distinct `contains`, or pick a `contains`
// that spans both matches. No corpus line needs that today.
// Dispositions:
//   benign-mime      -- ';' is the MIME parameter separator (content-type), not a path
//   benign-cookie    -- ';' is the RFC 6265 cookie-pair separator, not a path
//   benign-nonpath   -- ':' is a non-path separator (IPv6 hextets)
//   sanitizer        -- deliberately replaces path-ish chars; already handles '\\'
//   posix-root-fallback -- os.tmpdir() is used; '/tmp' is an extra known root, harmless on Windows
//   macos-only-branch   -- reached only on the macOS path (tmux / launchd), not on Windows
//   guarded-vanish      -- an fs.constants flag undefined on win32, captured undefined-safe
//                          (`|| 0`) AND behaviour-pinned platform-independently (securewrite)
//   macos-covers-removal -- on macOS a behavioural arm catches the flag's REMOVAL; the win32
//                          hardening of its vanish is #1777 item 3, deferred for the beta
//   benign-nonblock     -- O_NONBLOCK is a fifo-avoidance flag, not a security guard; its
//                          win32 absence changes nothing that matters
// Add a row ONLY after confirming the site is not a real Windows bug; a real hit
// gets FIXED (and carded per instance), not inventoried.
const INVENTORY = [
  // --- benign MIME ';' parsing (content-type) ---
  { file: 'server.js', family: 'path-delimiter-literal', count: 1, contains: "|| '').split(';')[0].trim().toLowerCase()", disposition: 'benign-mime', why: 'content-type header parse; ; is the MIME param separator' },
  { file: 'server.js', family: 'path-delimiter-literal', count: 1, contains: "String(req.headers['content-type'] || '').split(';')[0].trim(),", disposition: 'benign-mime', why: 'content-type header parse; ; is the MIME param separator' },
  { file: 'engine/attachments.js', family: 'path-delimiter-literal', count: 1, contains: ".toLowerCase().split(';')[0].trim()", disposition: 'benign-mime', why: 'content-type parse' },
  { file: 'engine/attachments.js', family: 'path-delimiter-literal', count: 1, contains: ").split(';')[0].trim().slice(0, 100)", disposition: 'benign-mime', why: 'content-type parse' },
  { file: 'engine/unfurl.js', family: 'path-delimiter-literal', count: 2, contains: ".toLowerCase().split(';')[0].trim()", disposition: 'benign-mime', why: 'content-type parse (two identical sites, lines 312 & 340)' },
  // --- benign cookie ';' parsing (#1946 board-auth) ---
  { file: 'engine/boardauth.js', family: 'path-delimiter-literal', count: 1, contains: "String(raw).split(';')", disposition: 'benign-cookie', why: 'Cookie header parse (#1946); ; is the RFC 6265 cookie-pair separator, identical on every platform' },
  // --- the ';' that IS the Windows separator (#570 PATHEXT) ---
  { file: 'engine/runners.js', family: 'path-delimiter-literal', count: 1, contains: ".split(';').map((e) => e.trim()).filter(Boolean)", disposition: 'win32-only-branch', why: "PATHEXT parse inside pathextCandidates' win32 arm; ';' is the separator Windows itself uses for PATHEXT, so the literal is CORRECT here rather than tolerated -- and the arm is unreachable off win32 (platform-injected, both branches asserted from macOS in runners.pathext-win32-570.test.js)" },
  // --- benign non-path ':' (IPv6 hextets in the SSRF guard) ---
  { file: 'engine/unfurl.js', family: 'path-delimiter-literal', count: 1, contains: "hex.split(':').filter(Boolean)", disposition: 'benign-nonpath', why: 'IPv6 hextet parse; : is the v6 separator' },
  { file: 'engine/unfurl.js', family: 'path-delimiter-literal', count: 1, contains: "const parts = low.split(':')", disposition: 'benign-nonpath', why: 'IPv6 hextet parse; : is the v6 separator' },
  // --- name sanitizer (already handles backslash) ---
  { file: 'engine/projects.js', family: 'path-delimiter-literal', count: 1, contains: ".split('/').join('-').split('\\\\').join('-').split(':').join('-')", disposition: 'sanitizer', why: 'name sanitizer; replaces / \\ : with -, Windows-aware' },
  { file: 'engine/projects.js', family: 'path-delimiter-literal', count: 1, contains: ".split('/').join('').split('\\\\').join('').split(':').join('')", disposition: 'sanitizer', why: 'name sanitizer; strips / \\ :, Windows-aware' },
  // --- posix-root fallbacks (os.tmpdir() used; '/tmp' is a harmless extra) ---
  { file: 'engine/projects.js', family: 'fs-root-literal', count: 1, contains: "[os.tmpdir(), '/tmp']", disposition: 'posix-root-fallback', why: "os.tmpdir() is the real root; '/tmp' is an extra known root, never matches on Windows" },
  { file: 'engine/status.js', family: 'fs-root-literal', count: 1, contains: "[os.tmpdir(), '/tmp']", disposition: 'posix-root-fallback', why: "os.tmpdir() is the real root; '/tmp' extra" },
  { file: 'engine/status.js', family: 'fs-root-literal', count: 1, contains: "process.env.TMUX_TMPDIR || '/tmp'", disposition: 'macos-only-branch', why: 'tmux socket path; tmux does not exist on Windows so this branch is macOS-only' },
  // --- macOS-only launchd path ---
  { file: 'engine/machine.js', family: 'env-home', count: 1, contains: "path.join(process.env.HOME || '', 'Library', 'LaunchAgents')", disposition: 'macos-only-branch', why: 'macOS LaunchAgents path; the Library/LaunchAgents branch is macOS-only' },
  // --- fs.constants flags undefined on win32 (the #1761/#1776 vanishing-guard class) ---
  { file: 'engine/instructions.js', family: 'fs-const-platform-flag', count: 1, contains: 'fs.constants.O_NOFOLLOW ', disposition: 'macos-covers-removal', why: 'symlink-refusing open flag; on macOS its removal is caught behaviourally (the symlink/fifo refusal arms in instructions.test.js), win32 hardening is #1777 item 3, deferred for beta' },
  { file: 'engine/instructions.js', family: 'fs-const-platform-flag', count: 1, contains: 'fs.constants.O_NONBLOCK', disposition: 'benign-nonblock', why: 'paired with O_NOFOLLOW to avoid blocking on a fifo; its win32 absence is not a security regression' },
  { file: 'engine/securewrite.js', family: 'fs-const-platform-flag', count: 1, contains: 'const NOFOLLOW = fs.constants.O_NOFOLLOW', disposition: 'guarded-vanish', why: 'THE EXEMPLAR (#1776): captured undefined-safe as (NOFOLLOW || 0) and the refuseSymlinkTarget hand check runs even when the kernel flag is absent, so the protection is platform-independent and pinned in securewrite.test.js' },
  { file: 'server.js', family: 'fs-const-platform-flag', count: 1, contains: 'const NOFOLLOW = fs.constants.O_NOFOLLOW', disposition: 'guarded-vanish', why: '#1652 /api/agent-import-file: captured undefined-safe as (NOFOLLOW || 0) and paired with a platform-independent lstat hand check (isSymbolicLink refusal) that runs regardless of the kernel flag; pinned by the TOCTOU symlink arm in server.agent-import-1652.test.js' },
  { file: 'server.js', family: 'fs-const-platform-flag', count: 1, contains: 'const NONBLOCK = fs.constants.O_NONBLOCK', disposition: 'benign-nonblock', why: '#1652 /api/agent-import-file: paired with O_NOFOLLOW to keep a fifo swapped into the TOCTOU window from blocking the open (as instructions.js/workerfile.js do); the fstat isFile check refuses the fifo, so its win32 absence is not a security regression' },
  { file: 'engine/workerfile.js', family: 'fs-const-platform-flag', count: 1, contains: 'fs.constants.O_RDONLY | fs.constants.O_NONBLOCK', disposition: 'benign-nonblock', why: 'O_NONBLOCK avoids blocking on a fifo during a read-open; its win32 absence changes nothing that matters' },
];

// Count family matches per (file, family), scanning non-comment lines only.
// Returns Map keyed `${file} ${family}` -> { count, lines: [{lineno, text}] }.
function collectByFileFamily() {
  const map = new Map();
  for (const rel of productFiles()) {
    let src;
    try { src = fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch { continue; }
    for (const { lineno, code } of stripComments(src)) {
      for (const fam of FAMILIES) {
        const g = new RegExp(fam.re.source, fam.re.flags.includes('g') ? fam.re.flags : fam.re.flags + 'g');
        const n = (code.match(g) || []).length;
        if (n > 0) {
          const key = rel + ' ' + fam.name;
          const e = map.get(key) || { count: 0, lines: [] };
          e.count += n;
          e.lines.push({ lineno, text: code.trim() });
          map.set(key, e);
        }
      }
    }
  }
  return map;
}

function expectedCount(file, family) {
  return INVENTORY
    .filter((e) => e.file === file && e.family === family)
    .reduce((s, e) => s + (e.count || 1), 0);
}

// ============================================================================
// THE RATCHET: the count of family-matches in each file must not EXCEED what the
// inventory accounts for (a new coupling raises the count -> red), and every
// inventory entry must still be present (stale -> red).
// ============================================================================
test('#1732: no unclassified Windows-hostile source coupling', () => {
  const found = collectByFileFamily();
  const problems = [];
  for (const [key, info] of found) {
    const [file, family] = key.split(' ');
    const expected = expectedCount(file, family);
    if (info.count > expected) {
      const where = info.lines.map((l) => `      ${file}:${l.lineno}  ${l.text}`).join('\n');
      problems.push(
        `  ${file} [${family}]: ${info.count} match(es), inventory accounts for ${expected}.\n${where}`
      );
    }
  }
  if (problems.length) {
    assert.fail(
      `Unclassified Windows-hostile source coupling(s) -- more matches than the #1732 INVENTORY\n` +
      `accounts for. This is the class the card exists to catch (POSIX-valid, Windows-hostile,\n` +
      `invisible to every behavioural arm on this all-macOS fleet):\n${problems.join('\n')}\n\n` +
      `If a match is a REAL Windows bug: FIX it (prefer a platform-injectable function, see ${REF})\n` +
      `and card it per instance. If it is genuinely benign/macOS-only: add a classified INVENTORY row\n` +
      `(family + count + a one-line reason). Do NOT bump an existing row's count just to silence this.`
    );
  }
});

test('#1732: no stale INVENTORY entry (every classified site still exists at its count)', () => {
  // COUNT-AWARE, not a boolean: assert each row's `contains` occurs exactly
  // `count` times in the file's code. A boolean presence check leaves slack --
  // a row with count 2 (two byte-identical benign lines) lets you DELETE one and
  // ADD a hostile same-(file,family) match with zero net count change, evading
  // both this arm and the EXCEED arm. Occurrence-counting reds the deletion side
  // of that swap, so the two arms together leave no gap.
  const problems = [];
  for (const e of INVENTORY) {
    const code = codeText(e.file);
    const occ = code.split(e.contains).length - 1;
    const want = e.count || 1;
    if (occ !== want) {
      problems.push(`  ${e.file}  «${e.contains}»  found ${occ}, inventory count ${want}`);
    }
  }
  if (problems.length) {
    assert.fail(
      `${problems.length} INVENTORY multiplicity mismatch(es) -- a classified site was removed,\n` +
      `reshaped, or duplicated, so the inventory no longer describes the source:\n${problems.join('\n')}\n\n` +
      `Fix the row's count, or delete/add the row, so occurrences match. Do NOT bump a count to\n` +
      `absorb a NEW coupling -- that is the slack this check exists to remove.`
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
  // so a regression that renames the variable is still caught. Same widened form
  // as the path-delimiter family (whitespace / limit-arg tolerant).
  assert.doesNotMatch(code, /\.(?:split|join)\(\s*(['"])[:;]\1\s*[,)]/,
    'engine/github.js splits/joins on a hardcoded path separator. Use path.delimiter (#1592).');
});

test('#1732 pin: engine/store.js dataRootFor joins with the platform it was asked about', () => {
  const code = codeText('engine/store.js');
  // The injectable joiner must be TAKEN and USED, not merely defined: the #1510
  // regression left `function joinerFor` defined and reverted the JOIN to the
  // ambient path, so `joinerFor(` alone is near-vacuous.
  assert.match(code, /const p = joinerFor\(platform\)/,
    'engine/store.js dataRootFor must take the platform-specific joiner: ' +
    `const p = joinerFor(platform) (#1510). See ${REF}.`);
  assert.match(code, /\bp\.join\(/,
    'engine/store.js dataRootFor must JOIN with p (the asked-about platform), not the ambient path (#1510).');
  // The #1510 bug shape: joining a DATA-ROOT arg with the ambient path.join. Anchored on the
  // data-root arg names so the legit path.join(root()/avatarsDir()/...) elsewhere -- which
  // operate on an already-resolved absolute root -- are not caught.
  assert.doesNotMatch(code, /path\.join\(\s*(?:home|e\.APPDATA|e\.AGENT_WORKFORCE_DATA)\b/,
    'engine/store.js dataRootFor joins a data-root arg with the AMBIENT path.join -- the #1510 bug. ' +
    'Use p.join from joinerFor(platform).');
});

test('#1776 pin: engine/securewrite.js handles O_NOFOLLOW vanishing on win32 undefined-safe', () => {
  // The exemplar for the fs-const-platform-flag family. On win32 O_NOFOLLOW is
  // undefined; a bare `... | fs.constants.O_NOFOLLOW` would silently drop the flag
  // AND, worse, the guard would be a no-op with nothing testing it. securewrite
  // captures the maybe-undefined constant and ORs it in undefined-safe as
  // `(NOFOLLOW || 0)`, so the open call is well-formed on every platform, and the
  // real protection is a platform-INDEPENDENT hand check (refuseSymlinkTarget),
  // pinned behaviourally in securewrite.test.js. This pin guards the source marker
  // of that fix, belt-and-suspenders with the family's inventory row.
  const code = codeText('engine/securewrite.js');
  assert.match(code, /NOFOLLOW\s*=\s*fs\.constants\.O_NOFOLLOW/,
    'engine/securewrite.js must capture the maybe-undefined O_NOFOLLOW into a named local (#1776). ' +
    'See docs/windows-source-coupling-1732.md.');
  assert.match(code, /\(\s*NOFOLLOW\s*\|\|\s*0\s*\)/,
    'engine/securewrite.js must OR O_NOFOLLOW in undefined-safe as (NOFOLLOW || 0), so the flag ' +
    'vanishing on win32 cannot malform the open flags (#1776).');
});
