'use strict';
/**
 * #4119: which browser checks does this page diff touch?
 *
 *   node tools/bc-pr-select.js <base> [head]   # one `<check>\t<why>` line per check
 *
 * The PR-time `browser-checks` job runs a FIXED allowlist (#2445). Twice on 2026-09-26 a page PR
 * passed it and broke a check outside it, found only at the cut: #3985 broke render-talk, #4095
 * broke render-fields. This names the checks a `web/index.html` diff reaches, so the PR job runs
 * them too. It diffs `<base>...<head>` (the merge base, as the #2518 gate does), web/index.html
 * only, and reads the changed (+/-) lines. The checks and gated.txt are read from the working tree,
 * so a replay asks what TODAY's checks select; the page itself (its ids, function names and function
 * bodies) is read at `head`, so the diff's line numbers refer to the page they were written against.
 *
 * NOT READ: test-support/, tools/browser-checks.sh, and web/ files other than index.html. The job
 * fires on them, but a change there runs the fixed allowlist only, as it did before #4119.
 *
 * SIX WAYS A CHECK IS SELECTED, each printed as its reason:
 *   `changed`  the PR edits the check's own file, a `lib-*.js` helper the check requires, or
 *              another file under docs/browser-checks/ (a fixture) whose name the check's source uses.
 *   `surface`  its `// Browser-check-surface:` tokens (#2518), through
 *              `tools/bc-surface-map.sh covering`. Reused, not reimplemented, so the two cannot drift.
 *   `selector` an id or class the check's own source asks the page for appears whole-token in a
 *              changed line: a `#id` / `.class` in a query call or in any selector-shaped string
 *              (so a selector held in a constant counts), or a bare string that is an id the page
 *              has. The changed lines must also USE it as a selector, not just as a word: in a
 *              class/id/for/aria attribute value, after `.` or `#`, or inside a quoted string shaped
 *              like a class list ('stale', 'checked stamp stale'). A class named like a word (.you)
 *              was otherwise selected by every copy change using the word (#4190). This reaches the
 *              checks with no annotation. It selected render-talk for #3985 through `.msg-t` and
 *              `.mwhen`; the surface map selected nothing there.
 *   `name`     a page function or constant the check calls or reads (camelCase or UPPER_SNAKE,
 *              defined in the page) appears in a changed line. Some checks drive the page's own
 *              functions and touch no element (render-connect-skip reads frClaudeInstallNeeded).
 *   `function` the check declares `// Browser-check-functions: name ...` (first lines only) and a
 *              changed line falls INSIDE one of those page functions' bodies, or the function is gone
 *              from the page. #3828 changed only the body of asbAvatar(); its lines never name it, and
 *              render-assistant-hosted-3660 never calls it (it sees the bubble's image), so no rule
 *              above could connect them and the 0.6.95 cut found it. Opt-in on purpose: matching
 *              every function body a check calls would select on most page diffs (openDetail's body
 *              changed in 23 commits in two weeks), and one escape asked only for this (Liu Kang, #4119).
 *   `page`     the check declares `// Browser-check-scope: page`: it sweeps the whole page (every
 *              field, every piece of text) rather than named elements, so it runs on ANY page
 *              change. render-fields is the case: #4095 broke it through `#tsk-by`, which
 *              render-fields never names and no selector could ever connect to it.
 *
 * 🔑 NOT browser-checks-selectors.test.js's idsAskedFor, on purpose. That reads ids only and
 * skips lines asserting an id is ABSENT. #3985 reached render-talk through CLASSES alone, so an
 * id-only reader would have missed the case this exists for; and a change can break an absence
 * assertion as easily as a presence one.
 *
 * ⚠️ `selector` and `name` ARE HEURISTICS, and they err in both directions. A selector assembled
 * at run time from fragments that are not themselves selector-shaped is invisible, so a check can
 * still be missed; so is a class added in a quoted string that also carries punctuation, since a
 * string like that reads as copy. A common class (`.msg`) selects checks the change cannot really affect, which
 * costs PR time but never gives a wrong verdict. The fixed allowlist and the cut's full 3b are
 * unchanged. browser-checks-pr-select-4119.test.js fails if a runnable check is reachable by none
 * of these routes, so a new check cannot silently fall outside them.
 *
 * Only checks the driver can run are named: `docs/browser-checks/gated.txt` plus the labels
 * tools/browser-checks.sh runs by name. Naming anything else would make the driver's never-ran
 * guard fail the job. Exit 0 with an empty list is a real answer (nothing touched); a git error
 * exits 2.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CHECKS = path.join(REPO, 'docs', 'browser-checks');
const PAGE_FILE = path.join(REPO, 'web', 'index.html');

// A string argument to a DOM query, and the #id / .class tokens inside it. The action verbs
// (click, fill, check, type, ...) count only as a METHOD call (`page.click(`, `loc.fill(`):
// checks define their own bare `check('...')` assertion helper, and its prose message is not a
// selector (`check('...and that sweep')` once read as the class `.and`).
const QUERY = /(?:(?<![\w$])(?:querySelector(?:All)?|\$\$?|\$eval|\$\$eval|locator|waitForSelector|getElementById|closest|matches)|\.(?:click|dblclick|fill|hover|isVisible|isHidden|textContent|innerText|getAttribute|dispatchEvent|press|type|check|uncheck|selectOption|focus))\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const TOKEN = /[#.]([A-Za-z][\w-]*)/g;
const BY_ID = /(?<![\w$])getElementById\(\s*['"`]([A-Za-z][\w-]*)['"`]/g;
// Any single-line string literal, and a `#id` / `.class` in selector position inside one.
const STRING = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const IN_SELECTOR = /(?:^|[\s,>+~(\[])[#.]([A-Za-z][\w-]*)/g;
// Read from the first lines only, as the README says: a quoted example deep in a file must not
// make that check run on every page change.
const PAGE_SCOPE = /^\s*\/\/\s*browser-check-scope:\s*page(\s|$)/im;
const isPageScoped = (src) => PAGE_SCOPE.test(src.split('\n').slice(0, 5).join('\n'));
// The page functions a check depends on without naming them (#4119, `function` above), from its first lines only.
const FUNCTIONS = /^\s*\/\/\s*browser-check-functions:\s*(.*)$/im;
function declaredFunctions(src) {
  const m = FUNCTIONS.exec(src.split('\n').slice(0, 5).join('\n'));
  return m ? m[1].trim().split(/\s+/).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)) : [];
}

/* A page function's body as 1-based [first, last] lines: the declaration, to the first later line that is
   the declaration's own indentation followed by `}` (then optionally `;` and a `//` comment). A function
   whose braces open and close on its declaration line is that one line. null when the page does not
   declare it; 'unclosed' when no such closing line comes before the next declaration at that indentation. */
