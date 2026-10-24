'use strict';

/**
 * kosmos#6620 (O04-5): the fleet's update pause, the board half, on the Mac path. engine/manifest-verify.js asks the
 * coordinator's /v1/meta before run-setup installs a newer version, and holds back (exit 96, the installer not run)
 * while it answers "updates_paused": true. It fails open, asks nothing under test unless a test names the address,
 * and KOSMOS_UPDATE_IGNORE_PAUSE=1 skips it. The Windows path (win32update.begin) is covered in
 * engine/win32connectupdate.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const mv = require('./engine/manifest-verify.js');
const VERIFIER = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-updpause-6620-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A coordinator /v1/meta answer on disk, as a file:// address. */
function meta(body) {
  const f = path.join(tmp, 'meta-' + crypto.randomBytes(4).toString('hex') + '.json');
  fs.writeFileSync(f, body);
  return 'file://' + f;
}

test('pauseUrl: the default coordinator, a named one, nothing under test, nothing when told to ignore', () => {
  assert.equal(mv.pauseUrl({ NODE_TEST_CONTEXT: 'child' }), null, 'a test that names no address asks nothing');
  assert.equal(mv.pauseUrl({ NODE_TEST_CONTEXT: 'child', KOSMOS_UPDATE_PAUSE_URL: 'file:///x' }), 'file:///x');
  assert.equal(mv.pauseUrl({ KOSMOS_UPDATE_IGNORE_PAUSE: '1', KOSMOS_UPDATE_PAUSE_URL: 'file:///x' }), null);
});

test('pauseUrl: the default is the same coordinator remote access uses (engine/remote.js), and a test env of its own asks nothing', () => {
  const remote = fs.readFileSync(path.join(__dirname, 'engine', 'remote.js'), 'utf8').match(/const DEFAULT_COORDINATOR = '([^']+)'/);
  assert.ok(remote, 'engine/remote.js no longer names DEFAULT_COORDINATOR this way; re-pin this test');
  assert.equal(mv.PAUSE_DEFAULT_COORDINATOR, remote[1]);
  // Outside a test runner (a child without NODE_TEST_CONTEXT), the address is built from the default or the override.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const ask = (e) => spawnSync(process.execPath, ['-e', 'process.stdout.write(String(require(process.argv[1]).pauseUrl(JSON.parse(process.argv[2]))))',
    path.join(__dirname, 'engine', 'manifest-verify.js'), JSON.stringify(e)], { encoding: 'utf8', env }).stdout;
  assert.equal(ask({}), remote[1] + '/v1/meta');
  assert.equal(ask({ AGENT_WORKFORCE_TUNNEL_COORDINATOR: 'https://c.example/' }), 'https://c.example/v1/meta');
  // Under this test runner, an env handed in WITHOUT NODE_TEST_CONTEXT still asks nothing (review 1).
  assert.equal(mv.pauseUrl({ LOCALAPPDATA: 'x' }), null);
  assert.equal(mv.pauseUrl({ KOSMOS_UPDATE_PAUSE_URL: 'file:///y' }), 'file:///y', 'a named address still wins');
});

test('pausedIn: only an object whose updates_paused is exactly true', () => {
  assert.equal(mv.pausedIn('{"updates_paused":true}'), true);
  assert.equal(mv.pausedIn('{"build":"x","updates_paused": true}'), true);
  for (const body of ['{"updates_paused":false}', '{"updates_paused":"true"}', '{"updates_paused":1}', '{}', 'null', '<html>', '']) {
    assert.equal(mv.pausedIn(body), false, body);
  }
});

test('pausedSync: reads the named address, and fails open on no answer', () => {
  assert.equal(mv.pausedSync({ env: { KOSMOS_UPDATE_PAUSE_URL: meta('{"updates_paused":true}') } }), true);
  assert.equal(mv.pausedSync({ env: { KOSMOS_UPDATE_PAUSE_URL: meta('{"updates_paused":false}') } }), false);
  assert.equal(mv.pausedSync({ env: { KOSMOS_UPDATE_PAUSE_URL: 'file://' + path.join(tmp, 'missing.json') } }), false, 'no answer is not paused');
  // Under test with no address named, nothing is asked at all (a spawn that throws proves it was not called).
  assert.equal(mv.pausedSync({ env: { NODE_TEST_CONTEXT: 'child' }, spawnSync: () => { throw new Error('asked'); } }), false);
});

