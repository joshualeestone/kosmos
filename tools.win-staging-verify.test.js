'use strict';

/**
 * The Windows staging verification-record WRITER (tools/win-staging-verify.js), its one record
 * spec (tools/lib/win-staging-record.js), and the round trip through the REAL reader
 * (tools/win-staging-verified.sh, the gate `promote-channel.sh --family win` runs).
 *
 *   node --test tools.win-staging-verify.test.js
 *
 * No real network: every fetch goes to a node:http server on 127.0.0.1 (KOSMOS_RELEASE_BASE, or
 * main's `base`). No real record: every record goes under a temp root (KOSMOS_WIN_VERIFY_DIR, or a
 * temp LOCALAPPDATA or HOME), and isolatedEnv refuses any environment whose record directory is
 * outside that root. The writer mostly runs as a child process (the real CLI) through an ASYNC
 * spawn, because a spawnSync would block this process's event loop and with it the server the
 * child is fetching from. The failure-injection arms (a full disk, a held record) run in-process,
 * where fs can be patched for the duration of one call.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');

const WRITER = path.resolve(__dirname, 'tools/win-staging-verify.js');
const GATE = path.resolve(__dirname, 'tools/win-staging-verified.sh');
const spec = require('./tools/lib/win-staging-record');
const writer = require('./tools/win-staging-verify');

const VERSION = '2.0.0';
const SOURCE = 'f120a6e22a94359b073c93aab8cd04ffda975a54';
const OPERATOR_IDS = spec.REQUIRED_CHECKS.filter((check) => check.by === 'operator').map((check) => check.id);
const AUTOMATED_IDS = spec.REQUIRED_CHECKS.filter((check) => check.by === 'automated').map((check) => check.id);
/** The answers for the build `sha` names: every operator check `result`, except `overrides`. */
const attestFor = (sha, result, overrides = {}) => ['--for-sha', sha, ...OPERATOR_IDS.flatMap((id) => ['--attest', `${id}=${overrides[id] || result}`])];

const TEST_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win-staging-verify-test-')));
test.after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));
const freshDir = (name) => fs.mkdtempSync(path.join(TEST_ROOT, `${name}-`));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const diskFullError = () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
/** Replace fs[method] for the duration of body (sync or async), always restoring it. */
async function withPatchedFs(method, replacement, body) {
  const real = fs[method];
  fs[method] = replacement(real);
  try { return await body(); } finally { fs[method] = real; }
}

