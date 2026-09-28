'use strict';
/**
 * #1777 -- run the Windows tests ON WINDOWS.
 *
 * This fleet develops and tests on macOS. The engine carries dozens of test files about its
 * Windows behaviour, and on a Mac they either simulate win32 or skip the arms that need the
 * real thing, so a green suite here says nothing about Windows (#1777's "false green"). The
 * `windows` job in .github/workflows/windows.yml runs this script on a real Windows runner.
 *
 * WHAT IT RUNS: every test file with "win32" in its name, in engine/ and at the repo root, the
 * root's tools.win-* / tools.windows-* files, plus the few engine files named in ALSO. One file at a time, stdin closed (a child that reads
 * stdin would otherwise wait for ever), with a per-test timeout so a hang is named as the test
 * that hangs, and an overall budget so the job ends with a verdict rather than being killed.
 * Left out on purpose: securewrite, sendertoken and github tests (POSIX file modes and a fake
 * `gh` script; they describe macOS behaviour, measured red on Windows in #1777), and
 * tools.build-windows / tools.publish-windows (Mac-side release tooling that builds the Windows
 * bundle; it never runs on Windows).
 *
 * FLAKY: a few tests' results depend on the runner's own network or timing; FLAKY names them,
 * and they are not judged either way. A kill or crash is never excused as flaky.
 *
 * SKIPS: a selected file whose EVERY test skips is a failure unless ALL_SKIP_OK names it, since
 * this job is the only place its arms run. A file that skips SOME of its tests is counted in the
 * log, not judged.
 *
 * HOW IT JUDGES: a failing file is a failure unless KNOWN_RED lists it, with its card AND the
 * exact tests expected to fail. Any other failing test in a listed file, or a listed file that
 * was killed (a hang), is a failure. A listed test that now PASSES is also a failure, "take it
 * off the list", so the list cannot turn into a permanent excuse or hide what else goes red in
 * the same file. A stale entry fails every run on main, and a PR's run only when the PR touches
 * that file or this script (staleBlocks). Measured on windows-latest before this was written: see
 * #1777.
 *
 * WHAT A GREEN HERE IS NOT: a GitHub Windows runner is a Windows Server image, run as an
 * admin, with no Kosmos user setup. It is evidence about Windows, not about a user's laptop.
 */

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

// Files without "win32" in their name that still speak about Windows behaviour. The engine ones
// are named bare; root ones carry no prefix. Every test file that branches on a win32 HOST must
// be selected here or excluded in HOST_BRANCH_EXCLUDED, or the Mac-side test goes red (#1777).
const ALSO = ['platform.test.js', 'store.test.js', 'windows-coupling-audit-1732.test.js', 'runners.win-runnable-2270.test.js',
  'outbox.test.js', 'remove.test.js', 'world-guard-lift-1704.test.js'];
const ALSO_ROOT = ['cli.world-outbox-1704.test.js', 'engine.boardauth-1946.test.js'];

// Test files that branch on a win32 host but are not run on Windows, each with why.
const HOST_BRANCH_EXCLUDED = {
  'engine/create.test.js': 'measured on windows-latest: 121 of 189 fail because they need Claude Code installed or macOS LaunchAgents (#4269); the Windows create path is the create.win32-* files, which pass',
  'engine/agentbrowser.test.js': 'its win32 branch only skips a read-only-folder arm; the file describes macOS',
  'engine/geminisettings.test.js': 'its win32 branch only skips a POSIX file-mode arm',
  'engine/groksettings.test.js': 'its win32 branch only skips a POSIX file-mode arm',
  'engine/securewrite.test.js': 'POSIX file-mode assertions, measured red on Windows (#1777)',
  'engine/sendertoken.test.js': 'POSIX file-mode assertions, measured red on Windows (#1777)',
};

// Selected files whose every test may skip on the runner, each with why. Any OTHER selected file
// that runs and skips all of its tests is a red: this job is the only place those arms run.
const ALL_SKIP_OK = {
  'engine/win32agyreply.e2e.test.js': 'needs a signed-in Antigravity; the runner has none',
  'engine/win32agysignin.e2e.test.js': 'needs Antigravity installed; the runner has none',
  'engine/win32codexreply.e2e.test.js': 'needs a signed-in Codex; the runner has none',
  'engine/win32codexsup.integration.test.js': 'needs a real Codex binary; the runner has none',
};

