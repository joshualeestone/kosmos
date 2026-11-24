'use strict';
/* kosmos#8993: ios.yml builds the sample-board app once (job `uibuild`) and its three UI jobs test those products
   (ui-sample.sh --products) instead of each building the same app. Source pins on the workflow, so a later edit cannot
   quietly drop the sharing (and the macOS minutes come back) or point a job at products nobody uploads; pins that the
   two ways ui-sample.sh runs the tests (built here, or the shared products) pass exactly the same test arguments; and
   ui-sample.sh's new arguments, checked where they refuse before any Xcode work. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const YML = fs.readFileSync(path.join(__dirname, '.github', 'workflows', 'ios.yml'), 'utf8');
const SAMPLE = path.join(__dirname, 'ios', 'tools', 'ui-sample.sh');
const SH = fs.readFileSync(SAMPLE, 'utf8');

// The text of one top-level job, from its "  name:" line to the next job at the same indent.
function job(name) {
  const lines = YML.split('\n');
  const at = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(at >= 0, `premise: ios.yml has a job ${name}`);
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i += 1) if (/^ {2}[a-z][a-z0-9_-]*:\s*$/.test(lines[i])) { end = i; break; }
  return lines.slice(at, end).join('\n');
}

test('uibuild builds once, checks it built, and uploads the products as one tar (an artifact drops file modes)', () => {
  const b = job('uibuild');
  assert.match(b, /ios\/tools\/ui-sample\.sh --build-only "\$RUNNER_TEMP\/ui-products"/);
  assert.match(b, /grep -q '\^PASS {2}ui-sample build:'/, 'a build that printed no PASS line is red');
  assert.match(b, /tar -C "\$RUNNER_TEMP\/ui-products" -cf "\$RUNNER_TEMP\/ui-products\.tar" \./);
  assert.match(b, /actions\/upload-artifact@v4/);
  assert.match(b, /name: ui-products\n/, 'one name per run, so "Re-run failed jobs" finds it');
  assert.match(b, /path: \$\{\{ runner\.temp \}\}\/ui-products\.tar/);
  assert.match(b, /overwrite: true/, '"Re-run all jobs" replaces it');
  assert.match(b, /if-no-files-found: error/, 'an empty upload is red, never a silent nothing');
});

test('every UI job needs uibuild, downloads that artifact (tolerating its absence), unpacks it, and tests it', () => {
  for (const name of ['ui', 'uikit']) {
    const j = job(name);
    assert.match(j, /\n {4}needs: uibuild\n/, `${name} waits for the build`);
    assert.match(j, /actions\/download-artifact@v4\n {8}continue-on-error: true\n {8}with:\n {10}name: ui-products\n/,
      `${name} downloads the artifact uibuild uploads, and a missing one falls back to building, not to a red`);
    assert.match(j, /tar -C "\$RUNNER_TEMP\/ui-products" -xf "\$RUNNER_TEMP\/ui-products-tar\/ui-products\.tar"/, `${name} unpacks it`);
    assert.match(j, /ui-sample\.sh[^\n]* --products "\$RUNNER_TEMP\/ui-products"/, `${name} tests the shared products`);
  }
  assert.match(job('uikit'), /--uikit --shard "\$\{\{ matrix\.shard \}\}" --products/, 'both UIKit halves keep their shard');
});

test('CONTROL: the job reader can fail (a job that does not exist)', () => {
  assert.throws(() => job('no-such-job'));
});

/* The two xcodebuild lines: the arguments after the verb and its app source, through the result bundle. */
function testRuns() {
  const lines = SH.split('\n');
  const grab = (re) => {
    const at = lines.findIndex((l) => re.test(l));
    assert.ok(at >= 0, `premise: ui-sample.sh has ${re}`);
    return (lines[at] + ' ' + lines[at + 1]).replace(/\s+/g, ' ');
  };
  return { shared: grab(/xcodebuild test-without-building -xctestrun/), built: grab(/xcodebuild test -project Kosmos\.xcodeproj/) };
}
const VARS = /TEST_RUNNER_KOSMOS_UI_PLUS=1 TEST_RUNNER_KOSMOS_UI_SAMPLE=1 TEST_RUNNER_KOSMOS_UIKITLIST="\$uikit"/;
const TAIL = /-destination "id=\$udid" \\? ?-retry-tests-on-failure -test-iterations 2 \$only \$skip \$allow (?:-derivedDataPath "\$work\/dd" )?-resultBundlePath "\$work\/result\.xcresult"/;

test('the shared-products run passes exactly the test arguments a built run does (CI now always takes it)', () => {
  const { shared, built } = testRuns();
  for (const [name, line] of [['shared', shared], ['built', built]]) {
    assert.match(line, VARS, `${name}: the three test-runner variables`);
    assert.match(line, TAIL, `${name}: the retry, the classes, the skips, the time limits and the result bundle`);
  }
  // CONTROL: the same check refuses a line missing one argument.
  assert.doesNotMatch(shared.replace(' $skip', ''), TAIL);
  assert.doesNotMatch(shared.replace('TEST_RUNNER_KOSMOS_UIKITLIST="$uikit"', ''), VARS);
});

test('a failure note reads the app from wherever it was tested, never only from a folder the shared run never made', () => {
  const finds = SH.split('\n').filter((l) => /find "[^"]*" -maxdepth 2 -name Kosmos\.app/.test(l));
  assert.ok(finds.length >= 3, 'premise: the failure notes look the app up');
  for (const l of finds) assert.match(l, /find "\$appdir"/, l.trim());
  assert.match(SH, /if \[ -n "\$run_file" \]; then appdir="\$\(dirname "\$run_file"\)"; else appdir="\$work\/dd\/Build\/Products"; fi/);
});

test('ui-sample.sh refuses bad --build-only and --products uses before any Xcode work', () => {
  const run = (...args) => spawnSync('bash', [SAMPLE, ...args], { encoding: 'utf8', timeout: 20000 });
  const full = fs.mkdtempSync(path.join(os.tmpdir(), 'uibuild-8993-'));
  fs.writeFileSync(path.join(full, 'something-else'), 'x');
  try {
    for (const [args, said] of [
      [['--build-only'], /--build-only takes a folder/],
      [['--products'], /--products takes a folder/],
      [['--uikit', '--build-only', '/nonexistent/x'], /--build-only takes no other option/],
      [['--build-only', '/nonexistent/x', '--products', '/nonexistent/y'], /--build-only takes no other option/],
      [['--build-only', full], /is not empty and is not a products folder, so nothing was built into it/],
    ]) {
      const r = run(...args);
      assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status} ${r.stderr}`);
      assert.match(r.stderr, said);
    }
    assert.ok(fs.existsSync(path.join(full, 'something-else')), 'the folder it refused is untouched');
    // Only its own marker makes a folder replaceable: a stray file named xcode-version is not enough.
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'uibuild-8993-'));
    fs.writeFileSync(path.join(stray, 'xcode-version'), 'Xcode 1.0');
    const r = run('--build-only', stray);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(fs.existsSync(path.join(stray, 'xcode-version')), 'untouched');
    fs.rmSync(stray, { recursive: true, force: true });
  } finally { fs.rmSync(full, { recursive: true, force: true }); }
});