// ---- a zip, written the way Info-ZIP writes build-kosmos-windows.sh's (no zip64, no encryption) ----
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const stored = entry.method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = (zlib.crc32(data) ^ (entry.corruptCrc ? 1 : 0)) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(stored.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(stored.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, stored);
    centrals.push(central, name);
    offset += 30 + name.length + stored.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
/** The fields build-kosmos-windows.sh writes into manifest.json. */
function manifestJson(overrides = {}) {
  return `${JSON.stringify({ product: 'kosmos', platform: 'win32', arch: 'x64', version: VERSION, source_sha: SOURCE, source_dirty: false, signed: false, ...overrides }, null, 2)}\n`;
}
function buildZip({ manifest = manifestJson(), method = 8, omitManifest = false, corruptCrc = false, extraEntries = [] } = {}) {
  const entries = [{ name: 'Kosmos.exe', data: 'MZ fixture', method: 0 }];
  if (!omitManifest) entries.push({ name: 'manifest.json', data: manifest, method, corruptCrc });
  entries.push({ name: 'app/server.js', data: '// fixture\n'.repeat(20), method: 8 }, ...extraEntries);
  return makeZip(entries);
}

/** A staged release as publish-kosmos-windows.sh leaves it: the staging pointer
    (write-latest-win-pointer.js's shape), the versioned zip and its sidecar. */
function stagedRelease(zip, { version = VERSION, arch = 'x64', pointerSha, sidecar } = {}) {
  const versioned = `kosmos-${version}-win-${arch}.zip`;
  const sha = pointerSha || sha256(zip);
  const pointerBody = `${JSON.stringify({ version, sha256: sha, artifact: `kosmos-win-${arch}.zip`, versioned, arch })}\n`;
  return {
    sha, versioned, pointerBody,
    routes: {
      '/dist/latest-win-staging.json': { body: pointerBody },
      [`/dist/${versioned}`]: { body: zip },
      [`/dist/${versioned}.sha256`]: { body: sidecar !== undefined ? sidecar : `${sha256(zip)}  ${versioned}\n` },
    },
  };
}

// ---- the local release host (routes are read per request, so an arm can move the pointer) ----
async function startServer(routes) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = request.url.split('?')[0];
    requests.push(url);
    const route = routes[url];
    if (!route) { response.writeHead(404); response.end('not found'); return; }
    if (route.stall) { response.writeHead(200, { 'content-length': '100000' }); response.write('x'); return; }
    const body = Buffer.isBuffer(route.body) ? route.body : Buffer.from(String(route.body));
    if (route.chunked) {
      response.writeHead(route.status || 200);
      response.write(body.subarray(0, 1));
      response.end(body.subarray(1));
      return;
    }
    response.writeHead(route.status || 200, { 'content-length': String(body.length) });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}/dist`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
async function withServer(routes, body) {
  const host = await startServer(routes);
  try { return await body(host); } finally { await host.close(); }
}
async function deadBase() {
  const host = await startServer({});
  await host.close();
  return host.base;
}

// ---- the environment a child runs in ----
const LEAKY_VARIABLES = new Set(['KOSMOS_WIN_VERIFY_DIR', 'LOCALAPPDATA', 'HOME', 'AGENT_WORKFORCE_RELEASE_BASE', 'KOSMOS_RELEASE_BASE', 'KOSMOS_WIN_ARCH']);
/** The inherited environment minus anything that could aim the run at the real site or the box's
    real record directory, plus the release base and ONE record-directory arm. Windows variable
    names are case-insensitive, so the filtering is too. */
function isolatedEnv(base, directoryArm) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (!LEAKY_VARIABLES.has(name.toUpperCase())) env[name] = value;
  const pathKey = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') || 'PATH';
  // The gate runs `node`; make it the node running this test.
  env[pathKey] = `${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] || ''}`;
  Object.assign(env, { KOSMOS_RELEASE_BASE: base }, directoryArm || { KOSMOS_WIN_VERIFY_DIR: freshDir('records') });
  if (!('HOME' in env)) env.HOME = freshDir('unused-home');
  const recordDirectory = path.resolve(spec.recordDirectory(env));
  assert.ok(recordDirectory.startsWith(TEST_ROOT + path.sep), `the record directory ${recordDirectory} is outside the test root; refusing to run`);
  return env;
}
function runWriter(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRITER, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr, out: stdout + stderr }));
  });
}
/** main() in this process (so fs can be patched), against `base`, with its output collected. */
async function runMainInProcess(args, env, base) {
  const lines = [];
  const status = await writer.main(args, { env, base, tmpRoot: freshDir('main-tmp'), stdout: (line) => lines.push(line), stderr: (line) => lines.push(line) });
  return { status, out: lines.join('\n') };
}
const toShellPath = (file) => (process.platform === 'win32' ? file.replace(/\\/g, '/') : file);
/** The REAL gate, against a pointer file holding exactly what the host served. */
function runGate(pointerBody, env) {
  const pointerFile = path.join(freshDir('site'), 'latest-win-staging.json');
  fs.writeFileSync(pointerFile, pointerBody);
  const result = spawnSync('bash', [toShellPath(GATE), toShellPath(pointerFile)], { env, encoding: 'utf8' });
  assert.equal(result.error, undefined, `bash could not run the gate: ${result.error}`);
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}
const readRecord = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const checkById = (record, id) => record.checks.find((check) => check.id === id);
/** The record-answering command the checklist prints (everything after `--yes`). */
const printedCommand = (stdout) => {
  const match = /node tools\/win-staging-verify\.js --yes (.*)/.exec(stdout);
  assert.ok(match, `the checklist prints the command that records the answers:\n${stdout}`);
  return match[1];
};

// ================================================================================================
test('the one spec: a built record validates as its derived result, and an overclaim is ambiguous', () => {
  const want = { version: VERSION, sha256: 'a'.repeat(64) };
  const allPass = Object.fromEntries(spec.REQUIRED_CHECKS.map((check) => [check.id, { result: 'pass', by: 'automated' }]));
  const passing = spec.buildRecord({ ...want, sourceSha: SOURCE, checkResults: allPass, at: '2026-09-12T16:10:00Z' });
  assert.equal(passing.result, 'pass');
  for (const check of passing.checks) assert.equal(check.by, spec.REQUIRED_CHECKS.find((required) => required.id === check.id).by, 'by comes from the spec, never the caller');
  assert.deepEqual(spec.validateRecord(passing, want), { problems: [], verdict: 'pass' });

  const { install, ...withoutInstall } = allPass;
  const undecided = spec.buildRecord({ ...want, sourceSha: SOURCE, checkResults: withoutInstall, at: '2026-09-12T16:10:00Z' });
  assert.equal(checkById(undecided, 'install').result, 'not-run');
  assert.equal(undecided.result, 'fail', 'a not-run check is never a pass');
  assert.equal(spec.validateRecord(undecided, want).verdict, 'fail');

  const overclaim = { ...undecided, result: 'pass' };
  assert.match(spec.validateRecord(overclaim, want).problems.join('; '), /disagrees with its checks/);
  const unknownSource = { ...passing, source_sha: 'unknown' };
  assert.match(spec.validateRecord(unknownSource, want).problems.join('; '), /is not a commit/);
});

test('attestation parsing: only operator checks, only pass or fail, each once', () => {
  assert.deepEqual(writer.parseAttestations(['install=pass', 'z-checks=fail']), { attestations: { install: 'pass', 'z-checks': 'fail' }, errors: [] });
  for (const [value, message] of [
    ['install=yes', /is not <check>=pass/], ['install', /is not <check>=pass/], ['nope=pass', /unknown check/],
    ['install=<pass|fail>', /is not <check>=pass/],
    ...AUTOMATED_IDS.map((id) => [`${id}=pass`, /automated check .* cannot be attested/]),
  ]) {
    const { attestations, errors } = writer.parseAttestations([value]);
    assert.deepEqual(attestations, {}, value);
    assert.match(errors.join('\n'), message, value);
  }
  assert.match(writer.parseAttestations(['msg=pass', 'msg=fail']).errors.join('\n'), /given twice/);
});

test('usage errors (3) come before any fetch and write nothing: a bad --attest, --attest without --for-sha, a --for-sha that is not a sha', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    for (const [args, message] of [
      [['--yes', '--for-sha', release.sha, '--attest', 'sha=pass'], /cannot be attested/],
      [['--yes', '--attest', 'install=pass'], /--attest needs --for-sha/],
      [['--yes', '--for-sha', 'abc', '--attest', 'install=pass'], /is not a sha256/],
    ]) {
      const run = await runWriter(args, env);
      assert.equal(run.status, 3, `${args.join(' ')}: ${run.out}`);
      assert.match(run.stderr, message);
    }
    assert.deepEqual(host.requests, [], 'a usage error must not reach the host');
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), []);
  });
});

test('V1 + attested V2 -> a pass record, written once, that the REAL gate accepts (0); the promote line leaves --approval-ref to Josh', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const recordFile = spec.recordPath(env, release.sha);
    let gate = runGate(release.pointerBody, env);
    assert.equal(gate.status, 2, `before any record the gate HOLDs: ${gate.out}`);

    const run = await runWriter(['--yes', ...attestFor(release.sha, 'pass')], env);
    assert.equal(run.status, 0, run.out);
    assert.ok(host.requests.includes(`/dist/${release.versioned}`), 'the zip itself was fetched and hashed');
    const bytes = fs.readFileSync(recordFile);
    const record = JSON.parse(bytes.toString('utf8'));
    assert.equal(record.result, 'pass');
    assert.equal(record.version, VERSION);
    assert.equal(record.sha256, release.sha);
    assert.equal(record.source_sha, SOURCE, 'source_sha comes from the verified zip manifest');
    for (const id of AUTOMATED_IDS) assert.deepEqual([checkById(record, id).by, checkById(record, id).result], ['automated', 'pass'], id);
    for (const id of OPERATOR_IDS) {
      assert.deepEqual([checkById(record, id).by, checkById(record, id).result], ['operator', 'pass'], id);
      assert.match(checkById(record, id).detail, /attested by the operator/);
    }
    assert.deepEqual(listDir(path.dirname(recordFile)), [path.basename(recordFile)], 'no temp file is left beside the record');
    if (process.platform !== 'win32') assert.equal(fs.statSync(recordFile).mode & 0o777, 0o600);

    assert.match(run.stdout, new RegExp(`record_sha256=${sha256(bytes)} result=pass`));
    assert.ok(run.stdout.includes(`promote-channel.sh "$HOME/work/chaoskosmos-site" --family win --approved-version ${VERSION} --approved-sha ${release.sha} --approval-ref <Josh's Slack message ts or permalink>`), run.stdout);

    gate = runGate(release.pointerBody, env);
    assert.equal(gate.status, 0, gate.out);
    assert.ok(gate.out.includes(`record_sha256=${sha256(bytes)}`), 'the gate logs the hash of the exact bytes the writer wrote');

    // A hand edit that keeps "pass" over a failed check is refused by the real gate (1).
    record.checks.find((check) => check.id === 'msg').result = 'fail';
    fs.writeFileSync(recordFile, JSON.stringify(record));
    gate = runGate(release.pointerBody, env);
    assert.equal(gate.status, 1, gate.out);
    assert.match(gate.out, /disagrees with its checks/);
  });
});

