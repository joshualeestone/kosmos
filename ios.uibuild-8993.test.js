'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
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
  assert.match(b, /shasum -a 256 ui-products\.tar > ui-products\.tar\.sha256/);
  assert.match(b, /path: \|\n\s+\$\{\{ runner\.temp \}\}\/ui-products\.tar\n\s+\$\{\{ runner\.temp \}\}\/ui-products\.tar\.sha256\n/);
  assert.match(b, /codesign --verify --deep --strict "\$app"/, 'the tar round trip is checked once, here');
  assert.match(b, /overwrite: true/, '"Re-run all jobs" replaces it');
  assert.match(b, /if-no-files-found: error/, 'an empty upload is red, never a silent nothing');
});

test('every UI job needs uibuild, downloads that artifact (tolerating its absence), unpacks it, and tests it', () => {
  for (const name of ['ui', 'uikit']) {
    const j = job(name);
    assert.match(j, /\n {4}needs: uibuild\n/, `${name} waits for the build`);
    assert.match(j, /actions\/download-artifact@v4\n {8}continue-on-error: true\n {8}with:\n {10}name: ui-products\n/,
      `${name} downloads the artifact uibuild uploads, and a missing one falls back to building, not to a red`);
    assert.match(j, /shasum -a 256 -c ui-products\.tar\.sha256 \) &&\n\s+tar -C "\$RUNNER_TEMP\/ui-products" -xf "\$d\/ui-products\.tar"; then/,
      `${name} unpacks it only when it matches uibuild's checksum`);
    assert.match(j, /else\n\s+rm -rf "\$\{RUNNER_TEMP:\?\}\/ui-products"; mkdir -p "\$RUNNER_TEMP\/ui-products"\n\s+echo "::warning::/,
      `${name} falls back to building, with a warning, on anything else`);
    assert.match(j, /ui-sample\.sh[^\n]* --products "\$RUNNER_TEMP\/ui-products"/, `${name} tests the shared products`);
  }
  assert.match(job('uikit'), /--uikit --shard "\$\{\{ matrix\.shard \}\}" --products/, 'both UIKit halves keep their shard');
});

test('CONTROL: the job reader can fail (a job that does not exist)', () => {
  assert.throws(() => job('no-such-job'));
});

/* The two xcodebuild lines: the arguments after the verb and its app source, through the result bundle. */
function testRuns(src = SH) {
  const lines = src.split('\n');
  const grab = (re) => {
    const at = lines.findIndex((l) => re.test(l));
    assert.ok(at >= 0, `premise: ui-sample.sh has ${re}`);
    let i = at; let text = lines[i];
    while (/\\\s*$/.test(lines[i])) { i += 1; text += ' ' + lines[i]; }   // every continuation line, however many
    return text.replace(/\s+/g, ' ');
  };
  return { shared: grab(/xcodebuild test-without-building -xctestrun/), built: grab(/xcodebuild test -project Kosmos\.xcodeproj/) };
}
const VARS = /TEST_RUNNER_KOSMOS_UI_PLUS=1 TEST_RUNNER_KOSMOS_UI_SAMPLE=1 TEST_RUNNER_KOSMOS_UIKITLIST="\$uikit"/;