// A failing file listed here does not fail the job, as long as exactly the named tests fail
// in it. Every entry names the card that owns it. Names are as node's spec reporter prints them;
// a failing SUBTEST also marks its parent failing, so list the parent's name as well.
const KNOWN_RED = {
  'engine/remove.test.js': { card: '#4269', tests: [
    'a creation that did not record drops a stale record for its name (#169)',
  ] },
  'engine/projects.win32-reveal.test.js': { card: '#4257', tests: [
    'openFile on Windows hands a document to File Explorer as one quoted path, after its own gates',
    'SAFETY 1 through the project route: an agent-written .bat is SHOWN, never run, and the answer says why',
  ] },
  'engine/trust.win32-key-2281.test.js': { card: '#4257', tests: [
    '#2281 the written key carries NO backslash, whatever the host spells',
  ] },
  'tools.win-installer-native.test.js': { card: '#4266', tests: [
    'W-20 probe: the shortcut is written into a temp Start Menu, points where it should, follows a new folder, and is removed',
    '\u{1F6D1} finding 4 probe: a stale or same-build copy in Downloads hands off to the installed Kosmos and re-points NOTHING',
    '\u{1F6D1} #3286 probe: a NEWER copy updates the installed Kosmos through the updater and starts it, so there is only ever one install',
    '\u{1F6D1} #3286 review probe: SAME is an update that finished; a board the replace ended always runs again; a copy Kosmos was not pointed at is not installed',
    '\u{1F6D1} round 2 finding 4 probe: an old copy in a folder that is NOT cleaned up hands off and re-points nothing; with nothing installed it runs where it is',
    '\u{1F6D1} #3286 probe: from a cleaned-up place with nothing installed, Kosmos installs itself WITHOUT asking and starts the installed copy; a refusal is a plain note',
    '\u{1F6D1} round 3 finding 6 probe: the installed copy hands off to a newer copy the pointer names and re-points nothing; otherwise it runs and re-points, never handing off to itself or to nothing',
    '\u{1F6D1} uninstall probe: a clean removal takes the shortcut, the Apps entry and the kept-here memory; anything left keeps all three',
  ] },
  'tools.win-open-board-2007.test.js': { card: '#4267', tests: [
    'openInBrowser hands the resolved url to the opener (KOSMOS_OPEN_BIN seam)',
    'main() end-to-end: stdout is the PLAIN url, the opener gets the NONCED url',
  ] },
  'tools.windows-kosmos-shims-570.test.js': { card: '#4267', tests: [
    'PowerShell: a bare `kosmos` is kosmos.ps1, and a multi-line, quoted, &-laden answer arrives exactly',
  ] },
  'engine/win32handoff.test.js': { card: '#4258', tests: [
    '\u{1F6D1} win32-installer-native round 5 findings 1 and 3: the bind host is resolved, and only this machine\'s own addresses are looked on, with their zone',
  ] },
};

// Tests whose result on the runner depends on the runner's own network or timing: they may pass
// or fail, and neither is judged. Each names its card. Keep this short; a test here is not run
// in any sense that counts.
const FLAKY = {
  'engine/win32handoff.test.js': { card: '#4258', tests: [
    '\u{1F6D1} win32-installer-native round 6 finding 1: the launcher\'s hand-off probe is unchanged: one 2 s limit for the connect and the answer (#2983)',
  ] },
};

const PER_TEST_TIMEOUT_MS = 60000;
// A file's whole run. The slowest file measured on the runner, win32apply, took 413s to 481s
// over five runs; a file past half of this is named in the log, so drift shows before it is a red.
const PER_FILE_TIMEOUT_MS = 1200000;
// No file STARTS after this much of the run has gone; the rest are reported as not run (a red).
// The workflow's timeout-minutes is set above this plus one file's cap, so the job always
// finishes with a verdict instead of being cancelled mid-file.
const START_BUDGET_MS = 33 * 60000;

function selectFiles(engineNames, rootNames = []) {
  const isTest = (n) => n.endsWith('.test.js');
  const engine = engineNames.filter((n) => isTest(n) && (n.includes('win32') || ALSO.includes(n))).map((n) => 'engine/' + n);
  // At the root, the Windows-side tools' tests are named tools.win-* / tools.windows-* (the
  // `kosmos` command a Windows agent runs, the native installer and launcher, the shims).
  const root = rootNames.filter((n) => isTest(n) && (n.includes('win32') || /^tools\.win(dows)?-/.test(n) || ALSO_ROOT.includes(n)));
  return [...engine, ...root].sort();
}

