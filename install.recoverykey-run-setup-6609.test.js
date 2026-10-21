'use strict';

/**
 * #6609 phase 2a: with a recovery key pinned, `run-setup` (what the in-app update and `kosmos update` run) takes the
 * release key list FIRST and checks the installer's manifest with the list's keys. No list, no update.
 *
 * End to end over a file:// release base, with an installed copy of the verifier whose KEYS and RECOVERY_KEYS are
 * rewritten to throwaway keys (the install.setup-sig-6468.test.js pattern). Off as shipped: the shipped copy fetches
 * no list.
 *
 *   node --test install.recoverykey-run-setup-6609.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { NOT_RUN, NOT_FETCHED, KEY_LIST_STATE, KEY_LIST_TYPE } = require('./engine/manifest-verify.js');
const VERIFIER = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
const pair = () => { const k = crypto.generateKeyPairSync('ed25519'); return { priv: k.privateKey, pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }; };
const RELEASE = pair();      // signs the release
const OTHER = pair();        // a release key the list does not name
const RECOVERY = pair();     // signs the key list
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-rk-runsetup-6609-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A release host for `version` signed by `by`, with the key list (or none) beside the manifests. */
function host(version, { by = RELEASE, list = { seq: 1, keys: [RELEASE.pub] }, listBy = RECOVERY } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'host-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  const setupBody = 'echo ran-setup > "$MARK"\n';
  fs.writeFileSync(path.join(root, 'setup'), setupBody);
  const mp = path.join(dist, `kosmos-${version}-arm64.manifest.json`);
  fs.writeFileSync(mp, JSON.stringify({ manifest: 1, version, arch: 'arm64', files: [], setup_sha256: sha(Buffer.from(setupBody)) }) + '\n');
  fs.writeFileSync(mp + '.sig', crypto.sign(null, fs.readFileSync(mp), by.priv).toString('base64') + '\n');
  if (list) {
    const lp = path.join(dist, 'release-keys.json');
    fs.writeFileSync(lp, JSON.stringify({ type: KEY_LIST_TYPE, seq: list.seq, release_keys: list.keys }) + '\n');
    fs.writeFileSync(lp + '.sig', crypto.sign(null, fs.readFileSync(lp), listBy.priv).toString('base64') + '\n');
  }
  return { root, dist, setup: path.join(root, 'setup') };
}
/** An installed home whose verifier pins the throwaway release key, and the recovery key when `on`. */
function home(version, { on = true } = {}) {
  const h = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(h, 'app', 'engine'), { recursive: true });
  let v = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = [${JSON.stringify(RELEASE.pub)}, ${JSON.stringify(OTHER.pub)}];`);
  assert.notEqual(v, VERIFIER, 'the KEYS list moved; this fixture cannot pin its key');
  if (on) {
    const was = v;
    v = v.replace('const RECOVERY_KEYS = Object.freeze([]);', `const RECOVERY_KEYS = Object.freeze([${JSON.stringify(RECOVERY.pub)}]);`);
    assert.notEqual(v, was, 'the RECOVERY_KEYS line moved; this fixture cannot turn the check on');
  }
  fs.writeFileSync(path.join(h, 'app', 'engine', 'manifest-verify.js'), v);
  fs.writeFileSync(path.join(h, 'app', 'package.json'), JSON.stringify({ version }) + '\n');
  return h;
}
function runSetup(h, hst, version) {
  const mark = path.join(tmp, 'mark-' + crypto.randomBytes(4).toString('hex'));
  const r = spawnSync(process.execPath, [path.join(h, 'app', 'engine', 'manifest-verify.js'), 'run-setup',
    'file://' + hst.setup, 'file://' + hst.dist, version, h], { encoding: 'utf8', env: { ...process.env, MARK: mark } });
  return { code: r.status, err: r.stderr, ran: fs.existsSync(mark) };
}
const recorded = (h) => { try { return fs.readdirSync(path.join(h, KEY_LIST_STATE)).filter((f) => /^seq-/.test(f)).sort(); } catch { return []; } };

test('on: a list from the recovery key naming the release key is taken first, recorded, and the installer runs', () => {
  const h = home('1.2.0');
  const r = runSetup(h, host('1.2.3'), '1.2.3');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.ran, true);
  assert.deepEqual(recorded(h), ['seq-1.json'], 'this copy recorded the list it took');
});

test('on: no list served is no update (a retry can succeed), and nothing runs', () => {
  const r = runSetup(home('1.2.0'), host('1.2.3', { list: null }), '1.2.3');
  assert.equal(r.code, NOT_FETCHED, r.err);
  assert.equal(r.ran, false);
  assert.match(r.err, /the release key list could not be downloaded/);
});

test('on: a list that does not verify is not run and is RETRIED (96): a torn pair looks the same (review 1)', () => {
  const r = runSetup(home('1.2.0'), host('1.2.3', { listBy: OTHER }), '1.2.3');
  assert.equal(r.code, NOT_FETCHED, r.err);
  assert.equal(r.ran, false);
  assert.match(r.err, /not signed by the Kosmos recovery key/);
});

test('on: the manifest is checked with the LIST\'s keys: a release by a built-in key the list dropped is refused', () => {
  // OTHER is built into this copy's KEYS, so with the check off it would open; the list names only RELEASE.
  const h = home('1.2.0');
  const r = runSetup(h, host('1.2.3', { by: OTHER }), '1.2.3');
  assert.equal(r.code, NOT_RUN, r.err);
  assert.equal(r.ran, false);
  const off = runSetup(home('1.2.0', { on: false }), host('1.2.3', { by: OTHER }), '1.2.3');
  assert.equal(off.code, 0, 'CONTROL: off, the built-in key still opens it: ' + off.err);
});

test('on: an older list after a newer one was taken is refused (the revocation holds)', () => {
  const h = home('1.2.0');
  assert.equal(runSetup(h, host('1.2.3', { list: { seq: 2, keys: [RELEASE.pub] } }), '1.2.3').code, 0);
  const r = runSetup(h, host('1.2.4', { list: { seq: 1, keys: [RELEASE.pub, OTHER.pub] } }), '1.2.4');
  assert.equal(r.code, NOT_RUN, r.err);
  assert.equal(r.ran, false);
  assert.match(r.err, /older than the 2 this copy has taken/);
});

test('off (as shipped): no list is fetched, a missing or bad one changes nothing, and the record is not started', () => {
  for (const hst of [host('1.2.3', { list: null }), host('1.2.3', { listBy: OTHER })]) {
    const h = home('1.2.0', { on: false });
    const r = runSetup(h, hst, '1.2.3');
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(recorded(h), [], 'off writes no record');
  }
  assert.match(VERIFIER, /const RECOVERY_KEYS = Object\.freeze\(\[\]\);/, 'CONTROL: the shipped copy is off');
});

test('on: a torn pair (the list from one publish, the signature from another) is retried, not refused', () => {
  const hst = host('1.2.3', { list: { seq: 2, keys: [RELEASE.pub] } });
  const older = host('1.2.3', { list: { seq: 1, keys: [RELEASE.pub] } });
  fs.copyFileSync(path.join(older.dist, 'release-keys.json.sig'), path.join(hst.dist, 'release-keys.json.sig'));
  const r = runSetup(home('1.2.0'), hst, '1.2.3');
  assert.equal(r.code, NOT_FETCHED, r.err);
  assert.equal(r.ran, false);
});

test('on: over https both list downloads carry one fresh query, and file:// carries none', () => {
  const h = home('1.2.0');
  const mv = require(path.join(h, 'app', 'engine', 'manifest-verify.js'));
  const urls = (base) => {
    const seen = [];
    // A curl that "downloads" empty files: the list and its signature are both asked for, then the empty list fails to
    // verify, so nothing else is fetched and nothing runs.
    mv.runSetup({ setupUrl: base + '/setup', base, version: '1.2.3', home: h, spawnSync: (cmd, args) => { seen.push(args[args.length - 3]); fs.writeFileSync(args[args.length - 1], ''); return { status: 0 }; } });
    return seen;
  };
  const web = urls('https://example.test/dist');
  assert.match(web[0], /^https:\/\/example\.test\/dist\/release-keys\.json\?r=[0-9a-f]{16}$/, 'the list is asked for first: ' + web.join(' '));
  assert.equal(web[1], web[0].replace('release-keys.json?', 'release-keys.json.sig?'), 'the signature with the same query');
  assert.equal(web.length, 2, 'nothing else is fetched once the list fails');
  const again = urls('https://example.test/dist');
  assert.notEqual(again[0], web[0], 'a retry asks with a new query');
  assert.deepEqual(urls('file:///tmp/dist'), ['file:///tmp/dist/release-keys.json', 'file:///tmp/dist/release-keys.json.sig']);
});
