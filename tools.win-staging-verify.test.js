'use strict';

/**
 * The Windows staging verification-record WRITER (tools/win-staging-verify.js), its one record
 * spec (tools/lib/win-staging-record.js), and the round trip through the REAL reader
 * (tools/win-staging-verified.sh, the gate `promote-channel.sh --family win` runs).
 *
 *   node --test tools.win-staging-verify.test.js
 *
 * No real network: every fetch goes to a node:http server on 127.0.0.1 (KOSMOS_RELEASE_BASE). No
 * real record: every record goes under a temp root (KOSMOS_WIN_VERIFY_DIR, or a temp LOCALAPPDATA
 * or HOME), and isolatedEnv refuses any environment whose record directory is outside that root.
 * The writer runs as a child process (the real CLI) through an ASYNC spawn, because a spawnSync
 * would block this process's event loop and with it the server the child is fetching from.
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
const attestAll = (result, overrides = {}) => OPERATOR_IDS.flatMap((id) => ['--attest', `${id}=${overrides[id] || result}`]);

const TEST_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win-staging-verify-test-')));
test.after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));
const freshDir = (name) => fs.mkdtempSync(path.join(TEST_ROOT, `${name}-`));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

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
function buildZip({ manifest = manifestJson(), method = 8, omitManifest = false, corruptCrc = false } = {}) {
  const entries = [{ name: 'Kosmos.exe', data: 'MZ fixture', method: 0 }];
  if (!omitManifest) entries.push({ name: 'manifest.json', data: manifest, method, corruptCrc });
  entries.push({ name: 'app/server.js', data: '// fixture\n'.repeat(20), method: 8 });
  return makeZip(entries);
}

/** A staged release as publish-kosmos-windows.sh leaves it: the staging pointer
    (write-latest-win-pointer.js's shape), the versioned zip and its sidecar. */
function stagedRelease(zip, { version = VERSION, arch = 'x64', pointerSha, sidecar } = {}) {
  const versioned = `kosmos-${version}-win-${arch}.zip`;
  const sha = pointerSha || sha256(zip);
  const pointer = { version, sha256: sha, artifact: `kosmos-win-${arch}.zip`, versioned, arch };
  const pointerBody = `${JSON.stringify(pointer)}\n`;
  return {
    sha, versioned, pointerBody,
    routes: {
      '/dist/latest-win-staging.json': { body: pointerBody },
      [`/dist/${versioned}`]: { body: zip },
      [`/dist/${versioned}.sha256`]: { body: sidecar !== undefined ? sidecar : `${sha256(zip)}  ${versioned}\n` },
    },
  };
}

// ---- the local release host ----
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
    ...AUTOMATED_IDS.map((id) => [`${id}=pass`, /automated check .* cannot be attested/]),
  ]) {
    const { attestations, errors } = writer.parseAttestations([value]);
    assert.deepEqual(attestations, {}, value);
    assert.match(errors.join('\n'), message, value);
  }
  assert.match(writer.parseAttestations(['msg=pass', 'msg=fail']).errors.join('\n'), /given twice/);
});

test('a bad --attest is a usage error (3) before any fetch; nothing is written', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const run = await runWriter(['--yes', '--attest', 'sha=pass'], env);
    assert.equal(run.status, 3, run.out);
    assert.match(run.stderr, /cannot be attested/);
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

    const run = await runWriter(['--yes', ...attestAll('pass')], env);
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

test('dry run is the default: nothing is written, the V2 checklist is printed, and un-attested V2 is not-run (exit 2)', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const run = await runWriter([], env);
    assert.equal(run.status, 2, run.out);
    assert.match(run.stdout, /DRY RUN - nothing written/);
    assert.match(run.stdout, /e2e-zip\.js/);
    for (const id of OPERATOR_IDS) assert.ok(run.stdout.includes(`--attest ${id}=pass`), `the checklist names ${id}`);
    const shown = JSON.parse(run.stdout.slice(run.stdout.indexOf('{\n')));
    for (const id of OPERATOR_IDS) assert.equal(checkById(shown, id).result, 'not-run', id);
    assert.equal(shown.result, 'fail');
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), []);

    const attested = await runWriter(attestAll('pass'), env);
    assert.equal(attested.status, 0, attested.out);
    assert.match(attested.stdout, /DRY RUN - nothing written/);
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), [], 'even a passing dry run writes nothing');
  });
});