// The failing test names in a run's spec-reporter output: "✖ <name> (<n>ms)" lines, minus the
// file-level line node prints for the file itself (its path, with either separator). Only that
// exact line is dropped, so a real test whose title ends in ".test.js" still counts.
function failingTests(output, file = '') {
  const self = file.replace(/\\/g, '/');
  const names = new Set();
  for (const line of String(output).split('\n')) {
    const m = line.match(/^\s*✖ (.+) \([\d.]+m?s\)\s*$/);
    if (m && !(self && m[1].replace(/\\/g, '/') === self)) names.add(m[1]);
  }
  return [...names];
}

// results: [{ file, ok, failing: [names], killed, notRun, error, tests, skipped }].
// Returns { failed: [{ file, why }], stale: [...], known: [...] }.
function judge(results, knownRed = KNOWN_RED, allSkipOk = ALL_SKIP_OK, flaky = FLAKY) {
  const failed = []; const stale = []; const known = [];
  for (const raw of results) {
    // A FLAKY test's failure is dropped before judging; a file failing only those counts as a pass.
    const skipNames = (flaky[raw.file] && flaky[raw.file].tests) || [];
    const kept = (raw.failing || []).filter((n) => !skipNames.includes(n));
    const onlyFlaky = !raw.ok && !raw.killed && !raw.error && !raw.notRun && (raw.failing || []).length > 0 && kept.length === 0;
    const r = onlyFlaky ? { ...raw, ok: true, failing: [] } : { ...raw, failing: kept };
    const entry = knownRed[r.file];
    if (r.notRun) { failed.push({ file: r.file, why: 'not run: the start budget ran out' }); continue; }
    if (r.ok && r.tests > 0 && r.skipped === r.tests && !allSkipOk[r.file]) {
      failed.push({ file: r.file, why: `every one of its ${r.tests} tests skipped on Windows; list it in ALL_SKIP_OK with why, or let its arms run` });
      continue;
    }
    if (r.ok) { if (entry) stale.push({ file: r.file, card: entry.card, why: 'it PASSES now' }); continue; }
    if (entry && r.error) { failed.push({ file: r.file, why: `could not run (${r.error}), which ${entry.card} does not cover` }); continue; }
    if (!entry) { failed.push({ file: r.file, why: r.killed ? 'killed (a hang or the file cap)' : r.error ? `could not run (${r.error})` : 'failed' }); continue; }
    if (r.killed) { failed.push({ file: r.file, why: `killed (a hang or the file cap), which ${entry.card} does not cover` }); continue; }
    const unexpected = (r.failing || []).filter((n) => !entry.tests.includes(n));
    if (unexpected.length || !(r.failing || []).length) {
      failed.push({ file: r.file, why: unexpected.length
        ? `failing beyond ${entry.card}: ${unexpected.join(' | ')}`
        : `failed with no failing test named, which ${entry.card} does not cover` });
      continue;
    }
    const nowPass = entry.tests.filter((n) => !r.failing.includes(n));
    if (nowPass.length) stale.push({ file: r.file, card: entry.card, why: `these pass now: ${nowPass.join(' | ')}` });
    known.push({ file: r.file, card: entry.card });
  }
  const seen = new Set(results.map((r) => r.file));
  for (const [file, entry] of Object.entries(knownRed)) {
    if (!seen.has(file)) stale.push({ file, card: entry.card, why: 'not run' });
  }
  for (const [file] of Object.entries(allSkipOk)) {
    const r = results.find((x) => x.file === file);
    if (r && r.ok && r.tests > 0 && r.skipped < r.tests) stale.push({ file, card: 'ALL_SKIP_OK', why: 'its tests run now' });
  }
  return { failed, stale, known };
}

// A stale entry fails main's run always. On a PR it fails only when the PR touches that test
// file or this script, so a fix landing on main does not turn every other open PR red; main's
// own run then names the entry to drop. changed === null means "not a PR, or the diff could not
// be read": strict.
function staleBlocks(entry, changed) {
  if (changed === null) return true;
  return changed.includes(entry.file) || changed.includes('tools/windows-tests.js');
}

