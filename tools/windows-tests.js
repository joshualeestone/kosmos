'use strict';
/**
 * #1777 -- run the Windows tests ON WINDOWS.
 *
 * This fleet develops and tests on macOS. The engine carries dozens of test files about its
 * Windows behaviour, and on a Mac they either simulate win32 or skip the arms that need the
 * real thing, so a green suite here says nothing about Windows (#1777's "false green"). The
 * `windows` job in .github/workflows/windows.yml runs this script on a real Windows runner.
 *
 * WHAT IT RUNS: every engine test file with "win32" in its name, plus the few files named in
 * ALSO. One file at a time, stdin closed (a child that reads stdin would otherwise wait for
 * ever), with a per-test timeout so a hang is named as the test that hangs.
 *
 * HOW IT JUDGES: a file that fails is a failure unless KNOWN_RED lists it, with its card. A
 * listed file that now PASSES is also a failure, "take it off the list", so the list cannot
 * turn into a permanent excuse. Measured on windows-latest before this was written: see #1777.
 *
 * WHAT A GREEN HERE IS NOT: a GitHub Windows runner is a Windows Server image, run as an
 * admin, with no Kosmos user setup. It is evidence about Windows, not about a user's laptop.
 */

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

// Files without "win32" in their name that still speak about Windows behaviour.
const ALSO = ['platform.test.js', 'store.test.js', 'windows-coupling-audit-1732.test.js'];

// A failing file listed here does not fail the job. Every entry names the card that owns it.
const KNOWN_RED = {
  'engine/projects.win32-reveal.test.js': '#4257',
  'engine/trust.win32-key-2281.test.js': '#4257',
};

const PER_TEST_TIMEOUT_MS = 60000;
// A file's whole run. The slowest file measured on the runner, win32apply, took 431s.
const PER_FILE_TIMEOUT_MS = 900000;

function selectFiles(names) {
  return names
    .filter((n) => n.endsWith('.test.js') && (n.includes('win32') || ALSO.includes(n)))
    .sort()
    .map((n) => 'engine/' + n);
}

// results: [{ file, ok }]. Returns { failed: [...], stale: [...], known: [...] }.
function judge(results, knownRed = KNOWN_RED) {
  const failed = []; const stale = []; const known = [];
  for (const { file, ok } of results) {
    const card = knownRed[file];
    if (!ok && card) known.push({ file, card });
    else if (!ok) failed.push(file);
    else if (card) stale.push({ file, card });
  }
  const ran = new Set(results.map((r) => r.file));
  for (const [file, card] of Object.entries(knownRed)) {
    if (!ran.has(file)) stale.push({ file, card, missing: true });
  }
  return { failed, stale, known };
}

function main() {
  const root = path.join(__dirname, '..');
  const files = selectFiles(fs.readdirSync(path.join(root, 'engine')));
  console.log(`windows-tests: ${files.length} files, node ${process.version}, ${process.platform}`);
  // A selection that finds nothing would pass having run nothing.
  if (files.length === 0) { console.log('windows-tests: no test files selected; refusing to report green'); return 1; }
  const results = [];
  for (const file of files) {
    const started = Date.now();
    const run = cp.spawnSync(process.execPath, ['--test', `--test-timeout=${PER_TEST_TIMEOUT_MS}`, file], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: PER_FILE_TIMEOUT_MS, encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const ok = run.status === 0;
    const secs = Math.round((Date.now() - started) / 1000);
    const why = run.error ? ` (${run.error.code || run.error.message})` : run.status === 0 ? '' : ` (exit ${run.status})`;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${secs}s ${file}${why}`);
    if (!ok) {
      const lines = `${run.stdout || ''}\n${run.stderr || ''}`.split('\n').filter((l) => /^\s*✖|Error/.test(l));
      for (const l of lines.slice(0, 20)) console.log('    ' + l.trim());
    }
    results.push({ file, ok });
  }
  const { failed, stale, known } = judge(results);
  for (const k of known) console.log(`known red ${k.file} (${k.card})`);
  for (const f of failed) console.log(`NEW RED ${f}: fix it, or list it in KNOWN_RED in tools/windows-tests.js with its card`);
  for (const s of stale) {
    console.log(s.missing
      ? `STALE ${s.file} (${s.card}): listed as known red but not run; remove it from KNOWN_RED`
      : `STALE ${s.file} (${s.card}): listed as known red but it PASSES now; remove it from KNOWN_RED`);
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`windows-tests: ${pass} passed, ${results.length - pass} failed (${known.length} known red), ${failed.length} new red, ${stale.length} stale`);
  return failed.length || stale.length ? 1 : 0;
}

module.exports = { selectFiles, judge, ALSO, KNOWN_RED };

if (require.main === module) process.exitCode = main();
