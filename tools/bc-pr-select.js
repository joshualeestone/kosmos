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
 * only, and reads the changed (+/-) lines. `head` picks the diff only: the checks, the page index
 * and gated.txt are read from the working tree, so a replay asks what TODAY's checks select.
 *
 * NOT READ: test-support/, tools/browser-checks.sh, and web/ files other than index.html. The job
 * fires on them, but a change there runs the fixed allowlist only, as it did before #4119.
 *
 * FIVE WAYS A CHECK IS SELECTED, each printed as its reason:
 *   `changed`  the PR edits the check's own file, a `lib-*.js` helper the check requires, or
 *              another file under docs/browser-checks/ (a fixture) whose name the check's source uses.
 *   `surface`  its `// Browser-check-surface:` tokens (#2518), through
 *              `tools/bc-surface-map.sh covering`. Reused, not reimplemented, so the two cannot drift.
 *   `selector` an id or class the check's own source asks the page for appears whole-token in a
 *              changed line: a `#id` / `.class` in a query call or in any selector-shaped string
 *              (so a selector held in a constant counts), or a bare string that is an id the page
 *              has. This reaches the 138 checks with no annotation. It selected render-talk for
 *              #3985 through `.msg`, `.msg-t` and `.mwhen`; the surface map selected nothing there.
 *   `name`     a page function or constant the check calls or reads (camelCase or UPPER_SNAKE,
 *              defined in the page) appears in a changed line. Some checks drive the page's own
 *              functions and touch no element (render-connect-skip reads frClaudeInstallNeeded).
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
 * still be missed. A common class (`.msg`) selects checks the change cannot really affect, which
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

function select(diff, changedChecks = []) {
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
  if (text) selectByPage(diff, text, add);
  const skipped = new Map();
  for (const [n, reason] of Object.entries(KNOWN_RED)) {
    if (why.has(n) && !why.get(n).includes('changed')) { skipped.set(n, `${why.get(n).join('; ')} -- LEFT OUT, known red: ${reason}`); why.delete(n); }
  }
  why.skipped = skipped;
  return why;
}

function selectByPage(diff, text, add) {
  const covering = execFileSync('bash', [path.join(REPO, 'tools', 'bc-surface-map.sh'), 'covering', CHECKS], {
    cwd: REPO, input: diff, encoding: 'utf8',
  });
  for (const l of covering.split('\n')) if (l.trim()) add(l.trim().replace(/\.js$/, ''), 'surface');

  const index = pageIndex(fs.readFileSync(PAGE_FILE, 'utf8'), text);
  for (const f of fs.readdirSync(CHECKS).filter((x) => x.endsWith('.js')).sort()) {
    const name = f.slice(0, -3);
    const src = fs.readFileSync(path.join(CHECKS, f), 'utf8');
    if (isPageScoped(src)) add(name, 'page');
    const sel = [...selectorsOf(src, index)].filter((t) => hits(t, text)).sort();
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
    why = select(diff, changedChecks);
  } catch (e) {
    process.stderr.write(`bc-pr-select: could not select for ${base}...${head}: ${e.message}\n`);
    return 2;
  }
  const names = [...why.keys()].sort();
  for (const n of names) process.stdout.write(`${n}\t${why.get(n).join('; ')}\n`);
  for (const [n, r] of why.skipped) process.stderr.write(`bc-pr-select: ${n}: ${r}\n`);
  return 0;
}

module.exports = { KNOWN_RED, isPageScoped, requirersOf, referrersOf, namersOf, selectorsOf, namesOf, pageIndex, stripComments, hits, changedLines, runnable, select, PAGE_SCOPE };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