test("dry run is the default: nothing is written; the checklist asks for Josh's go, checks engine-path is restored, and prints placeholders bound to the sha", async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const run = await runWriter([], env);
    assert.equal(run.status, 2, run.out);
    assert.match(run.stdout, /DRY RUN - nothing written/);
    assert.match(run.stdout, /STOP: get Josh's go before step 2/);
    assert.match(run.stdout, /\$enginePathBefore = \(Get-Content .*engine-path" -Raw\)\.Trim\(\)/);
    assert.match(run.stdout, /\(Get-Content .*engine-path" -Raw\)\.Trim\(\) -eq \$enginePathBefore/);
    assert.match(run.stdout, /repoint-main\.js <repo> "\$env:LOCALAPPDATA\\Kosmos\\runtime\\node\.exe"/);
    const command = printedCommand(run.stdout);
    assert.ok(command.startsWith(`--for-sha ${release.sha} `), command);
    for (const id of OPERATOR_IDS) assert.ok(command.includes(`--attest ${id}=<pass|fail>`), `the command has a placeholder for ${id}`);
    assert.doesNotMatch(command, /=(pass|fail)\b/, 'the printed command attests nothing by itself');
    const shown = JSON.parse(run.stdout.slice(run.stdout.indexOf('{\n')));
    for (const id of OPERATOR_IDS) assert.equal(checkById(shown, id).result, 'not-run', id);
    assert.equal(shown.result, 'fail');
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), []);

    const attested = await runWriter(attestFor(release.sha, 'pass'), env);
    assert.equal(attested.status, 0, attested.out);
    assert.match(attested.stdout, /DRY RUN - nothing written/);
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), [], 'even a passing dry run writes nothing');
  });
});

