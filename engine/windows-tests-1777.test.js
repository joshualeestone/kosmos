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
    ['web.win32-update-offer.test.js', 'web.status.test.js', 'win32notes.md', 'store.test.js',
      'tools.windows-kosmos-cli-570.test.js', 'tools.win-open-board-2007.test.js', 'tools.build-windows-570.test.js', 'tools.winding.test.js'],
  );
  assert.deepEqual(got, [
    'engine/runners.win32-codex.test.js', 'engine/store.test.js', 'engine/win32board.test.js',
    'tools.win-open-board-2007.test.js', 'tools.windows-kosmos-cli-570.test.js', 'web.win32-update-offer.test.js',
  ]);
});

test('selection on the real tree: named files are in, and the count has not shrunk', () => {
  const got = w.selectFiles(fs.readdirSync(__dirname), fs.readdirSync(ROOT));
  // 99 when this was written (#1777). A narrowed rule or a mass rename shows here; a new file
  // raises the count and needs nothing. A single file renamed out of the rule does not; the
  // host-branch test below catches the ones that matter.
  assert.ok(got.length >= 99, `only ${got.length} files selected`);
  for (const f of [
    'engine/win32apply.test.js', 'engine/runners.win32-codex.test.js', 'engine/win32board.test.js',
    'engine/runners.win-runnable-2270.test.js', 'engine/windows-coupling-audit-1732.test.js',
    'engine.connect-win32-install-570.test.js', 'web.win32-update-offer.test.js',
    'tools.windows-kosmos-cli-570.test.js', 'tools.win-installer-native.test.js',
  ]) assert.ok(got.includes(f), `${f} is not selected`);
  for (const n of w.ALSO) assert.ok(fs.existsSync(path.join(__dirname, n)), `ALSO names ${n}, which is not in engine/`);
  for (const n of w.ALSO_ROOT) assert.ok(got.includes(n), `ALSO_ROOT names ${n}, which is not selected`);
});