function functionRange(page, name) {
  const lines = page.split('\n');
  const decl = new RegExp(`^(\\s*)(?:async\\s+)?function\\s+${name.replace(/\$/g, '\\$')}\\s*\\(`);
  for (let i = 0; i < lines.length; i += 1) {
    const m = decl.exec(lines[i]);
    if (!m) continue;
    const opens = (lines[i].match(/\{/g) || []).length;
    if (opens > 0 && opens === (lines[i].match(/\}/g) || []).length) return [i + 1, i + 1];
    const close = new RegExp(`^${m[1]}\\}\\s*;?\\s*(//.*)?$`);
    // Another declaration at this indentation first means this one's closer was missed: stop there, rather
    // than run on to that function's own `}` and claim its body too.
    const next = new RegExp(`^${m[1]}(?:async\\s+)?function\\s+[A-Za-z_$][\\w$]*\\s*\\(`);
    for (let j = i + 1; j < lines.length; j += 1) {
      if (close.test(lines[j])) return [i + 1, j + 1];
      if (next.test(lines[j])) return 'unclosed';
    }
    return 'unclosed';
  }
  return null;
}

/* The head-side line numbers a diff changes in web/index.html: each added line, and for a removed line the
   head line it was removed before. Only hunks count, as in changedLines, and only the page's: a hunk under
   another file's `+++` header is skipped. A hunk whose new side is empty (`+N,0`, as -U0 writes a pure
   deletion) sits AFTER head line N. */