test('answers are bound to the build they were given on: a pointer that moved after the checklist is refused (3); nothing is written and the gate still HOLDs', async () => {
  const tested = stagedRelease(buildZip());
  const newer = stagedRelease(buildZip({ manifest: manifestJson({ version: '2.0.1' }) }), { version: '2.0.1' });
  const routes = { ...tested.routes };
  await withServer(routes, async (host) => {
    const env = isolatedEnv(host.base);
    const dry = await runWriter([], env);
    const command = printedCommand(dry.stdout);
    assert.ok(command.includes(`--for-sha ${tested.sha}`), command);

    // A new staging cut lands while the operator runs Z0-Z6 on the build the checklist named.
    for (const key of Object.keys(routes)) delete routes[key];
    Object.assign(routes, newer.routes);
    const late = await runWriter(['--yes', ...attestFor(tested.sha, 'pass')], env);
    assert.equal(late.status, 3, late.out);
    assert.match(late.stderr, new RegExp(`REFUSING - the staging pointer now names 2\\.0\\.1 \\(${newer.sha}\\), not the build these answers are for \\(${tested.sha}\\)`));
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), [], 'no record for either build');
    assert.equal(runGate(newer.pointerBody, env).status, 2, 'the gate still HOLDs the build nobody tested');

    const dryLate = await runWriter(attestFor(tested.sha, 'pass'), env);
    assert.equal(dryLate.status, 3, `a dry run with answers for another build is refused too: ${dryLate.out}`);
  });
});

test('--yes refuses an undecided record (some V2 check not attested, none failed): the gate stays at HOLD (2)', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const run = await runWriter(['--yes', '--for-sha', release.sha, '--attest', 'install=pass', '--attest', 'z-checks=pass'], env);
    assert.equal(run.status, 2, run.out);
    assert.match(run.stderr, /NOT WRITING - no check failed, but multiline, msg did not run/);
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), []);
    assert.equal(runGate(release.pointerBody, env).status, 2);
  });
});

