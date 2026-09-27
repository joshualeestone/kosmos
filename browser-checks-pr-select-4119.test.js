'use strict';

/**
 * #4119: tools/bc-pr-select.js names the browser checks a page diff touches, so the PR-time
 * `browser-checks` job runs them before merge instead of the cut finding them.
 *
 * The replay arms run against the REAL commits (test.yml checks out full history, #1794). A
 * missing commit FAILS rather than skips: a replay that silently did not run is the unarmed guard
 * this card is about.
 *   - #3985 (5a2aae1e3) broke render-talk. The #2518 surface map alone does not select it; the
 *     check's own selectors do.
 *   - #4095 (743711ea6) broke render-fields. No selector can select it; its page scope does.
 *
 *   node --test browser-checks-pr-select-4119.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TOOL = path.join(__dirname, 'tools', 'bc-pr-select.js');
const CHECKS = path.join(__dirname, 'docs', 'browser-checks');
const sel = require(TOOL);

function run(...args) {
  return execFileSync('node', [TOOL, ...args], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}
function rows(out) {
  return new Map(out.split('\n').filter(Boolean).map((l) => l.split('\t')));
}
function needCommit(c) {
  try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { cwd: __dirname, stdio: 'ignore' }); }
  catch { assert.fail(`${c} is not in this clone; the replay cannot run (needs full history: git fetch --unshallow)`); }
}

test('#3985 replay: render-talk is selected by its own selectors, which the surface map alone misses', () => {
  const c = '5a2aae1e3';
  needCommit(c);
  const got = rows(run(`${c}^`, c));
  assert.match(got.get('render-talk') || '', /selector .*\bmsg\b/, 'render-talk must be selected by a selector it queries');
  // Why the selector half exists: the annotation map, fed the same diff, does not reach it.
  const diff = execFileSync('git', ['diff', `${c}^...${c}`, '--', 'web/index.html'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20 });
  const covering = execFileSync('bash', ['tools/bc-surface-map.sh', 'covering'], { cwd: __dirname, input: diff, encoding: 'utf8' });
  assert.ok(covering.trim().length > 0, 'the surface map selected nothing at all, so this comparison is vacuous');
  assert.ok(!/^render-talk\.js$/m.test(covering), 'the surface map now selects render-talk by itself; update this arm');
});

test('#4095 replay: render-fields is selected by page scope', () => {
  const c = '743711ea6';
  needCommit(c);
  const got = rows(run(`${c}^`, c));
  assert.match(got.get('render-fields') || '', /\bpage\b/);
  assert.match(got.get('contrast') || '', /\bpage\b/);
  // The PR's own edited checks run as `changed`.
  assert.match(got.get('render-tasks-view-3559') || '', /\bchanged\b/);
});

test('controls: a PR that does not touch the page selects no page checks', () => {
  // #4102 edits render-talk.js only: it runs that check and nothing the page would select.
  needCommit('4a339863');
  assert.deepEqual([...rows(run('4a339863^', '4a339863')).entries()], [['render-talk', 'changed']]);
  // An engine-only PR (a5907aca4) and a docs-only one (fe735b965, the browser-checks README only, which DOES trigger this job's path filter) select nothing.
  for (const c of ['a5907aca4', 'fe735b965']) {
    needCommit(c);
    assert.equal(run(`${c}^`, c), '', `${c} touches no page and no check, so it must select nothing`);
  }
});

test('every check the driver runs is reachable by some route, so none falls outside the selector', () => {
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const index = sel.pageIndex(page);
  const surface = new Set(execFileSync('bash', ['tools/bc-surface-map.sh', 'map'], { cwd: __dirname, encoding: 'utf8' })
    .split('\n').filter(Boolean).map((l) => l.split('\t')[0].replace(/\.js$/, '')));
  const unreachable = [];
  for (const n of sel.runnable()) {
    const f = path.join(CHECKS, `${n}.js`);
    if (!fs.existsSync(f)) continue; // a label with no file of its name is the next test's business
    const src = fs.readFileSync(f, 'utf8');
    if (sel.selectorsOf(src, index).size || sel.namesOf(src, index).size || surface.has(n) || sel.isPageScoped(src)) continue;
    unreachable.push(n);
  }
  assert.deepEqual(unreachable, [], 'these checks name no selector, page function, surface token or page scope: '
    + 'give each a `// Browser-check-surface:` or `// Browser-check-scope: page` line');
});

test('the driver runs each check under its own file name, so selecting by file selects the label', () => {
  // Read the driver itself, not runnable(): the risk is a check run under a label that is not
  // its file name, which select() would then silently drop.
  const driver = fs.readFileSync(path.join(__dirname, 'tools', 'browser-checks.sh'), 'utf8').replace(/\\\n/g, ' ');
  const pairs = [...driver.matchAll(/run_one\s+"([\w-]+)"[^\n]*?docs\/browser-checks\/([\w-]+)\.js/g)];
  assert.ok(pairs.length > 20, `found only ${pairs.length} run_one lines naming a check file; the driver moved`);
  const wrong = pairs.filter((m) => m[1] !== m[2]).map((m) => `${m[1]} runs ${m[2]}.js`);
  assert.deepEqual(wrong, []);
  assert.match(driver, /run_one "\$n" node "docs\/browser-checks\/\$n\.js"/, 'the gated.txt loop no longer runs <name>.js as <name>');
  // runnable() reads literal labels only. A label built at run time is invisible to it, so a new
  // one must be seen here: add it to runnable() (or gated.txt), then to this list.
  const built = [...driver.matchAll(/run_one\s+"([^"]*\$[^"]*)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(built, ['$n', 'mobile-shots-leak-${_arm%%:*}']);
});

test('editing a shared lib-*.js helper selects every check that requires it', () => {
  const requirers = sel.requirersOf('lib-sandbox-guard');
  assert.ok(requirers.length >= 5, `only ${requirers.length} checks require lib-sandbox-guard; the require pattern broke`);
  const why = sel.select('', ['lib-sandbox-guard']);
  const can = sel.runnable();
  for (const r of requirers.filter((n) => can.has(n))) assert.match((why.get(r) || []).join(' '), /changed lib-sandbox-guard/);
  assert.ok(!why.has('lib-sandbox-guard'), 'a helper is not a check and must not be named');
});

test('editing a fixture under docs/browser-checks/ selects every check that loads it', () => {
  const users = sel.referrersOf('fixtures/agent-card.json');
  assert.ok(users.includes('render-talk'), `render-talk loads fixtures/agent-card.json; found only ${users.join(' ')}`);
  const why = sel.select('', ['fixtures/agent-card.json']);
  assert.match((why.get('render-talk') || []).join(' '), /changed fixtures\/agent-card\.json/);
  assert.equal(sel.select('', ['README.md']).size, 0, 'a file no check names selects nothing');
});

test('only a plain check name is ever emitted, since the workflow reads the list unquoted', () => {
  const why = sel.select('', ['render-talk', 'render-talk $(touch x)', 'a b']);
  assert.deepEqual([...why.keys()], ['render-talk']);
});

test('a known-red check is left out and said to be left out, unless the PR edits it', () => {
  const n = 'render-provider-combobox-1040';
  assert.ok(sel.KNOWN_RED[n], `${n} left KNOWN_RED: point this arm at an entry that is still there, or delete it`);
  const diff = 'diff --git a/web/index.html b/web/index.html\n@@ -1 +1 @@\n+<ul id="pcombo-list"></ul>\n';
  const why = sel.select(diff, []);
  assert.ok(!why.has(n), `${n} is known red on the runner and must not be selected by the page diff`);
  assert.match(why.skipped.get(n) || '', /selector[^;]*pcombo-list.*LEFT OUT, known red/);
  const fix = sel.select('', [n]);
  assert.deepEqual(fix.get(n), ['changed'], 'a PR that edits a known-red check runs it, so its fix can show green');
  assert.ok(!fix.skipped.has(n));
});

test('the whole-page checks carry the page scope, on their first lines only', () => {
  for (const f of ['render-fields', 'contrast']) {
    assert.ok(sel.isPageScoped(fs.readFileSync(path.join(CHECKS, `${f}.js`), 'utf8')), `${f}.js lost its page scope`);
  }
  assert.equal(sel.isPageScoped('\n'.repeat(10) + '// Browser-check-scope: page\n'), false, 'a marker deep in a file must not count');
});

test('selectorsOf reads queries, selector-shaped strings and real page ids, not method names or paths', () => {
  const index = { ids: new Set(['auto-toggle']) };
  const got = sel.selectorsOf(`
    page.querySelector('#d-send .msg-t');
    page.locator(".mwhen").click();
    document.getElementById('tsk-by');
    const SURVIVAL = '#grid .acard';
    const ROWS = [{ id: 'auto-toggle' }, { id: 'not-on-the-page' }];
    rows.map((x) => x.length);
    Foo.prototype('see board.html');
    check('...and that sweep was real');
    check(\`classified \${r.s}\`);
    const f = 'docs/browser-checks/x.js';
    // don't read this: '#in-a-comment'
  `, index);
  assert.deepEqual([...got].sort(), ['acard', 'auto-toggle', 'd-send', 'grid', 'msg-t', 'mwhen', 'tsk-by']);
});

test('namesOf reads distinctive page functions the check calls, not plain words or comments', () => {
  const index = sel.pageIndex('function frClaudeInstallNeeded() {}\nfunction open() {}\nconst KOSMOS_MAX = 3;');
  const got = sel.namesOf('page.evaluate(() => frClaudeInstallNeeded() && open() && KOSMOS_MAX); // frClaudeGone()', index);
  assert.deepEqual([...got].sort(), ['KOSMOS_MAX', 'frClaudeInstallNeeded']);
});

test('an id the PR removes still counts, so a check asking for it is selected', () => {
  const index = sel.pageIndex('<div id="kept"></div>', '-<div id="gone-now"></div>');
  assert.ok(index.ids.has('gone-now'));
});

test('hits is whole-token, the #2518 boundary', () => {
  assert.equal(sel.hits('tsk', '+<input id="tsk-by">'), false);
  assert.equal(sel.hits('tsk-by', '+<input id="tsk-by">'), true);
  assert.equal(sel.hits('msg', '+  .msg-t { color: red }'), false);
  assert.equal(sel.hits('msg', '+  .msg { color: red }'), true);
});

test('only changed lines inside hunks count, including one that itself begins with --', () => {
  const diff = [
    'diff --git a/web/index.html b/web/index.html',
    '--- a/web/index.html',
    '+++ b/web/index.html',
    '@@ -1,3 +1,3 @@',
    ' <div id="unchanged-context">',
    '-<b class="old">',
    '--- a css comment line that starts with two dashes, class .dashed',
    '+<b class="new">',
  ].join('\n');
  const text = sel.changedLines(diff);
  assert.equal(sel.hits('unchanged-context', text), false);
  assert.equal(sel.hits('old', text), true);
  assert.equal(sel.hits('new', text), true);
  assert.equal(sel.hits('dashed', text), true);
  assert.equal(sel.hits('index', text), false);
});