test('every test file that branches on a win32 HOST is run on Windows or excluded with a reason', () => {
  const selected = new Set(w.selectFiles(fs.readdirSync(__dirname), fs.readdirSync(ROOT)));
  const all = [
    ...fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).map((n) => 'engine/' + n),
    ...fs.readdirSync(ROOT).filter((n) => n.endsWith('.test.js')),
  ];
  // Two ways a test says "this host is Windows": comparing process.platform with 'win32', or
  // testing for the flag Windows lacks (O_NOFOLLOW is undefined there; #1761). Other indirect
  // signals (a hardcoded POSIX path, path.sep) are not caught; the plan names that limit.
  const hostBranch = /process\.platform\s*[!=]==?\s*['"]win32['"]|['"]win32['"]\s*[!=]==?\s*process\.platform|O_NOFOLLOW\s*[!=]==?\s*undefined/;
  const loose = all.filter((f) => !selected.has(f) && !w.HOST_BRANCH_EXCLUDED[f]
    && hostBranch.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(loose, [], 'these branch on a win32 host and nothing runs them on Windows: add each to ALSO, or to HOST_BRANCH_EXCLUDED with why');
  for (const [f, why] of Object.entries(w.HOST_BRANCH_EXCLUDED)) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `HOST_BRANCH_EXCLUDED names ${f}, which does not exist`);
    assert.ok(!selected.has(f), `${f} is both selected and excluded`);
    assert.ok(why.length > 10, `${f} needs a reason`);
  }
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

test('#4301: failure detail is node\'s failing-tests section, so a test timeout shows its reason', () => {
  const out = [
    '✔ fine (1.2ms)',
    '✖ slow one (30012ms)',
    '✖ failing tests:',
    '',
    'test at engine\\win32apply.test.js:2331:1',
    '✖ slow one (30012ms)',
    '  \'test timed out after 30000ms\'',
    '    at async Test.run (node:internal/test_runner/test:1402:25)',
    '    at new Promise (<anonymous>)',
    '    at async Promise.all (index 0)',
    'test at engine\\win32apply.test.js:2990:1',
    '✖ other (1ms)',
    '  AssertionError [ERR_ASSERTION]: nope',
  ].join('\r\n');
  const got = w.failureDetail(out);
  assert.ok(got.some((l) => /test timed out after 30000ms/.test(l)), 'the timeout reason is shown: ' + JSON.stringify(got));
  assert.ok(got.some((l) => /AssertionError: nope|AssertionError \[ERR_ASSERTION\]: nope/.test(l)));
  assert.ok(!got.some((l) => /^\s+at /.test(l)), 'stack frames are dropped');
  assert.ok(!got.some((l) => /fine/.test(l)), 'passing tests are not repeated');
  assert.equal(got.filter((l) => /^\s*test at /.test(l)).length, 2, 'both failing tests are shown (the slot count is pinned by the twelve-entry case below)');
  const crashed = w.failureDetail('boot\nTypeError: x is not a function\n    at foo');
  assert.ok(crashed.some((l) => /TypeError: x is not a function/.test(l)), 'a crash with no section shows its tail');
});

test('#4301: detail is capped per failing test, says what it left out, and puts unexpected reds first', () => {
  const entry = (name, n) => ['test at engine\\x.test.js:1:1', '✖ ' + name + ' (5ms)', ...Array.from({ length: n }, (_, i) => '  diff line ' + i)];
  const out = ['✖ failing tests:', ...entry('known one', 40), ...entry('new one', 3), '  at least 3 agents'].join('\n');
  const got = w.failureDetail(out, ['known one']);
  const newAt = got.findIndex((l) => /new one/.test(l)); const knownAt = got.findIndex((l) => /known one/.test(l));
  assert.ok(newAt >= 0 && knownAt > newAt, 'the unexpected red comes first: ' + JSON.stringify(got.slice(0, 6)));
  assert.ok(got.includes('  at least 3 agents'), 'a message line starting "at" is not taken for a stack frame');
  assert.ok(got.some((l) => /more line\(s\) of this test's detail not shown/.test(l)), 'a long entry says it was cut');
  assert.ok(got.filter((l) => /diff line/.test(l)).length < 40, 'the long entry is capped');
  const many = ['✖ failing tests:', '', ...Array.from({ length: 12 }, (_, i) => entry('t' + i, 1)).flat()].join('\n');
  const manyGot = w.failureDetail(many);
  assert.ok(manyGot.some((l) => /2 more failing test\(s\) not shown/.test(l)));
  assert.equal(manyGot.filter((l) => /^\s*test at /.test(l)).length, 10, 'ten entries shown; a leading blank line takes no slot');
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
  assert.equal(w.judge([{ file: 'engine/a.test.js', ok: true, tests: 2, skipped: 0 }], KNOWN).stale.length, 1);
  assert.match(w.judge([{ file: 'engine/b.test.js', ok: true, tests: 1, skipped: 0 }], KNOWN).stale[0].why, /not run/);
});

test('verdict: a file whose every test skipped is a new red unless ALL_SKIP_OK names it', () => {
  const allSkipped = { file: 'engine/e.test.js', ok: true, tests: 3, skipped: 3 };
  assert.match(w.judge([allSkipped], {}, {}).failed[0].why, /every one of its 3 tests skipped/);
  assert.deepEqual(w.judge([allSkipped], {}, { 'engine/e.test.js': 'needs a login' }).failed, []);
  assert.deepEqual(w.judge([{ ...allSkipped, skipped: 2 }], {}, {}).failed, [], 'a partial skip is counted, not judged');
  const runsNow = w.judge([{ ...allSkipped, skipped: 1 }], {}, { 'engine/e.test.js': 'needs a login' });
  assert.equal(runsNow.stale.length, 1, 'an ALL_SKIP_OK file whose tests run now is stale');
});

test('verdict: a pass whose test count could not be read is a new red, not a silent pass', () => {
  const v = w.judge([{ file: 'engine/z.test.js', ok: true, tests: null, skipped: 0 }], {}, {}, {});
  assert.match(v.failed[0].why, /test count could not be read/);
  assert.deepEqual(w.judge([{ file: 'engine/z.test.js', ok: true, tests: 4, skipped: 0 }], {}, {}, {}).failed, []);
});

test('verdict: a listed file that could not be run is a new red naming the error', () => {
  const v = w.judge([{ file: 'engine/a.test.js', ok: false, failing: ['t1', 't2'], error: 'ENOBUFS' }], KNOWN);
  assert.match(v.failed[0].why, /ENOBUFS/);
  assert.deepEqual(v.known, []);
});

test('a stale entry blocks main always, and a PR only when it touches that file or the script', () => {
  const st = { file: 'engine/a.test.js' };
  assert.equal(w.staleBlocks(st, null), true, 'main (no PR diff) is strict');
  assert.equal(w.staleBlocks(st, ['server.js']), false, 'someone else\'s PR is not failed for it');
  assert.equal(w.staleBlocks(st, ['engine/a.test.js']), true);
  assert.equal(w.staleBlocks(st, ['tools/windows-tests.js']), true);
});

test('FLAKY: a listed flaky test failing is not judged, and a file failing only on it is a pass', () => {
  const flaky = { 'engine/f.test.js': { card: '#7', tests: ['timing'] } };
  const onlyFlaky = w.judge([{ file: 'engine/f.test.js', ok: false, failing: ['timing'] }], {}, {}, flaky);
  assert.deepEqual(onlyFlaky.failed, []); assert.deepEqual(onlyFlaky.stale, []);
  const more = w.judge([{ file: 'engine/f.test.js', ok: false, failing: ['timing', 'real'] }], {}, {}, flaky);
  assert.equal(more.failed.length, 1, 'a real failure beside the flaky one is still a new red');
  const killed = w.judge([{ file: 'engine/f.test.js', ok: false, failing: ['timing'], killed: true }], {}, {}, flaky);
  assert.equal(killed.failed.length, 1, 'a kill is never excused as flaky');
  const withKnown = w.judge([{ file: 'engine/a.test.js', ok: false, failing: ['t1', 't2', 'timing'] }], KNOWN, {},
    { 'engine/a.test.js': { card: '#7', tests: ['timing'] } });
  assert.deepEqual(withKnown.failed, []); assert.equal(withKnown.known.length, 1);
});

test('every FLAKY entry names a selected file, a card and tests in that file', () => {
  const selected = new Set(w.selectFiles(fs.readdirSync(__dirname), fs.readdirSync(ROOT)));
  for (const [file, entry] of Object.entries(w.FLAKY)) {
    assert.ok(selected.has(file), `${file} is FLAKY but not selected`);
    assert.match(entry.card, /^#\d+$/);
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const name of entry.tests) assert.ok(src.includes(name) || src.includes(name.replace(/'/g, "\\'")), `${file} has no test named "${name}"`);
  }
});

test('every ALL_SKIP_OK entry is a selected file with a reason', () => {
  const selected = new Set(w.selectFiles(fs.readdirSync(__dirname), fs.readdirSync(ROOT)));
  for (const [f, why] of Object.entries(w.ALL_SKIP_OK)) {
    assert.ok(selected.has(f), `${f} is in ALL_SKIP_OK but not selected`);
    assert.ok(why.length > 10, `${f} needs a reason`);
  }
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
  assert.match(wf, /WINDOWS_TESTS_PR_BASE: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(wf, /fetch-depth: 0/, 'the PR diff needs the base commit');
  const minutes = Number(wf.match(/timeout-minutes: (\d+)/)[1]);
  // timeout-minutes also covers checkout (full history) and setup-node, before the script's clock
  // starts; 5 minutes is allowed for them.
  const SETUP_ALLOWANCE_MS = 5 * 60000;
  assert.ok(minutes * 60000 >= w.START_BUDGET_MS + w.PER_FILE_TIMEOUT_MS + SETUP_ALLOWANCE_MS,
    'the job could be cancelled mid-file before the script prints its verdict');
});
