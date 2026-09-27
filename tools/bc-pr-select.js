'use strict';
/**
 * #4119: which browser checks does this page diff touch?
 *
 *   node tools/bc-pr-select.js <base> [head]          # one `<check>\t<why>` line per check
 *   node tools/bc-pr-select.js --names <base> [head]  # the names only, space-separated
 *
 * The PR-time `browser-checks` job runs a FIXED allowlist (#2445). Twice on 2026-09-26 a page PR
 * passed it and broke a check outside it, found only at the cut: #3985 broke render-talk, #4095
 * broke render-fields. This names the checks a `web/index.html` diff reaches, so the PR job runs
 * them too. It diffs `<base>...<head>` (the merge base, as the #2518 gate does), web/index.html
 * only, and reads the changed (+/-) lines.
 *
 * FOUR WAYS A CHECK IS SELECTED, each printed as its reason:
 *   0. `changed`: the PR edits the check's own file.
 *   1. `surface`: its `// Browser-check-surface:` tokens (#2518), through
 *      `tools/bc-surface-map.sh covering`. Reused, not reimplemented, so the two cannot drift.
 *   2. `selector`: an id or class the check's own source QUERIES (inside a querySelector /
 *      locator / getElementById / ... string argument) appears whole-token in a changed line.
 *      This is what reaches the 138 checks with no annotation. It selected render-talk for
 *      #3985 through `.msg`, `.msg-t` and `.mwhen`; the surface map selected nothing there.
 *   3. `page`: the check declares `// Browser-check-scope: page`, meaning it sweeps the whole
 *      page (every field, every piece of text) rather than named elements. It runs on ANY page
 *      change. render-fields is the case: #4095 broke it through `#tsk-by`, which render-fields
 *      never names and no selector map could ever connect to it.
 *
 * 🔑 NOT browser-checks-selectors.test.js's idsAskedFor, on purpose. That reads ids only and
 * skips lines asserting an id is ABSENT. #3985 reached render-talk through CLASSES alone, so an
 * id-only reader would have missed the case this exists for; and a change can break an absence
 * assertion as easily as a presence one.
 *
 * ⚠️ `selector` IS A HEURISTIC, and it errs in both directions. A selector built at run time
 * (concatenated, or held in a variable) is invisible to it, so a check can still be missed. A
 * common class (`.msg`) selects checks the change cannot really affect, which costs PR time but
 * never gives a wrong verdict. The fixed allowlist and the cut's full 3b are unchanged.
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

// A string argument to a DOM query, and the #id / .class tokens inside it.
const QUERY = /(?:querySelector(?:All)?|\$\$?|\$eval|\$\$eval|locator|waitForSelector|getElementById|closest|matches|click|fill|hover|isVisible|textContent|innerText|getAttribute|dispatchEvent|press|type|check|uncheck|selectOption)\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const TOKEN = /[#.]([A-Za-z][\w-]*)/g;
const BY_ID = /getElementById\(\s*['"`]([A-Za-z][\w-]*)['"`]/g;
const PAGE_SCOPE = /^\s*\/\/\s*browser-check-scope:\s*page(\s|$)/im;

function selectorsOf(src) {
  const out = new Set();
  for (const m of src.matchAll(QUERY)) for (const t of m[2].matchAll(TOKEN)) out.add(t[1]);
  for (const m of src.matchAll(BY_ID)) out.add(m[1]);
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

function changedLines(diff) {
  return diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)( |$)/.test(l)).join('\n');
}

function runnable() {
  const names = new Set();
  const gated = fs.readFileSync(path.join(CHECKS, 'gated.txt'), 'utf8');
  for (const l of gated.split('\n')) { const n = l.trim(); if (n && !n.startsWith('#')) names.add(n); }
  const driver = fs.readFileSync(path.join(REPO, 'tools', 'browser-checks.sh'), 'utf8');
  for (const m of driver.matchAll(/run_one\s+"([\w-]+)"/g)) names.add(m[1]);
  return names;
}

function select(diff, changedChecks = []) {
  const text = changedLines(diff);
  const can = runnable();
  const why = new Map();
  const add = (name, reason) => {
    if (!can.has(name)) return;
    if (!why.has(name)) why.set(name, []);
    why.get(name).push(reason);
  };
  for (const n of changedChecks) add(n, 'changed');
  if (!text) return why;

  const covering = execFileSync('bash', [path.join(REPO, 'tools', 'bc-surface-map.sh'), 'covering', CHECKS], {
    cwd: REPO, input: diff, encoding: 'utf8',
  });
  for (const l of covering.split('\n')) if (l.trim()) add(l.trim().replace(/\.js$/, ''), 'surface');

  for (const f of fs.readdirSync(CHECKS).filter((x) => x.endsWith('.js')).sort()) {
    const name = f.slice(0, -3);
    const src = fs.readFileSync(path.join(CHECKS, f), 'utf8');
    if (PAGE_SCOPE.test(src)) add(name, 'page');
    const hit = [...selectorsOf(src)].filter((t) => hits(t, text)).sort();
    if (hit.length) add(name, `selector ${hit.join(' ')}`);
  }
  return why;
}

function main(argv) {
  const namesOnly = argv[0] === '--names';
  const [base, head = 'HEAD'] = namesOnly ? argv.slice(1) : argv;
  if (!base) {
    process.stderr.write('usage: node tools/bc-pr-select.js [--names] <base> [head]\n');
    return 2;
  }
  let diff;
  try { diff = git(['diff', `${base}...${head}`, '--', 'web/index.html']); }
  catch (e) { process.stderr.write(`bc-pr-select: git diff ${base}...${head} failed: ${e.message}\n`); return 2; }
  // A check the PR edits runs too: a changed assertion is only proven by running it.
  const changedChecks = git(['diff', '--name-only', `${base}...${head}`, '--', 'docs/browser-checks/'])
    .split('\n').map((f) => f.match(/^docs\/browser-checks\/([\w-]+)\.js$/)).filter(Boolean).map((m) => m[1]);
  // The diff keeps its header, so bc-surface-map.sh file-scopes it as the gate does.
  const why = select(diff, changedChecks);
  const names = [...why.keys()].sort();
  if (namesOnly) process.stdout.write(names.join(' ') + (names.length ? '\n' : ''));
  else for (const n of names) process.stdout.write(`${n}\t${why.get(n).join('; ')}\n`);
  return 0;
}

module.exports = { selectorsOf, hits, changedLines, runnable, select };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
