'use strict';
/**
 * #1777 -- run the Windows tests ON WINDOWS.
 *
 * This fleet develops and tests on macOS. The engine carries dozens of test files about its
 * Windows behaviour, and on a Mac they either simulate win32 or skip the arms that need the
 * real thing, so a green suite here says nothing about Windows (#1777's "false green"). The
 * `windows` job in .github/workflows/windows.yml runs this script on a real Windows runner.
 *
 * WHAT IT RUNS: every test file with "win32" in its name, in engine/ and at the repo root,
 * plus the few engine files named in ALSO. One file at a time, stdin closed (a child that reads
 * stdin would otherwise wait for ever), with a per-test timeout so a hang is named as the test
 * that hangs, and an overall budget so the job ends with a verdict rather than being killed.
 * Left out on purpose: securewrite, sendertoken and github tests (POSIX file modes and a fake
 * `gh` script; they describe macOS behaviour, measured red on Windows in #1777).
 *
 * HOW IT JUDGES: a failing file is a failure unless KNOWN_RED lists it, with its card AND the
 * exact tests expected to fail. Any other failing test in a listed file, or a listed file that
 * was killed (a hang), is a failure. A listed test that now PASSES is also a failure, "take it
 * off the list", so the list cannot turn into a permanent excuse or hide what else goes red in
 * the same file. Measured on windows-latest before this was written: see #1777.
 *
 * WHAT A GREEN HERE IS NOT: a GitHub Windows runner is a Windows Server image, run as an
 * admin, with no Kosmos user setup. It is evidence about Windows, not about a user's laptop.
 */

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

// Files without "win32" in their name that still speak about Windows behaviour.
const ALSO = ['platform.test.js', 'store.test.js', 'windows-coupling-audit-1732.test.js', 'runners.win-runnable-2270.test.js'];

// A failing file listed here does not fail the job, as long as exactly the named tests fail
// in it. Every entry names the card that owns it. Names are as node's spec reporter prints them.
const KNOWN_RED = {
  'engine/projects.win32-reveal.test.js': { card: '#4257', tests: [
    'openFile on Windows hands a document to File Explorer as one quoted path, after its own gates',
    'SAFETY 1 through the project route: an agent-written .bat is SHOWN, never run, and the answer says why',
  ] },
  'engine/trust.win32-key-2281.test.js': { card: '#4257', tests: [
    '#2281 the written key carries NO backslash, whatever the host spells',
  ] },
  'engine/win32handoff.test.js': { card: '#4258', tests: [
    '\u{1F6D1} win32-installer-native round 5 findings 1 and 3: the bind host is resolved, and only this machine\'s own addresses are looked on, with their zone',
  ] },
};

const PER_TEST_TIMEOUT_MS = 60000;
// A file's whole run. The slowest file measured on the runner, win32apply, took 431s and 481s
// on two runs; a file past half of this is named in the log, so drift shows before it is a red.
const PER_FILE_TIMEOUT_MS = 900000;
// No file STARTS after this much of the run has gone; the rest are reported as not run (a red).
// The workflow's timeout-minutes is set above this plus one file's cap, so the job always
// finishes with a verdict instead of being cancelled mid-file.
const START_BUDGET_MS = 33 * 60000;

function selectFiles(engineNames, rootNames = []) {
  const isTest = (n) => n.endsWith('.test.js');
  const engine = engineNames.filter((n) => isTest(n) && (n.includes('win32') || ALSO.includes(n))).map((n) => 'engine/' + n);
  const root = rootNames.filter((n) => isTest(n) && n.includes('win32'));
  return [...engine, ...root].sort();
}

// The failing test names in a run's spec-reporter output: "✖ <name> (<n>ms)" lines, minus the
// file-level line node prints for the file itself.
function failingTests(output) {
  const names = new Set();
  for (const line of String(output).split('\n')) {
    const m = line.match(/^\s*✖ (.+) \([\d.]+m?s\)\s*$/);
    if (m && !/\.test\.js$/.test(m[1])) names.add(m[1]);
  }
  return [...names];
}

// results: [{ file, ok, failing: [names], killed, notRun }].
// Returns { failed: [{ file, why }], stale: [...], known: [...] }.
function judge(results, knownRed = KNOWN_RED) {
  const failed = []; const stale = []; const known = [];
  for (const r of results) {
    const entry = knownRed[r.file];
    if (r.notRun) { failed.push({ file: r.file, why: 'not run: the start budget ran out' }); continue; }
    if (r.ok) { if (entry) stale.push({ file: r.file, card: entry.card, why: 'it PASSES now' }); continue; }
    if (!entry) { failed.push({ file: r.file, why: r.killed ? 'killed (a hang or the file cap)' : 'failed' }); continue; }
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
  return { failed, stale, known };
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
    const killed = run.status === null;
    const ms = Date.now() - started;
    const why = run.error ? ` (${run.error.code || run.error.message})`
      : run.signal ? ` (killed by ${run.signal})` : ok ? '' : ` (exit ${run.status})`;
    const tests = count(output, 'tests'); const skipped = count(output, 'skipped');
    const counts = tests === null ? '' : ` [${tests} tests, ${skipped || 0} skipped]`;
    const slow = ms > PER_FILE_TIMEOUT_MS / 2 ? ' SLOW: over half the file cap' : '';
    console.log(`${ok ? 'PASS' : 'FAIL'} ${Math.round(ms / 1000)}s ${file}${why}${counts}${slow}`);
    const failing = ok ? [] : failingTests(output);
    if (!ok) {
      const lines = output.split('\n').filter((l) => /^\s*✖|Error/.test(l));
      for (const l of lines.slice(0, 20)) console.log('    ' + l.trim());
    }
    results.push({ file, ok, failing, killed });
  }
  const { failed, stale, known } = judge(results);
  for (const k of known) console.log(`known red ${k.file} (${k.card})`);
  for (const f of failed) console.log(`NEW RED ${f.file}: ${f.why}. Fix it, or list it in KNOWN_RED in tools/windows-tests.js with its card`);
  for (const s of stale) console.log(`STALE ${s.file} (${s.card}): ${s.why}; update KNOWN_RED`);
  const pass = results.filter((r) => r.ok).length;
  console.log(`windows-tests: ${pass} passed, ${results.length - pass} failed (${known.length} known red), ${failed.length} new red, ${stale.length} stale`);
  return failed.length || stale.length ? 1 : 0;
}

module.exports = { selectFiles, failingTests, judge, ALSO, KNOWN_RED, PER_FILE_TIMEOUT_MS, START_BUDGET_MS };

if (require.main === module) process.exitCode = main();