test('--yes refuses an undecided record (some V2 check not attested, none failed): the gate stays at HOLD (2)', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const run = await runWriter(['--yes', '--attest', 'install=pass', '--attest', 'z-checks=pass'], env);
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
    const run = await runWriter(['--yes', ...attestAll('pass', { 'z-checks': 'fail' })], env);
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
    const run = await runWriter(['--yes', ...attestAll('pass')], env);
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
async function verifyAgainst(routes, { caps = writer.DEFAULT_CAPS, base } = {}) {
  const tmpRoot = freshDir('v1-tmp');
  const run = async (hostBase) => writer.verifyStagedBuild({ base: hostBase, tmpRoot, caps });
  const result = base ? await run(base) : await withServer(routes, (host) => run(host.base));
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

test('V1 manifest: read from the verified zip; version, platform, arch, a clean known commit', async () => {
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

test('V1 caps and transient answers: over-cap bytes fail the sha check; a timeout, a 5xx or a bad pointer cannot tell', async () => {
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

  const struggling = stagedRelease(zip);
  struggling.routes[`/dist/${struggling.versioned}`] = { body: 'busy', status: 503 };
  assert.equal((await verifyAgainst(struggling.routes)).verdict, 'cannot-tell', 'a 503 says nothing about the build');

  const bigPointer = stagedRelease(zip);
  const pointerCapped = await verifyAgainst(bigPointer.routes, { caps: { ...writer.DEFAULT_CAPS, pointerBytes: 10 } });
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
    const result = await verifyAgainst(release.routes);
    assert.equal(result.verdict, 'cannot-tell', name);
  }
});

test('an unreachable base or a missing pointer ends the CLI at cannot tell (2) and writes nothing', async () => {
  const unreachable = isolatedEnv(await deadBase());
  const run = await runWriter(['--yes', ...attestAll('pass')], unreachable);
  assert.equal(run.status, 2, run.out);
  assert.match(run.stderr, /CANNOT TELL - could not reach/);
  assert.deepEqual(listDir(unreachable.KOSMOS_WIN_VERIFY_DIR), []);

  await withServer({}, async (host) => {
    const env = isolatedEnv(host.base);
    const missing = await runWriter(['--yes', ...attestAll('pass')], env);
    assert.equal(missing.status, 2, missing.out);
    assert.match(missing.stderr, /latest-win-staging\.json answered HTTP 404/);
    assert.deepEqual(listDir(env.KOSMOS_WIN_VERIFY_DIR), []);
  });
});

test('never over an existing record without --force-rewrite; --force-rewrite replaces it atomically and says so', async () => {
  const release = stagedRelease(buildZip());
  await withServer(release.routes, async (host) => {
    const env = isolatedEnv(host.base);
    const recordFile = spec.recordPath(env, release.sha);
    assert.equal((await runWriter(['--yes', ...attestAll('pass')], env)).status, 0);
    const first = fs.readFileSync(recordFile);

    const again = await runWriter(['--yes', ...attestAll('pass', { msg: 'fail' })], env);
    assert.equal(again.status, 3, again.out);
    assert.match(again.stderr, /REFUSING - a record for [0-9a-f]{64} already exists .*result pass/);
    assert.deepEqual(fs.readFileSync(recordFile), first, 'the existing record is byte-for-byte untouched');

    const forced = await runWriter(['--yes', '--force-rewrite', ...attestAll('pass', { msg: 'fail' })], env);
    assert.equal(forced.status, 1, forced.out);
    assert.match(forced.stderr, new RegExp(`--force-rewrite: replacing .*sha256 ${sha256(first)}`), 'the replacement names what it replaced');
    assert.match(forced.stdout, /\(replaced the previous record\)/);
    assert.equal(readRecord(recordFile).result, 'fail');
    assert.deepEqual(listDir(path.dirname(recordFile)), [path.basename(recordFile)]);
    assert.equal(runGate(release.pointerBody, env).status, 1);
  });
});

test('writeRecordAtomically: refuses an existing file, leaves no temp file, and writes whole records', () => {
  const directory = freshDir('atomic');
  const file = path.join(directory, `win-staging-${'d'.repeat(64)}.json`);
  const first = writer.writeRecordAtomically(file, { result: 'pass', at: 'then' });
  assert.equal(first.written, true);
  assert.equal(first.recordSha256, sha256(fs.readFileSync(file)));
  const second = writer.writeRecordAtomically(file, { result: 'fail', at: 'now' });
  assert.equal(second.written, false);
  assert.match(second.previous, /result pass, at then/);
  assert.equal(readRecord(file).result, 'pass');
  assert.deepEqual(listDir(directory), [path.basename(file)]);
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
      const run = await runWriter(['--yes', ...attestAll('pass')], env);
      assert.equal(run.status, 0, `${name}: ${run.out}`);
      assert.ok(fs.existsSync(recordFile), `${name}: the writer wrote ${recordFile}`);
      const gate = runGate(release.pointerBody, env);
      assert.equal(gate.status, 0, `${name}: ${gate.out}`);
      assert.ok(gate.out.includes(`record_sha256=${sha256(fs.readFileSync(recordFile))}`), `${name}: the gate read the file the writer wrote`);
    }
  });
});