test('an operator fail is recorded as fail and the REAL gate refuses it (1)', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const run = await runWriter(['--yes', ...attestFor(release.sha, 'pass', { 'z-checks': 'fail' })], env);
    assert.equal(run.status, 1, run.out);
    assert.match(run.stdout, /FAIL \(z-checks\)/);
    assert.doesNotMatch(run.stdout, /promote-channel\.sh/, 'no promote line for a failed build');
    const record = readRecord(spec.recordPath(env, release.sha));
    assert.deepEqual([record.result, checkById(record, 'z-checks').result, checkById(record, 'z-checks').by], ['fail', 'fail', 'operator']);
    const gate = runGate(release.pointerBody, env);
    assert.equal(gate.status, 1, gate.out);
    assert.match(gate.out, /FAILED/);
  });
});

test('a V1 sha mismatch fails the record even when every V2 check is attested pass; the REAL gate refuses it (1)', async () => {
  const release = stagedRelease(buildZip(), { pointerSha: sha256(Buffer.from('some other build')) });
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const run = await runWriter(['--yes', ...attestFor(release.sha, 'pass')], env);
    assert.equal(run.status, 1, run.out);
    const record = readRecord(spec.recordPath(env, release.sha));
    assert.equal(checkById(record, 'sha').result, 'fail');
    assert.match(checkById(record, 'sha').detail, /hashes to [0-9a-f]{64}, not the pointer's/);
    assert.equal(checkById(record, 'manifest').result, 'not-run');
    assert.equal(record.result, 'fail');
    assert.equal(runGate(release.pointerBody, env).status, 1);
  });
});

/** V1 in-process against the local host; asserts the temp zip is always deleted. */
async function verifyAgainst(routes, { caps = writer.DEFAULT_CAPS } = {}) {
  const tmpRoot = freshDir('v1-tmp');
  const result = await withServer(routes, (host) => writer.verifyStagedBuild({ base: host.base, tmpRoot, caps }));
  assert.deepEqual(listDir(tmpRoot), [], 'the downloaded zip is deleted after V1');
  return result;
}