test('the shared-products run passes exactly the test arguments a built run does (CI now always takes it)', () => {
  const { shared, built } = testRuns();
  // Everything after the app source: the destination through the result bundle, compared whole.
  const after = (line, src) => { const at = line.indexOf(src); assert.ok(at >= 0, `premise: ${src}`); return line.slice(at + src.length).trim(); };
  const sharedTail = after(shared, '-xctestrun "$run_file"');
  const builtTail = after(built, '-project Kosmos.xcodeproj -scheme Kosmos');
  assert.equal(sharedTail, builtTail, 'the same destination, retry, classes, skips, time limits, derived data and result bundle');
  assert.match(sharedTail, /^-destination "id=\$udid" \\? ?-retry-tests-on-failure -test-iterations 2 \$only \$skip \$allow -derivedDataPath "\$work\/dd" -resultBundlePath "\$work\/result\.xcresult"/);
  for (const [name, line] of [['shared', shared], ['built', built]]) assert.match(line, VARS, `${name}: the three test-runner variables`);
  // CONTROL: the same comparison on the script with one argument added to the shared line alone, on a line of its own.
  const mutated = testRuns(SH.replace('-xctestrun "$run_file" -destination', '-xctestrun "$run_file" -parallel-testing-enabled YES \\\n      -destination'));
  assert.notEqual(after(mutated.shared, '-xctestrun "$run_file"'), after(mutated.built, '-project Kosmos.xcodeproj -scheme Kosmos'));
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
  const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'uibuild-8993-'));
  fs.writeFileSync(path.join(full, 'something-else'), 'x');
  try {
    for (const [args, said] of [
      [['--build-only'], /--build-only takes a folder/],
      [['--products'], /--products takes a folder/],
      [['--uikit', '--build-only', '/nonexistent/x'], /--build-only takes no other option/],
      [['--build-only', '/nonexistent/x', '--products', '/nonexistent/y'], /--build-only takes no other option/],
      [['--build-only', full], /is not empty and is not a products folder, so nothing was built into it/],
      [['--keep', '--build-only', '/nonexistent/x'], /--build-only takes no other option/],
    ]) {
      const r = run(...args);
      assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status} ${r.stderr}`);
      assert.match(r.stderr, said);
    }
    assert.ok(fs.existsSync(path.join(full, 'something-else')), 'the folder it refused is untouched');
    // Only its own marker makes a folder replaceable: a stray file named xcode-version is not enough.
    fs.writeFileSync(path.join(stray, 'xcode-version'), 'Xcode 1.0');
    const r = run('--build-only', stray);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(fs.existsSync(path.join(stray, 'xcode-version')), 'untouched');
  } finally { for (const d of [full, stray]) fs.rmSync(d, { recursive: true, force: true }); }
});

/* The unpack step itself, run: its `run:` block taken from ios.yml and run in a temp RUNNER_TEMP for a good download, one
   whose checksum does not match, one that is cut short, and none at all. Only the good one is unpacked; the rest leave
   the folder empty and warn, so ui-sample.sh builds the app itself. */
test('the unpack step: a good download is unpacked; a bad checksum, a cut-short tar or none falls back with a warning', () => {
  const unpack = (name) => {
    const block = job(name).split('\n');
    const at = block.findIndex((l) => l.includes('- name: Unpack the shared build'));
    assert.ok(at >= 0, `premise: the ${name} job has the unpack step`);
    const runAt = block.findIndex((l, i) => i > at && /^ {8}run: \|$/.test(l));
    const body = [];
    for (let i = runAt + 1; i < block.length && /^( {10}|$)/.test(block[i]); i += 1) body.push(block[i].slice(10));
    return body.join('\n');
  };
  const script = unpack('ui');
  assert.equal(unpack('uikit'), script, 'both UI jobs unpack the same way (the one run here)');
  assert.match(script, /shasum -a 256 -c/, 'premise: the extracted block is the unpack step');
  const cases = [];
  const setup = (name, fn) => {
    const rt = fs.mkdtempSync(path.join(os.tmpdir(), `uibuild-unpack-${name}-`));
    const src = path.join(rt, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'Kosmos.xctestrun'), 'x');
    const d = path.join(rt, 'ui-products-tar');
    fs.mkdirSync(d);
    spawnSync('tar', ['-C', src, '-cf', path.join(d, 'ui-products.tar'), '.']);
    spawnSync('sh', ['-c', 'cd "$1" && shasum -a 256 ui-products.tar > ui-products.tar.sha256', 'sh', d]);
    fn(d);
    const r = spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: rt } });   // as GitHub runs it
    const got = fs.readdirSync(path.join(rt, 'ui-products'));
    cases.push(rt);
    return { r, got };
  };
  try {
    const good = setup('good', () => {});
    assert.equal(good.r.status, 0, good.r.stderr);
    assert.match(good.r.stdout, /using the shared build/);
    assert.deepEqual(good.got, ['Kosmos.xctestrun'], 'unpacked');
    for (const [name, spoil] of [
      ['badsum', (d) => fs.appendFileSync(path.join(d, 'ui-products.tar'), 'x')],
      ['cut', (d) => { const f = path.join(d, 'ui-products.tar'); fs.truncateSync(f, 100); spawnSync('sh', ['-c', 'cd "$1" && shasum -a 256 ui-products.tar > ui-products.tar.sha256', 'sh', d]); }],
      ['none', (d) => fs.rmSync(d, { recursive: true, force: true })],
    ]) {
      const bad = setup(name, spoil);
      assert.equal(bad.r.status, 0, `${name}: the step never goes red: ${bad.r.stderr}`);
      assert.match(bad.r.stdout, /::warning::no usable shared build/, name);
      assert.deepEqual(bad.got, [], `${name}: nothing unpacked, so the job builds the app itself`);
    }
  } finally { for (const rt of cases) fs.rmSync(rt, { recursive: true, force: true }); }
});