function touchedLines(diff) {
  const out = [];
  let next = null;
  let inPage = true;   // a diff with no file headers (a hand-built one) is taken as the page's
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) { next = null; inPage = true; continue; }
    if (l.startsWith('+++ ') && next === null) { inPage = l === '+++ b/web/index.html'; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h) { next = inPage ? Number(h[1]) + (h[2] === '0' ? 1 : 0) : null; continue; }
    if (next === null) continue;
    if (l[0] === '+') { out.push(next); next += 1; } else if (l[0] === '-') out.push(next); else if (l[0] === ' ') next += 1;
  }
  return out;
}

/* Checks that are red on the runner for a reason that is not the PR's, per the nightly card
   (#3973). Selecting one would turn every page PR that touches it red for someone else's defect,
   so it is left out and printed as left out, unless the PR edits the check itself: a fix to it
   has to be able to show green. Each entry names why; remove it when the nightly shows it green. */
const KNOWN_RED = {
  'render-provider-combobox-1040': '#3973: red on the macos-latest runner, unexplained, passes on a dev Mac',
};

// camelCase or UPPER_SNAKE only: a plain word (`open`, `close`, `build`) is also a page function,
// and matching it would select checks on every diff that says it.
const distinctive = (n) => /^[a-z][a-z0-9]*[A-Z]\w*$/.test(n) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(n);

/* Comments out, as browser-checks-selectors.test.js does it: a comment quoting an old id is not a
   selector, and an apostrophe in one ("don't") pairs with the next quote and misreads every string
   after it. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^([^'"`\n]*)\/\/.*$/gm, '$1');
}

/* What the page defines: its ids, and its distinctive function and constant names. `extra` is the
   diff's changed text, so an id or function the PR RENAMES or REMOVES still counts: it is no
   longer on the page, and it is exactly what a check asking for it will break on. */