test('V1: computed, pointer and sidecar sha must all agree', async () => {
  const zip = buildZip();
  const good = await verifyAgainst(stagedRelease(zip).routes);
  assert.equal(good.verdict, 'checked');
  assert.deepEqual([good.checkResults.sha.result, good.checkResults.manifest.result, good.sourceSha], ['pass', 'pass', SOURCE]);

  const cases = [
    ['the served bytes differ from the pointer', stagedRelease(zip, { pointerSha: 'b'.repeat(64) }), /hashes to .* not the pointer's/],
    ['the sidecar names another sha', stagedRelease(zip, { sidecar: `${'c'.repeat(64)}  kosmos-${VERSION}-win-x64.zip\n` }), /the sidecar names c{64}/],
    ['the sidecar names no sha', stagedRelease(zip, { sidecar: 'not a hash\n' }), /names no sha256/],
  ];
  const missingSidecar = stagedRelease(zip);
  delete missingSidecar.routes[`/dist/${missingSidecar.versioned}.sha256`];
  cases.push(['the sidecar is missing (404)', missingSidecar, /\.sha256 answered HTTP 404/]);
  const missingZip = stagedRelease(zip);
  delete missingZip.routes[`/dist/${missingZip.versioned}`];
  cases.push(['the zip is missing (404)', missingZip, /\.zip answered HTTP 404/]);
  for (const [name, release, detail] of cases) {
    const result = await verifyAgainst(release.routes);
    assert.equal(result.verdict, 'checked', name);
    assert.equal(result.checkResults.sha.result, 'fail', name);
    assert.match(result.checkResults.sha.detail, detail, name);
    assert.equal(result.checkResults.manifest.result, 'not-run', `${name}: the manifest of unverified bytes is never read`);
  }
});

test('V1 manifest: read from the verified zip; version, platform, arch, a clean known commit, and no path listed twice', async () => {
  const stored = await verifyAgainst(stagedRelease(buildZip({ method: 0 })).routes);
  assert.deepEqual([stored.checkResults.manifest.result, stored.sourceSha], ['pass', SOURCE], 'a stored (uncompressed) manifest reads too');
  const cases = [
    ['another version', { manifest: manifestJson({ version: '1.9.9' }) }, /names version "1\.9\.9", not the pointer's 2\.0\.0/],
    ['a dirty tree', { manifest: manifestJson({ source_dirty: true }) }, /source_dirty is true/],
    ['an unknown commit', { manifest: manifestJson({ source_sha: 'unknown' }) }, /source_sha "unknown" is not a commit/],
    ['another arch', { manifest: manifestJson({ arch: 'arm64' }) }, /arch is "arm64", not x64/],
    ['no manifest', { omitManifest: true }, /has no manifest\.json/],
    ['a bad CRC', { corruptCrc: true }, /fails its CRC/],
    ['not JSON', { manifest: '{nope' }, /is not JSON/],
    // Extractors keep the LAST of two same-named entries; the first one here is the honest one.
    ['a second manifest.json after the good one',
      { extraEntries: [{ name: 'manifest.json', data: manifestJson({ version: '9.9.9', source_dirty: true }), method: 8 }] }, /lists manifest\.json more than once/],
    ['a second manifest differing only in case', { extraEntries: [{ name: 'Manifest.json', data: manifestJson(), method: 8 }] }, /lists Manifest\.json more than once/],
    ['any other path listed twice', { extraEntries: [{ name: 'app/server.js', data: '// swapped\n', method: 8 }] }, /lists app\/server\.js more than once/],
  ];
  for (const [name, zipOptions, detail] of cases) {
    const result = await verifyAgainst(stagedRelease(buildZip(zipOptions)).routes);
    assert.equal(result.checkResults.sha.result, 'pass', name);
    assert.equal(result.checkResults.manifest.result, 'fail', name);
    assert.match(result.checkResults.manifest.detail, detail, name);
  }
  const notAZip = await verifyAgainst(stagedRelease(Buffer.from('these bytes hash fine but are no zip')).routes);
  assert.match(notAZip.checkResults.manifest.detail, /not a zip/);
  const capped = await verifyAgainst(stagedRelease(buildZip()).routes, { caps: { ...writer.DEFAULT_CAPS, manifestBytes: 16 } });
  assert.match(capped.checkResults.manifest.detail, /over the 16-byte cap/);
});

test('V1: 408, 429 and 5xx from the pointer, the sidecar or the zip cannot tell (no check is failed on them)', async () => {
  const zip = buildZip();
  for (const status of [408, 429, 500, 502, 503]) {
    for (const target of ['pointer', 'sidecar', 'zip']) {
      const release = stagedRelease(zip);
      const key = { pointer: '/dist/latest-win-staging.json', sidecar: `/dist/${release.versioned}.sha256`, zip: `/dist/${release.versioned}` }[target];
      release.routes[key] = { body: 'busy', status };
      const result = await verifyAgainst(release.routes);
      assert.equal(result.verdict, 'cannot-tell', `${target} ${status}`);
      assert.match(result.reason, new RegExp(`answered HTTP ${status}`), `${target} ${status}`);
    }
  }
});

test('V1 caps: over-cap bytes fail the sha check; a timeout or a bad pointer cannot tell', async () => {
  const zip = buildZip();
  const small = { ...writer.DEFAULT_CAPS, zipBytes: 100 };
  const declared = await verifyAgainst(stagedRelease(zip).routes, { caps: small });
  assert.equal(declared.checkResults.sha.result, 'fail');
  assert.match(declared.checkResults.sha.detail, /is \d+ bytes, over the 100-byte cap/);
  const chunked = stagedRelease(zip);
  chunked.routes[`/dist/${chunked.versioned}`] = { body: zip, chunked: true };
  const streamed = await verifyAgainst(chunked.routes, { caps: small });
  assert.match(streamed.checkResults.sha.detail, /sent more than the 100-byte cap/, 'the byte cap holds without a content-length');

  const stalled = stagedRelease(zip);
  stalled.routes[`/dist/${stalled.versioned}`] = { stall: true };
  const timedOut = await verifyAgainst(stalled.routes, { caps: { ...writer.DEFAULT_CAPS, zipTimeoutMs: 300 } });
  assert.equal(timedOut.verdict, 'cannot-tell');
  assert.match(timedOut.reason, /timed out after 300 ms/);

  const pointerCapped = await verifyAgainst(stagedRelease(zip).routes, { caps: { ...writer.DEFAULT_CAPS, pointerBytes: 10 } });
  assert.equal(pointerCapped.verdict, 'cannot-tell');

  const pointerCases = [
    ['not JSON', '{nope'],
    ['a build for another arch', JSON.stringify({ version: VERSION, sha256: sha256(zip), versioned: `kosmos-${VERSION}-win-arm64.zip` })],
    ['a sha that is not hex', JSON.stringify({ version: VERSION, sha256: 'z'.repeat(64), versioned: `kosmos-${VERSION}-win-x64.zip` })],
    ['no version', JSON.stringify({ sha256: sha256(zip), versioned: `kosmos-${VERSION}-win-x64.zip` })],
  ];
  for (const [name, body] of pointerCases) {
    const release = stagedRelease(zip);
    release.routes['/dist/latest-win-staging.json'] = { body };
    assert.equal((await verifyAgainst(release.routes)).verdict, 'cannot-tell', name);
  }
});

test('V1 on this box: a full disk says the disk is full, a short save is caught, and an interrupt deletes the partial zip', async () => {
  const release = stagedRelease(buildZip());
  const diskFull = await withPatchedFs('writeSync', (real) => (fd, ...rest) => {
    if (fd === 1 || fd === 2) return real(fd, ...rest);
    throw diskFullError();
  }, () => verifyAgainst(release.routes));
  assert.equal(diskFull.verdict, 'cannot-tell');
  assert.match(diskFull.reason, /the disk is full: saving .*\.zip stopped after 0 bytes \(ENOSPC\)/);

  const shortSave = await withPatchedFs('fstatSync', () => () => ({ size: 1 }), () => verifyAgainst(release.routes));
  assert.equal(shortSave.verdict, 'cannot-tell');
  assert.match(shortSave.reason, /the saved zip holds 1 bytes, but \d+ bytes were hashed/);

  // The node:test harness itself listens for SIGINT and SIGTERM, so the arm injects its own event
  // name; the writer's real list is SIGINT, SIGTERM and SIGBREAK (where the OS has it).
  const stalled = stagedRelease(buildZip());
  stalled.routes[`/dist/${stalled.versioned}`] = { stall: true };
  const interruptEvent = 'kosmos-test-interrupt';
  const tmpRoot = freshDir('v1-interrupt');
  const exits = [];
  await withServer(stalled.routes, async (host) => {
    const running = writer.verifyStagedBuild({
      base: host.base, tmpRoot, caps: { ...writer.DEFAULT_CAPS, zipTimeoutMs: 1500 },
      interruptSignals: [interruptEvent], exitProcess: (code) => exits.push(code),
    });
    const partialZip = () => listDir(tmpRoot).flatMap((dir) => listDir(path.join(tmpRoot, dir)));
    const deadline = Date.now() + 5000;
    while (!(host.requests.includes(`/dist/${stalled.versioned}`) && partialZip().length)) {
      assert.ok(Date.now() < deadline, 'the download never started');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    process.emit(interruptEvent, interruptEvent);
    assert.deepEqual(exits, [2], 'an interrupted run exits like cannot tell');
    assert.deepEqual(listDir(tmpRoot), [], 'the partial download is deleted at once, not at the end');
    await running;
  });
  assert.equal(process.listenerCount(interruptEvent), 0, 'the handler is removed once V1 ends');
});

test('an unreachable base or a missing pointer ends the CLI at cannot tell (2) and writes nothing', async () => {
  const anySha = 'a'.repeat(64);
  const unreachable = isolatedEnv(await deadBase());
  const run = await runWriter(['--yes', ...attestFor(anySha, 'pass')], unreachable);
  assert.equal(run.status, 2, run.out);
  assert.match(run.stderr, /CANNOT TELL - could not reach/);
  assert.deepEqual(listDir(unreachable.KOSMOS_WIN_VERIFY_DIR), []);

  await withServer({}, async (host) => {
    const env = isolatedEnv(host.base);
    const missing = await runWriter(['--yes', ...attestFor(anySha, 'pass')], env);
    assert.equal(missing.status, 2, missing.out);
    assert.match(missing.stderr, /latest-win-staging\.json answered HTTP 404/);
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), []);
  });
});

test('never over an existing record without --force-rewrite; --force-rewrite replaces it atomically and says so afterwards', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const recordFile = spec.recordPath(env, release.sha);
    assert.equal((await runWriter(['--yes', ...attestFor(release.sha, 'pass')], env)).status, 0);
    const first = fs.readFileSync(recordFile);

    const again = await runWriter(['--yes', ...attestFor(release.sha, 'pass', { msg: 'fail' })], env);
    assert.equal(again.status, 3, again.out);
    assert.match(again.stderr, /REFUSING - a record for [0-9a-f]{64} already exists .*result pass/);
    assert.deepEqual(fs.readFileSync(recordFile), first, 'the existing record is byte-for-byte untouched');

    const forced = await runWriter(['--yes', '--force-rewrite', ...attestFor(release.sha, 'pass', { msg: 'fail' })], env);
    assert.equal(forced.status, 1, forced.out);
    assert.match(forced.stderr, new RegExp(`--force-rewrite: replaced .*sha256 ${sha256(first)}`), 'the replacement names what it replaced');
    assert.match(forced.stdout, /\(replaced the previous record\)/);
    assert.equal(readRecord(recordFile).result, 'fail');
    assert.deepEqual(listDir(path.dirname(recordFile)), [path.basename(recordFile)]);
    assert.equal(runGate(release.pointerBody, env).status, 1);
  });
});