function changedFiles(root) {
  const base = process.env.WINDOWS_TESTS_PR_BASE;
  if (!base) return null;
  const r = cp.spawnSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function count(output, label) {
  const m = String(output).match(new RegExp('^ℹ ' + label + ' (\\d+)$', 'm'));
  return m ? Number(m[1]) : null;
}

function main() {
  const root = path.join(__dirname, '..');
  const files = selectFiles(fs.readdirSync(path.join(root, 'engine')), fs.readdirSync(root));
  console.log(`windows-tests: ${files.length} files, node ${process.version}, ${process.platform}`);
  // A selection that finds nothing would pass having run nothing.
  if (files.length === 0) { console.log('windows-tests: no test files selected; refusing to report green'); return 1; }
  const began = Date.now();
  const results = [];
  for (const file of files) {
    if (Date.now() - began > START_BUDGET_MS) { console.log(`NOT RUN ${file}`); results.push({ file, ok: false, notRun: true }); continue; }
    const started = Date.now();
    // On a timeout spawnSync kills this `node --test` process only; the child it runs the file in
    // can outlive it on Windows. A hang is rare enough that the next files sharing the runner with
    // an orphan is accepted, and the hang itself is still reported red.
    const run = cp.spawnSync(process.execPath, ['--test', `--test-timeout=${PER_TEST_TIMEOUT_MS}`, file], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: PER_FILE_TIMEOUT_MS, encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${run.stdout || ''}\n${run.stderr || ''}`;
    const ok = run.status === 0;
    // status is null for a kill (timeout or signal) and also for a spawn error or maxBuffer
    // overflow, which carry run.error; only the first is a hang.
    const killed = run.status === null && !(run.error && run.error.code !== 'ETIMEDOUT');
    const ms = Date.now() - started;
    const why = run.error ? ` (${run.error.code || run.error.message})`
      : run.signal ? ` (killed by ${run.signal})` : ok ? '' : ` (exit ${run.status})`;
    const tests = count(output, 'tests'); const skipped = count(output, 'skipped');
    const counts = tests === null ? '' : ` [${tests} tests, ${skipped || 0} skipped]`;
    const slow = ms > PER_FILE_TIMEOUT_MS / 2 ? ' SLOW: over half the file cap' : '';
    console.log(`${ok ? 'PASS' : 'FAIL'} ${Math.round(ms / 1000)}s ${file}${why}${counts}${slow}`);
    const failing = ok ? [] : failingTests(output, file);
    if (!ok) {
      // Every failing name (a KNOWN_RED entry is copied from these), then the first errors.
      for (const n of failing) console.log('    ✖ ' + n);
      const errors = output.split('\n').filter((l) => /Error/.test(l));
      for (const l of errors.slice(0, 20)) console.log('    ' + l.trim());
    }
    results.push({ file, ok, failing, killed, tests, skipped: skipped || 0,
      error: !killed && run.error ? (run.error.code || run.error.message) : undefined });
  }
  const { failed, stale, known } = judge(results);
  for (const k of known) console.log(`known red ${k.file} (${k.card})`);
  for (const f of failed) console.log(`NEW RED ${f.file}: ${f.why}. Fix it, or list it in KNOWN_RED in tools/windows-tests.js with its card`);
  const changed = changedFiles(root);
  let blocking = 0;
  for (const st of stale) {
    const blocks = staleBlocks(st, changed);
    if (blocks) blocking += 1;
    console.log(`STALE ${st.file} (${st.card}): ${st.why}; update ${st.card === 'ALL_SKIP_OK' ? 'ALL_SKIP_OK' : 'KNOWN_RED'}`
      + (blocks ? '' : ' (not this PR\'s change, so not failing it; main\'s run will)'));
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`windows-tests: ${pass} passed, ${results.length - pass} failed (${known.length} known red), ${failed.length} new red, ${stale.length} stale (${blocking} blocking)`);
  return failed.length || blocking ? 1 : 0;
}

module.exports = { selectFiles, failingTests, judge, staleBlocks, FLAKY, ALSO, ALSO_ROOT, HOST_BRANCH_EXCLUDED, ALL_SKIP_OK, KNOWN_RED, PER_FILE_TIMEOUT_MS, START_BUDGET_MS };

if (require.main === module) process.exitCode = main();
