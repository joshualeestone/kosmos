'use strict';

/**
 * #4119: tools/bc-pr-select.js names the browser checks a page diff touches, so the PR-time
 * `browser-checks` job runs them before merge instead of the cut finding them.
 *
 * The two replay arms are the card's proof cases, run against the REAL 2026-09-26 commits
 * (test.yml checks out full history, #1794). A missing commit FAILS rather than skips: a replay
 * that silently did not run is the unarmed guard this card is about.
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
const sel = require(TOOL);

function run(...args) {
  return execFileSync('node', [TOOL, ...args], { cwd: __dirname, encoding: 'utf8' });
}
function rows(out) {
  return new Map(out.split('\n').filter(Boolean).map((l) => l.split('\t')));
}
function haveCommit(c) {
  try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { cwd: __dirname, stdio: 'ignore' }); return true; }
  catch { return false; }
}

test('#3985 replay: render-talk is selected by its own selectors, which the surface map alone misses', () => {
  const c = '5a2aae1e3';
  assert.ok(haveCommit(c), `${c} is not in this clone; the replay cannot run (needs full history)`);
  const got = rows(run(`${c}^`, c));
  assert.match(got.get('render-talk') || '', /^selector .*\bmsg\b/, 'render-talk must be selected by a queried selector');
  // Why the selector half exists: the annotation map, fed the same diff, does not reach it.
  const diff = execFileSync('git', ['diff', `${c}^...${c}`, '--', 'web/index.html'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20 });
  const covering = execFileSync('bash', ['tools/bc-surface-map.sh', 'covering'], { cwd: __dirname, input: diff, encoding: 'utf8' });
  assert.ok(covering.trim().length > 0, 'the surface map selected nothing at all, so this comparison is vacuous');
  assert.ok(!/^render-talk\.js$/m.test(covering), 'the surface map now selects render-talk by itself; update this arm');
});

test('#4095 replay: render-fields is selected by page scope', () => {
  const c = '743711ea6';
  assert.ok(haveCommit(c), `${c} is not in this clone; the replay cannot run (needs full history)`);
  const got = rows(run(`${c}^`, c));
  assert.match(got.get('render-fields') || '', /\bpage\b/);
  assert.match(got.get('contrast') || '', /\bpage\b/);
  // The changed checks of that PR are selected as changed.
  assert.match(got.get('render-tasks-view-3559') || '', /\bchanged\b/);
});

test('control: a PR that does not touch the page selects no page or selector checks', () => {
  const c = '4a339863'; // #4102: edits render-talk.js only
  assert.ok(haveCommit(c), `${c} is not in this clone`);
  const got = rows(run(`${c}^`, c));
  assert.deepEqual([...got.entries()], [['render-talk', 'changed']]);
});

test('every name it prints is one the driver runs, so the never-ran guard cannot fire on it', () => {
  const can = sel.runnable();
  assert.ok(can.size > 150, `runnable() found only ${can.size} checks; gated.txt or the driver moved`);
  for (const name of run('--names', '5a2aae1e3^', '5a2aae1e3').trim().split(/\s+/)) {
    assert.ok(can.has(name), `${name} is not a check tools/browser-checks.sh runs`);
  }
});

test('the whole-page checks carry the page scope', () => {
  for (const f of ['render-fields', 'contrast']) {
    const src = fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', `${f}.js`), 'utf8');
    assert.match(src, /^\s*\/\/\s*Browser-check-scope:\s*page\b/m, `${f}.js lost its page scope`);
  }
});

test('selectorsOf reads ids and classes from query arguments, not from method names', () => {
  const got = sel.selectorsOf(`
    page.querySelector('#d-send .msg-t');
    page.locator(".mwhen").click();
    document.getElementById('tsk-by');
    rows.map((x) => x.length);
    const s = 'not.a.selector';
  `);
  assert.deepEqual([...got].sort(), ['d-send', 'msg-t', 'mwhen', 'tsk-by']);
});

test('hits is whole-token, the #2518 boundary', () => {
  assert.equal(sel.hits('tsk', '+<input id="tsk-by">'), false);
  assert.equal(sel.hits('tsk-by', '+<input id="tsk-by">'), true);
  assert.equal(sel.hits('msg', '+  .msg-t { color: red }'), false);
  assert.equal(sel.hits('msg', '+  .msg { color: red }'), true);
});

test('only changed lines count, not the diff headers or context', () => {
  const diff = [
    'diff --git a/web/index.html b/web/index.html',
    '--- a/web/index.html',
    '+++ b/web/index.html',
    '@@ -1,3 +1,3 @@',
    ' <div id="unchanged-context">',
    '-<b class="old">',
    '+<b class="new">',
  ].join('\n');
  const text = sel.changedLines(diff);
  assert.equal(sel.hits('unchanged-context', text), false);
  assert.equal(sel.hits('old', text), true);
  assert.equal(sel.hits('new', text), true);
  assert.equal(sel.hits('index', text), false);
});
