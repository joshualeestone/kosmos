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
 *   - #4131 (a936fb83f..d586f361a, rebase-merged) broke render-room-msgbox-2806 on main after its
 *     PR job passed. The surface map alone does not select it; its `pj-post` selector does.
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

test('#4131 replay: render-room-msgbox-2806 is selected by its pj-post selector, which the surface map alone misses', () => {
  const [base, head] = ['a936fb83f', 'd586f361a']; // the PR was rebase-merged: its commits sit on base
  needCommit(base); needCommit(head);
  const got = rows(run(base, head));
  assert.match(got.get('render-room-msgbox-2806') || '', /selector .*\bpj-post\b/);
  const diff = execFileSync('git', ['diff', `${base}...${head}`, '--', 'web/index.html'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20 });
  const covering = execFileSync('bash', ['tools/bc-surface-map.sh', 'covering'], { cwd: __dirname, input: diff, encoding: 'utf8' });
  assert.ok(covering.trim().length > 0, 'the surface map selected nothing at all, so this comparison is vacuous');
  assert.ok(!/^render-room-msgbox-2806\.js$/m.test(covering), 'the surface map now selects it by itself; update this arm');
});

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
  assert.equal(sel.select('', ['README.md']).size, 0, 'the README is not a fixture');
  assert.equal(sel.select('', ['fixtures/no-check-loads-this.json']).size, 0, 'a file no check names selects nothing');
});