test('--force-rewrite over a record another program holds open: a sentence (not a crash), exit 3, the old record unchanged, nothing logged as replaced', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    assert.equal((await runMainInProcess(['--yes', ...attestFor(release.sha, 'pass')], env, host.base)).status, 0);
    const recordFile = spec.recordPath(env, release.sha);
    const first = fs.readFileSync(recordFile);
    const held = await withPatchedFs('renameSync', () => () => { throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }); },
      () => runMainInProcess(['--yes', '--force-rewrite', ...attestFor(release.sha, 'pass', { msg: 'fail' })], env, host.base));
    assert.equal(held.status, 3, held.out);
    assert.match(held.out, /Close whatever has the record open/);
    assert.doesNotMatch(held.out, /--force-rewrite: replaced/, 'nothing is logged as replaced when the rename failed');
    assert.deepEqual(fs.readFileSync(recordFile), first);
    assert.deepEqual(listDir(path.dirname(recordFile)), [path.basename(recordFile)], 'the temp file is gone');
  });
});

test('writeRecordAtomically: refuses an existing record before creating any temp file, and writes whole records', async () => {
  const directory = freshDir('atomic');
  const file = path.join(directory, `win-staging-${'d'.repeat(64)}.json`);
  const first = writer.writeRecordAtomically(file, { result: 'pass', at: 'then' });
  assert.equal(first.written, true);
  assert.equal(first.recordSha256, sha256(fs.readFileSync(file)));
  const tempOpens = [];
  const second = await withPatchedFs('openSync', (real) => (target, ...rest) => {
    if (String(target).endsWith('.tmp')) tempOpens.push(String(target));
    return real(target, ...rest);
  }, () => writer.writeRecordAtomically(file, { result: 'fail', at: 'now' }));
  assert.equal(second.written, false);
  assert.match(second.previous, /result pass, at then/);
  assert.deepEqual(tempOpens, [], 'the refusal comes before any temp file is created');
  assert.equal(readRecord(file).result, 'pass');
  assert.deepEqual(listDir(directory), [path.basename(file)]);
});