test('pausedAsync: the Windows form reads through fetch, and fails open on a throw, a non-200 or no field', async () => {
  const answer = (body, ok = true) => async () => ({ ok, text: async () => body });
  const env = { KOSMOS_UPDATE_PAUSE_URL: 'https://pause.invalid/v1/meta' };
  assert.equal(await mv.pausedAsync({ env, fetchImpl: answer('{"updates_paused":true}') }), true);
  assert.equal(await mv.pausedAsync({ env, fetchImpl: answer('{"updates_paused":false}') }), false);
  assert.equal(await mv.pausedAsync({ env, fetchImpl: answer('{"updates_paused":true}', false) }), false, 'a non-200 is not paused');
  assert.equal(await mv.pausedAsync({ env, fetchImpl: async () => { throw new Error('down'); } }), false);
  assert.equal(await mv.pausedAsync({ env, fetchImpl: answer('{}') }), false, 'an older coordinator is not paused');
});

/** A release host and an installed home (as install.setup-sig-6468.test.js builds them), then run-setup. */
function host(version) {
  const root = fs.mkdtempSync(path.join(tmp, 'host-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  const setupBody = 'echo ran-setup > "$MARK"\n';
  fs.writeFileSync(path.join(root, 'setup'), setupBody);
  const m = { manifest: 1, version, arch: 'arm64', files: [], setup_sha256: sha(Buffer.from(setupBody)) };
  const mp = path.join(dist, `kosmos-${version}-arm64.manifest.json`);
  fs.writeFileSync(mp, JSON.stringify(m) + '\n');
  fs.writeFileSync(mp + '.sig', crypto.sign(null, fs.readFileSync(mp), privateKey).toString('base64') + '\n');
  return { dist, setup: path.join(root, 'setup') };
}
function home(version) {
  const h = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(h, 'app', 'engine'), { recursive: true });
  const pinned = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = [${JSON.stringify(PUB)}];`);
  assert.notEqual(pinned, VERIFIER, 'the KEYS list moved; this fixture cannot pin its key');
  fs.writeFileSync(path.join(h, 'app', 'engine', 'manifest-verify.js'), pinned);
  fs.writeFileSync(path.join(h, 'app', 'package.json'), JSON.stringify({ version }) + '\n');
  return h;
}
function runSetup(extraEnv) {
  const h = home('1.2.0');
  const hst = host('1.2.3');
  const mark = path.join(tmp, 'mark-' + crypto.randomBytes(4).toString('hex'));
  const r = spawnSync(process.execPath, [path.join(h, 'app', 'engine', 'manifest-verify.js'), 'run-setup',
    'file://' + hst.setup, 'file://' + hst.dist, '1.2.3', h], { encoding: 'utf8', env: { ...process.env, MARK: mark, ...extraEnv } });
  return { code: r.status, err: r.stderr, ran: fs.existsSync(mark) };
}

test('run-setup: paused, the installer is NOT run and the exit is 96 (tried again later); CONTROL: not paused, it runs', () => {
  const held = runSetup({ KOSMOS_UPDATE_PAUSE_URL: meta('{"updates_paused":true}') });
  assert.equal(held.code, mv.NOT_FETCHED, held.err);
  assert.equal(held.ran, false, 'the installer ran during a pause');
  assert.ok(held.err.includes(mv.PAUSED_SENTENCE), held.err);
  const control = runSetup({ KOSMOS_UPDATE_PAUSE_URL: meta('{"updates_paused":false}') });
  assert.equal(control.code, 0, control.err);
  assert.equal(control.ran, true, 'CONTROL: the same install, not paused, runs');
});

test('run-setup: an unreachable coordinator does not hold the update (fail open), and the override skips a pause', () => {
  const open = runSetup({ KOSMOS_UPDATE_PAUSE_URL: 'file://' + path.join(tmp, 'no-meta-here.json') });
  assert.equal(open.code, 0, open.err);
  assert.equal(open.ran, true);
  const forced = runSetup({ KOSMOS_UPDATE_PAUSE_URL: meta('{"updates_paused":true}'), KOSMOS_UPDATE_IGNORE_PAUSE: '1' });
  assert.equal(forced.code, 0, forced.err);
  assert.equal(forced.ran, true, 'the operator override installs during a pause');
});