test('editing a top-level helper that is not a check selects the checks that use it', () => {
  assert.ok(!sel.runnable().has('thread-server'), 'thread-server became a check: point this arm at another helper');
  const why = sel.select('', ['thread-server']);
  assert.match((why.get('render-thread') || []).join(' '), /changed thread-server/);
  assert.ok(!why.has('thread-server'));
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

test('a selector token counts only where the diff uses it as a selector, not in prose (Johnny Cage, #4190)', () => {
  assert.equal(sel.usedAsSelector('you', '+  <p>Thank you, you are in.</p>'), false, 'a class named like a word is not hit by the word');
  assert.equal(sel.usedAsSelector('on', '+  <p>Turn it on now</p>'), false);
  assert.equal(sel.usedAsSelector('pj-empty', '+  return \'<div class="pj-empty boardfail">\''), true, 'the first class in an attribute');
  assert.equal(sel.usedAsSelector('boardfail', '+  <div class="pj-empty boardfail">'), true);
  assert.equal(sel.usedAsSelector('pj-list', '+  <ul id="pj-list">'), true);
  assert.equal(sel.usedAsSelector('msg', "+  el.querySelector('.msg')"), true);
  assert.equal(sel.usedAsSelector('on', "+  el.classList.toggle('on')"), true);
  assert.equal(sel.usedAsSelector('pj-empty', '+  <div class="pj-emptyish">'), false, 'whole token only');
  // The page's own ways of setting classes in script (review of this change: all four were missed).
  assert.equal(sel.usedAsSelector('stale', "+  checked.className = 'checked stamp stale';"), true, 'a class list string');
  assert.equal(sel.usedAsSelector('stale', "+  (age > 30 ? ' stale' : '')"), true, 'a class glued on with a space');
  assert.equal(sel.usedAsSelector('conn', "+  el.className = 'conn ' + state;"), true, 'a class prefix');
  assert.equal(sel.usedAsSelector('you', '+  el.setAttribute("class", "a you");'), true, 'setAttribute class');
  assert.equal(sel.usedAsSelector('you', "+  msg = 'Thank you, you are in.';"), false, 'quoted copy with punctuation');
  assert.equal(sel.usedAsSelector('you', '+  <div data-id="x">thank you</div>'), false, 'id inside data-id is not an id attribute');
});

test('through select(): the word "you" in copy no longer picks the check that queries .you, the class still does', () => {
  const diff = (line) => `diff --git a/web/index.html b/web/index.html\n@@ -1 +1 @@\n${line}\n`;
  assert.ok(!sel.select(diff('+<p>Thank you, you are all set.</p>'), []).has('render-assistant-hosted-3660'), 'selected by prose');
  const why = sel.select(diff('+<div class="you">'), []).get('render-assistant-hosted-3660') || [];
  assert.match(why.join(' '), /selector .*\byou\b/, 'the control: a real .you change must still select it');
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

/* ---- `function`: a change inside the body of a page function a check declares (#4119, Liu Kang's go-ahead) ---- */

test('#3828 replay: render-assistant-hosted-3660 is selected by `function asbAvatar`, which no other rule reaches', () => {
  const c = '0f95dcf36'; // #3828, squash-merged: it changed only lines INSIDE asbAvatar(), and the 0.6.95 cut found it
  needCommit(c);
  const got = rows(run(`${c}^`, c));
  assert.equal(got.get('render-assistant-hosted-3660'), 'function asbAvatar', 'selected by the function rule, and by it alone');
  assert.match(got.get('render-assistant-bubble-3034') || '', /\bfunction asbAvatar\b/);
  // CONTROL: without its declaration the check is not selected at all, so this is the rule doing it.
  const diff = execFileSync('git', ['diff', `${c}^...${c}`, '--', 'web/index.html'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20 });
  const page = execFileSync('git', ['show', `${c}:web/index.html`], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20 });
  const src = fs.readFileSync(path.join(CHECKS, 'render-assistant-hosted-3660.js'), 'utf8');
  const orig = fs.readFileSync;
  fs.readFileSync = (p, ...a) => (String(p).endsWith('render-assistant-hosted-3660.js')
    ? src.replace(/^\/\/ Browser-check-functions:.*\n/m, '') : orig(p, ...a));
  try { assert.equal(sel.select(diff, [], page).has('render-assistant-hosted-3660'), false, 'something else now selects it; update this arm'); }
  finally { fs.readFileSync = orig; }
});

test('touchedLines numbers the head side: each added line, and the head line a removed line sat before', () => {
  const diff = [
    'diff --git a/web/index.html b/web/index.html', '--- a/web/index.html', '+++ b/web/index.html',
    '@@ -10,4 +10,4 @@', ' ctx10', '-gone', '+new11', ' ctx12', '--- a removed line starting with dashes', ' ctx13',
    '@@ -40,2 +40,3 @@', ' ctx40', '+added41', ' ctx42',
  ].join('\n');
  assert.deepEqual(sel.touchedLines(diff), [11, 11, 13, 41]);
});

test('functionRange runs from the declaration to its own closing brace, and is null for a function the page lacks', () => {
  const page = ['x', 'function outer(a) {', '  if (a) {', '  }', '  function inner() {', '  }', '}', 'function next() {', '}'].join('\n');
  assert.deepEqual(sel.functionRange(page, 'outer'), [2, 7]);
  assert.deepEqual(sel.functionRange(page, 'inner'), [5, 6]);
  assert.equal(sel.functionRange(page, 'missing'), null);
});

test('declaredFunctions is read from a check\'s first lines only', () => {
  assert.deepEqual(sel.declaredFunctions('// Browser-check-surface: a\n// Browser-check-functions: asbAvatar fooBar\n'), ['asbAvatar', 'fooBar']);
  assert.deepEqual(sel.declaredFunctions('1\n2\n3\n4\n5\n// Browser-check-functions: late\n'), []);
});

test('through select(): a line inside the declared body selects, a line outside does not, and a vanished function selects', () => {
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const [start, end] = sel.functionRange(page, 'asbAvatar');
  const hunk = (at) => ['diff --git a/web/index.html b/web/index.html', '--- a/web/index.html', '+++ b/web/index.html',
    `@@ -${at},1 +${at},1 @@`, '-  const probeOld = 1;', '+  const probeNew = 2;'].join('\n');
  assert.match((sel.select(hunk(start + 2), [], page).get('render-assistant-hosted-3660') || []).join(';'), /function asbAvatar/);
  assert.doesNotMatch((sel.select(hunk(end + 5), [], page).get('render-assistant-hosted-3660') || []).join(';'), /function asbAvatar/, 'CONTROL: a line after the body');
  assert.doesNotMatch((sel.select(hunk(start - 1), [], page).get('render-assistant-hosted-3660') || []).join(';'), /function asbAvatar/, 'CONTROL: the line before the declaration');
  const renamed = page.replace('function asbAvatar(', 'function asbAvatarRenamed(');
  assert.match((sel.select(hunk(end + 5), [], renamed).get('render-assistant-hosted-3660') || []).join(';'), /function asbAvatar \(not on the page\)/);
});

test('every function a check declares is defined on the page today, so no declaration selects on every diff', () => {
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const declared = [];
  for (const f of fs.readdirSync(CHECKS).filter((x) => x.endsWith('.js'))) {
    for (const fn of sel.declaredFunctions(fs.readFileSync(path.join(CHECKS, f), 'utf8'))) {
      declared.push(`${f}:${fn}`);
      const r = sel.functionRange(page, fn);
      assert.ok(Array.isArray(r), `${f} declares ${fn}, which web/index.html ${r === 'unclosed' ? 'declares with no closing brace at its own indentation' : 'no longer defines'}`);
      // The range is the body, checked independently of how the finder finds its end: its braces balance once
      // strings and // comments are removed. A range that ends early or runs on leaves them unbalanced.
      let open = 0; let close = 0;
      for (const l of page.split('\n').slice(r[0] - 1, r[1])) {
        const code = l.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""').replace(/\/\/.*$/, '');
        open += (code.match(/\{/g) || []).length; close += (code.match(/\}/g) || []).length;
      }
      assert.ok(open > 0 && open === close, `${f}'s ${fn} range [${r}] is not one balanced body (${open} { against ${close} })`);
    }
  }
  assert.ok(declared.length >= 2, `CONTROL: the walker found ${declared.length} declarations; it must see the two this card added`);
});

test('functionRange: a closing line may carry ; or a comment, a one-line function is one line, and a missing end says so', () => {
  const page = ['x', 'function a() { return 1; }', 'function b(x) {', '  y();', '}; // end of b', 'function c() {', '  z();', 'function d() {', '}'].join('\n');
  assert.deepEqual(sel.functionRange(page, 'a'), [2, 2]);
  assert.deepEqual(sel.functionRange(page, 'b'), [3, 5]);
  // c has no closer before d's: it is 'unclosed', never stretched over d (d's own `}` is at the same indentation).
  assert.equal(sel.functionRange(page, 'c'), 'unclosed');
  assert.equal(sel.functionRange(page, 'nope'), null);
  // A brace in a string or a trailing comment does not make a one-line function; indentation and a
  // destructured parameter's braces are handled.
  const more = ['function f() { const s = "}"', '  g();', '}', 'function h() { return 1; } // {',
    '  function k({a} = {}) {', '    q();', '  }'].join('\n');
  assert.deepEqual(sel.functionRange(more, 'f'), [1, 3]);
  assert.deepEqual(sel.functionRange(more, 'h'), [4, 4]);
  assert.deepEqual(sel.functionRange(more, 'k'), [5, 7]);
});

test('through select(): an unclosed declared function selects its check with its own reason, not "not on the page"', () => {
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const [start, end] = sel.functionRange(page, 'asbAvatar');
  const lines = page.split('\n');
  const broken = [...lines.slice(0, end - 1), '  // (closing brace removed)', ...lines.slice(end)].join('\n');
  const diff = ['diff --git a/web/index.html b/web/index.html', '--- a/web/index.html', '+++ b/web/index.html',
    `@@ -${start + 2},1 +${start + 2},1 @@`, '-  const probeOld = 1;', '+  const probeNew = 2;'].join('\n');
  const got = (sel.select(diff, [], broken).get('render-assistant-hosted-3660') || []).join(';');
  assert.match(got, /function asbAvatar \(its end was not found\)/);
  assert.doesNotMatch(got, /not on the page/);
});

test('touchedLines counts only web/index.html hunks, and places a -U0 pure deletion after its head line', () => {
  const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -1,1 +1,1 @@', '-a', '+b',
    'diff --git a/web/index.html b/web/index.html', '--- a/web/index.html', '+++ b/web/index.html',
    '@@ -10,2 +9,0 @@', '-gone1', '-gone2', '@@ -20 +20 @@', '-old', '+new'].join('\n');
  assert.deepEqual(sel.touchedLines(diff), [10, 10, 20, 20]);
  // A header without a/ b/ prefixes (diff.noprefix) is still the page's.
  const noprefix = ['diff --git web/index.html web/index.html', '--- web/index.html', '+++ web/index.html', '@@ -5 +5 @@', '-a', '+b'].join('\n');
  assert.deepEqual(sel.touchedLines(noprefix), [5, 5]);
});