function pageIndex(page, extra = '') {
  const both = `${page}\n${extra}`;
  const ids = new Set([...both.matchAll(/\bid=["']([A-Za-z][\w-]*)["']/g)].map((m) => m[1]));
  const names = new Set();
  for (const m of both.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) if (distinctive(m[1])) names.add(m[1]);
  for (const m of both.matchAll(/^[+-]?\s*(?:let|var|const)\s+([A-Za-z_][\w]*)\s*=/gm)) if (distinctive(m[1])) names.add(m[1]);
  return { ids, names };
}

function selectorsOf(src, index = { ids: new Set() }) {
  const code = stripComments(src);
  const out = new Set();
  for (const m of code.matchAll(QUERY)) for (const t of m[2].replace(/\$\{[^}]*\}/g, ' ').matchAll(TOKEN)) out.add(t[1]);
  for (const m of code.matchAll(BY_ID)) out.add(m[1]);
  for (const m of code.matchAll(STRING)) {
    const s = m[1] === '`' ? m[2].replace(/\$\{[^}]*\}/g, ' ') : m[2];
    if (/^[A-Za-z][\w-]*$/.test(s)) { if (index.ids.has(s)) out.add(s); continue; }
    if (/[/\\]/.test(s)) continue; // a path or URL, not a selector
    for (const t of s.matchAll(IN_SELECTOR)) out.add(t[1]);
  }
  return out;
}

function namesOf(src, index = { names: new Set() }) {
  const out = new Set();
  for (const m of stripComments(src).matchAll(/\b([A-Za-z_$][\w$]{3,})\b/g)) if (index.names.has(m[1])) out.add(m[1]);
  return out;
}

// Whole-token, the same boundary as the #2518 gate (bc_surface_token_hits): a token is not
// matched inside a longer id, so `tsk` does not hit `tsk-by`.
function hits(token, text) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|$)`, 'm').test(text);
}

/* A selector token counts only where the changed lines use it as a selector (#4119 follow-up,
   Johnny Cage on #4190): in a class/id/for/aria attribute value, after . or #, or as a whole
   quoted string (classList.toggle('on')). Matched anywhere, a class named like a word (.you,
   .note) was selected by every copy change that used the word. */
/* The most classes one class-list string may hold and still count (the page's longest is 4,
   class="acard attn notrunning needstrust"). A longer quoted run of words is a phrase of copy. */
const CLASS_LIST_MAX_WORDS = 5;

function usedAsSelector(token, text) {
  const e = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const W = '(?<![A-Za-z0-9_-])' + e + '(?![A-Za-z0-9_-])';
  // An HTML attribute that names elements: class="a you b", id="you", for=, aria-*=.
  if (new RegExp(`(?<![\\w-])(?:class|id|for|aria-controls|aria-labelledby|aria-describedby)\\s*=\\s*(["'])(?:(?!\\1).)*${W}`, 'm').test(text)) return true;
  // A CSS or query selector: .you, #you. (Also fires on obj.you and "...you": over-selection, the safe side.)
  if (new RegExp(`[.#]${W}`, 'm').test(text)) return true;
  // A quoted string shaped like a class list, the token whole inside it: 'you', ' stale', 'checked stamp
  // stale', "conn " + ..., setAttribute("class", "a you"). Only letters, digits, _, - and spaces or tabs
  // (never a newline, so a quote cannot pair with one lines later), and at most CLASS_LIST_MAX_WORDS
  // words: "Thank you, you are in." and "you can still add the project" are copy, not class lists.
  const whole = new RegExp(W);
  for (const m of text.matchAll(/(["'`])([A-Za-z0-9_ \t-]*)\1/g)) {
    const words = m[2].trim().split(/[ \t]+/).filter(Boolean);
    if (words.length && words.length <= CLASS_LIST_MAX_WORDS && whole.test(m[2])) return true;
  }
  return false;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/* The +/- lines inside hunks. Parsed by position, not by prefix: a removed line that itself
   begins `-- ` reads as `--- ` and would be dropped by a prefix rule. */
function changedLines(diff) {
  const out = [];
  let inHunk = false;
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) { inHunk = false; continue; }
    if (l.startsWith('@@')) { inHunk = true; continue; }
    if (inHunk && (l[0] === '+' || l[0] === '-')) out.push(l);
  }
  return out.join('\n');
}

function runnable() {
  const names = new Set();
  const gated = fs.readFileSync(path.join(CHECKS, 'gated.txt'), 'utf8');
  for (const l of gated.split('\n')) { const n = l.trim(); if (n && !n.startsWith('#')) names.add(n); }
  const driver = fs.readFileSync(path.join(REPO, 'tools', 'browser-checks.sh'), 'utf8');
  for (const m of driver.matchAll(/run_one\s+"([\w-]+)"/g)) names.add(m[1]);
  return names;
}

/* A shared helper (`lib-*.js`) is not a check, so `changed` cannot name it; every check that
   requires it is what a change to it can break. */
function requirersOf(lib) {
  const re = new RegExp(`require\\(\\s*['"\`](?:\\./)?${lib.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.js)?['"\`]\\s*\\)`);
  return fs.readdirSync(CHECKS).filter((f) => f.endsWith('.js') && re.test(fs.readFileSync(path.join(CHECKS, f), 'utf8')))
    .map((f) => f.slice(0, -3));
}

/* A changed file under docs/browser-checks/ that is not a check (a fixture) can break every check
   that loads it; those are the checks whose source names it. */
function referrersOf(rel) {
  if (/\.md$/.test(rel) || rel === 'gated.txt') return []; // docs and the run list, not fixtures
  const base = path.basename(rel);
  return fs.readdirSync(CHECKS)
    .filter((f) => f.endsWith('.js') && f !== rel && stripComments(fs.readFileSync(path.join(CHECKS, f), 'utf8')).includes(base))
    .map((f) => f.slice(0, -3));
}

/* A top-level helper that is not a check and not a `lib-*` (thread-server.js, which the driver
   starts for render-thread): the checks whose code, comments stripped, names it whole-token. */
function namersOf(name) {
  const re = new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
  return fs.readdirSync(CHECKS)
    .filter((f) => f.endsWith('.js') && f !== `${name}.js` && re.test(stripComments(fs.readFileSync(path.join(CHECKS, f), 'utf8'))))
    .map((f) => f.slice(0, -3));
}

function select(diff, changedChecks = [], page = null) {
  const text = changedLines(diff);
  const can = runnable();
  const why = new Map();
  // A name reaches the workflow's shell unquoted, so only a plain check name is ever emitted.
  const add = (name, reason) => {
    if (!/^[\w-]+$/.test(name) || !can.has(name)) return;
    if (!why.has(name)) why.set(name, []);
    why.get(name).push(reason);
  };
  for (const n of changedChecks) {
    if (/[./]/.test(n)) for (const r of referrersOf(n)) add(r, `changed ${n}`);
    else if (/^lib-/.test(n)) for (const r of requirersOf(n)) add(r, `changed ${n}`);
    else if (can.has(n)) add(n, 'changed');
    else for (const r of new Set([...requirersOf(n), ...namersOf(n)])) add(r, `changed ${n}`);
  }
  if (text) selectByPage(diff, text, add, page === null ? fs.readFileSync(PAGE_FILE, 'utf8') : page);
  const skipped = new Map();
  for (const [n, reason] of Object.entries(KNOWN_RED)) {
    if (why.has(n) && !why.get(n).includes('changed')) { skipped.set(n, `${why.get(n).join('; ')} -- LEFT OUT, known red: ${reason}`); why.delete(n); }
  }
  why.skipped = skipped;
  return why;
}

function selectByPage(diff, text, add, page) {
  const covering = execFileSync('bash', [path.join(REPO, 'tools', 'bc-surface-map.sh'), 'covering', CHECKS], {
    cwd: REPO, input: diff, encoding: 'utf8',
  });
  for (const l of covering.split('\n')) if (l.trim()) add(l.trim().replace(/\.js$/, ''), 'surface');

  const index = pageIndex(page, text);
  const touched = touchedLines(diff);
  for (const f of fs.readdirSync(CHECKS).filter((x) => x.endsWith('.js')).sort()) {
    const name = f.slice(0, -3);
    const src = fs.readFileSync(path.join(CHECKS, f), 'utf8');
    if (isPageScoped(src)) add(name, 'page');
    for (const fn of declaredFunctions(src)) {
      const r = functionRange(page, fn);
      if (!r) add(name, `function ${fn} (not on the page)`);
      else if (r === 'unclosed') add(name, `function ${fn} (its end was not found)`);
      else if (touched.some((n) => n >= r[0] && n <= r[1])) add(name, `function ${fn}`);
    }
    const sel = [...selectorsOf(src, index)].filter((t) => hits(t, text) && usedAsSelector(t, text)).sort();
    if (sel.length) add(name, `selector ${sel.join(' ')}`);
    const nm = [...namesOf(src, index)].filter((t) => hits(t, text)).sort();
    if (nm.length) add(name, `name ${nm.join(' ')}`);
  }
}

function main(argv) {
  const [base, head = 'HEAD'] = argv;
  if (!base) {
    process.stderr.write('usage: node tools/bc-pr-select.js <base> [head]\n');
    return 2;
  }
  let diff;
  let changedChecks;
  let why;
  try {
    diff = git(['diff', `${base}...${head}`, '--', 'web/index.html']);
    // A check the PR edits runs too: a changed assertion is only proven by running it. A top-level
    // .js is a check or lib by name; any other file is passed by its path under the directory.
    changedChecks = git(['diff', '--name-only', `${base}...${head}`, '--', 'docs/browser-checks/'])
      .split('\n').filter(Boolean).map((f) => f.replace(/^docs\/browser-checks\//, ''))
      .map((f) => (/^[\w-]+\.js$/.test(f) ? f.slice(0, -3) : f));
    // The diff keeps its header, so bc-surface-map.sh file-scopes it as the gate does.
    // The head's own page: a `function` range is read against the lines this diff numbers.
    why = select(diff, changedChecks, git(['show', `${head}:web/index.html`]));
  } catch (e) {
    process.stderr.write(`bc-pr-select: could not select for ${base}...${head}: ${e.message}\n`);
    return 2;
  }
  const names = [...why.keys()].sort();
  for (const n of names) process.stdout.write(`${n}\t${why.get(n).join('; ')}\n`);
  for (const [n, r] of why.skipped) process.stderr.write(`bc-pr-select: ${n}: ${r}\n`);
  return 0;
}

module.exports = { KNOWN_RED, isPageScoped, declaredFunctions, functionRange, touchedLines, requirersOf, referrersOf, namersOf, usedAsSelector, selectorsOf, namesOf, pageIndex, stripComments, hits, changedLines, runnable, select, PAGE_SCOPE };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