test('writeRecordAtomically: a write or fsync that fails (a full disk) leaves no temp file and no record', async () => {
  for (const method of ['writeSync', 'fsyncSync']) {
    const directory = freshDir(`atomic-${method}`);
    const file = path.join(directory, `win-staging-${'e'.repeat(64)}.json`);
    await withPatchedFs(method, (real) => (fd, ...rest) => {
      if (fd === 1 || fd === 2) return real(fd, ...rest);
      throw diskFullError();
    }, () => assert.throws(() => writer.writeRecordAtomically(file, { result: 'pass' }), { code: 'ENOSPC' }, method));
    assert.deepEqual(listDir(directory), [], `${method}: nothing is left in the record directory`);
  }
});

test('round trip through the REAL gate in all three record-directory arms', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const arms = [
      ['KOSMOS_WIN_VERIFY_DIR', (dir) => ({ KOSMOS_WIN_VERIFY_DIR: dir }), (dir) => dir],
      ['LOCALAPPDATA', (dir) => ({ LOCALAPPDATA: dir }), (dir) => path.join(dir, 'Kosmos', 'release-verify')],
      ['HOME', (dir) => ({ HOME: dir }), (dir) => path.join(dir, '.local', 'state', 'kosmos', 'release-verify')],
    ];
    for (const [name, arm, expectedDirectory] of arms) {
      const dir = freshDir(`arm-${name}`);
      const env = isolatedEnv(host.base, arm(dir));
      const recordFile = path.join(expectedDirectory(dir), `win-staging-${release.sha}.json`);
      assert.equal(runGate(release.pointerBody, env).status, 2, `${name}: HOLD before the record exists`);
      const run = await runWriter(['--yes', ...attestFor(release.sha, 'pass')], env);
      assert.equal(run.status, 0, `${name}: ${run.out}`);
      assert.ok(fs.existsSync(recordFile), `${name}: the writer wrote ${recordFile}`);
      const gate = runGate(release.pointerBody, env);
      assert.equal(gate.status, 0, `${name}: ${gate.out}`);
      assert.ok(gate.out.includes(`record_sha256=${sha256(fs.readFileSync(recordFile))}`), `${name}: the gate read the file the writer wrote`);
    }
  });
});
