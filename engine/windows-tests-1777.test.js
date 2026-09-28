'use strict';
/**
 * #1777: the selection and the verdict of tools/windows-tests.js, the script the `windows` CI
 * job runs on a real Windows runner. Its runs are Windows-only; what it RUNS and how it JUDGES
 * are plain logic, tested here on any platform.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const w = require('../tools/windows-tests');

const ROOT = path.join(__dirname, '..');

test('selection: win32 test files in engine/ and at the root, plus ALSO, and nothing else', () => {
  const got = w.selectFiles(
    ['win32board.test.js', 'runners.win32-codex.test.js', 'store.test.js', 'store.js', 'win32board.js', 'status.test.js'],
    ['web.win32-update-offer.test.js', 'web.status.test.js', 'win32notes.md', 'store.test.js'],
  );
  assert.deepEqual(got, [
    'engine/runners.win32-codex.test.js', 'engine/store.test.js', 'engine/win32board.test.js',
    'web.win32-update-offer.test.js',
  ]);
});

test('selection on the real tree: named files are in, and the count has not shrunk', () => {
  const got = w.selectFiles(fs.readdirSync(__dirname), fs.readdirSync(ROOT));
  // 83 when this was written (#1777). A narrowed rule or a mass rename shows here; a new file
  // raises the count and needs nothing.
  assert.ok(got.length >= 83, `only ${got.length} files selected`);
  for (const f of [
    'engine/win32apply.test.js', 'engine/runners.win32-codex.test.js', 'engine/win32board.test.js',
    'engine/runners.win-runnable-2270.test.js', 'engine/windows-coupling-audit-1732.test.js',
    'engine.connect-win32-install-570.test.js', 'web.win32-update-offer.test.js',
  ]) assert.ok(got.includes(f), `${f} is not selected`);
  for (const n of w.ALSO) assert.ok(fs.existsSync(path.join(__dirname, n)), `ALSO names ${n}, which is not in engine/`);
});

test('failing test names are read from the spec reporter, without the file-level line', () => {
  const out = [
    '✔ fine (1.2ms)',
    '✖ engine\\win32x.test.js (300039.76ms)',
    '✖ the first one (3.1198ms)',
    '  ✖ a nested one (0.5ms)',
    '✖ failing tests:',
    '✖ the first one (3.1198ms)',
    '  AssertionError [ERR_ASSERTION]: nope',
  ].join('\n');
  assert.deepEqual(w.failingTests(out, 'engine/win32x.test.js'), ['the first one', 'a nested one']);
});

test('a real test whose title ends in .test.js is still read as failing', () => {
  const out = [
    '✖ engine/win32x.test.js (12ms)',
    '✖ loads config.test.js (1.5ms)',
  ].join('\n');
  assert.deepEqual(w.failingTests(out, 'engine/win32x.test.js'), ['loads config.test.js']);
});

const KNOWN = { 'engine/a.test.js': { card: '#1', tests: ['t1', 't2'] } };

test('verdict: exactly the listed tests failing is known red', () => {
  const v = w.judge([{ file: 'engine/a.test.js', ok: false, failing: ['t1', 't2'] }], KNOWN);
  assert.deepEqual(v.known, [{ file: 'engine/a.test.js', card: '#1' }]);
  assert.deepEqual(v.failed, []); assert.deepEqual(v.stale, []);
});

test('verdict: a NEW failing test inside a listed file is a new red, not hidden by the listing', () => {
  const v = w.judge([{ file: 'engine/a.test.js', ok: false, failing: ['t1', 't2', 'safety arm'] }], KNOWN);
  assert.equal(v.failed.length, 1);
  assert.match(v.failed[0].why, /safety arm/);
});

test('verdict: a listed file that hangs or is killed is a new red', () => {
  const v = w.judge([{ file: 'engine/a.test.js', ok: false, failing: [], killed: true }], KNOWN);
  assert.equal(v.failed.length, 1);
  assert.match(v.failed[0].why, /killed/);
});

test('verdict: a listed file that fails with no test named is a new red', () => {
  const v = w.judge([{ file: 'engine/a.test.js', ok: false, failing: [] }], KNOWN);
  assert.equal(v.failed.length, 1);
});

test('verdict: a listed test that passes now is stale, even while its sibling still fails', () => {
  const v = w.judge([{ file: 'engine/a.test.js', ok: false, failing: ['t1'] }], KNOWN);
  assert.equal(v.stale.length, 1);
  assert.match(v.stale[0].why, /t2/);
});

test('verdict: a listed file that passes, or was not run, is stale', () => {
  assert.equal(w.judge([{ file: 'engine/a.test.js', ok: true }], KNOWN).stale.length, 1);
  assert.match(w.judge([{ file: 'engine/b.test.js', ok: true }], KNOWN).stale[0].why, /not run/);
});

test('verdict: an unlisted failure, and a file the budget did not reach, are new reds', () => {
  const v = w.judge([
    { file: 'engine/c.test.js', ok: false, failing: ['x'] },
    { file: 'engine/d.test.js', ok: false, notRun: true },
    { file: 'engine/a.test.js', ok: false, failing: ['t1', 't2'] },
  ], KNOWN);
  assert.deepEqual(v.failed.map((f) => f.file), ['engine/c.test.js', 'engine/d.test.js']);
});

test('every KNOWN_RED entry names a selected file, a card and at least one test in that file', () => {
  const selected = new Set(w.selectFiles(fs.readdirSync(__dirname), fs.readdirSync(ROOT)));
  for (const [file, entry] of Object.entries(w.KNOWN_RED)) {
    assert.ok(selected.has(file), `${file} is listed as known red but is not a selected file`);
    assert.match(entry.card, /^#\d+$/, `${file} must name its card as #N`);
    assert.ok(entry.tests.length > 0, `${file} must name the tests expected to fail`);
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const name of entry.tests) {
      const bare = name.replace(/'/g, "\\'");
      assert.ok(src.includes(name) || src.includes(bare), `${file} has no test named "${name}"`);
    }
  }
});

test('the workflow runs this script on Windows, on PRs and pushes to main, and can go red', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'windows.yml'), 'utf8');
  assert.match(wf, /runs-on: windows-latest/);
  assert.match(wf, /run: node tools\/windows-tests\.js/);
  assert.match(wf, /^ {2}pull_request:/m);
  assert.match(wf, /branches: \["main"\]/);
  assert.doesNotMatch(wf, /continue-on-error/, 'a job that cannot fail is not a check');
  const minutes = Number(wf.match(/timeout-minutes: (\d+)/)[1]);
  assert.ok(minutes * 60000 > w.START_BUDGET_MS + w.PER_FILE_TIMEOUT_MS,
    'the job could be cancelled mid-file before the script prints its verdict');
});
