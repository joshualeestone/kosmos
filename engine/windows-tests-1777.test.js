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
const { selectFiles, judge, ALSO, KNOWN_RED } = require('../tools/windows-tests');

test('selection: every engine test file with win32 in its name, plus ALSO, and nothing else', () => {
  const got = selectFiles([
    'win32board.test.js', 'runners.win32-codex.test.js', 'store.test.js', 'store.js',
    'win32board.js', 'status.test.js', 'windows-coupling-audit-1732.test.js',
  ]);
  assert.deepEqual(got, [
    'engine/runners.win32-codex.test.js', 'engine/store.test.js',
    'engine/win32board.test.js', 'engine/windows-coupling-audit-1732.test.js',
  ]);
});

test('selection on the real tree finds the Windows files (a narrowed rule would show here)', () => {
  const names = fs.readdirSync(__dirname);
  const got = selectFiles(names);
  const expectWin32 = names.filter((n) => n.endsWith('.test.js') && n.includes('win32')).length;
  assert.ok(expectWin32 >= 70, `only ${expectWin32} win32 test files; the rule or the tree changed`);
  assert.equal(got.length, expectWin32 + ALSO.filter((n) => names.includes(n)).length);
  for (const n of ALSO) assert.ok(names.includes(n), `ALSO names ${n}, which is not in engine/`);
  assert.ok(got.includes('engine/win32apply.test.js') && got.includes('engine/runners.win32-codex.test.js'));
});

test('verdict: an unlisted red fails, a listed red is known, a listed pass is stale', () => {
  const known = { 'engine/a.test.js': '#1', 'engine/b.test.js': '#2' };
  const v = judge([
    { file: 'engine/a.test.js', ok: false },
    { file: 'engine/b.test.js', ok: true },
    { file: 'engine/c.test.js', ok: false },
    { file: 'engine/d.test.js', ok: true },
  ], known);
  assert.deepEqual(v.failed, ['engine/c.test.js']);
  assert.deepEqual(v.known, [{ file: 'engine/a.test.js', card: '#1' }]);
  assert.deepEqual(v.stale, [{ file: 'engine/b.test.js', card: '#2' }]);
});

test('verdict: a listed file that was not run at all is stale, not silently fine', () => {
  const v = judge([{ file: 'engine/x.test.js', ok: true }], { 'engine/gone.test.js': '#9' });
  assert.deepEqual(v.stale, [{ file: 'engine/gone.test.js', card: '#9', missing: true }]);
  assert.deepEqual(v.failed, []);
});

test('every KNOWN_RED entry names a real selected file and a card', () => {
  const selected = new Set(selectFiles(fs.readdirSync(__dirname)));
  for (const [file, card] of Object.entries(KNOWN_RED)) {
    assert.ok(selected.has(file), `${file} is listed as known red but is not a selected file`);
    assert.match(card, /^#\d+$/, `${file} must name its card as #N`);
  }
});

test('the workflow runs this script on Windows', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'windows.yml'), 'utf8');
  assert.match(wf, /runs-on: windows-latest/);
  assert.match(wf, /node tools\/windows-tests\.js/);
});
