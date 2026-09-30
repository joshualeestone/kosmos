'use strict';
/**
 * #4632: the catalogue is downloaded when someone opens the role picker or the Team screen, kept
 * only when its signature verifies, and never replaced by an older one.
 *
 *   node --test engine/catalogue.download-4632.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-download-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const catalogue = require('./catalogue');
const roles = require('./roles');
const { FIXTURE } = require('../test-support/catalogue-fixture');

const TEXT = fs.readFileSync(FIXTURE, 'utf8');
const BUILT_IN = roles.BUILT_IN.length;

/** A fresh key pair the module trusts, a clean store, and a signer for payloads. */
function fresh() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  catalogue.useKeyForTest(pem);
  fs.rmSync(path.dirname(catalogue.cacheFile()), { recursive: true, force: true });
  roles.remerge();
  const signed = (serial, text = TEXT) => {
    const body = text.replace(/"serial": \d+/, `"serial": ${serial}`);
    return { body, sig: crypto.sign(null, Buffer.from(body), privateKey).toString('base64') };
  };
  return { signed, privateKey, pem };
}

/** A fetch that serves one payload and counts what it was asked for. */
function server(payload, opts = {}) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (opts.fail) throw new Error('network down');
    if (opts.status) return new Response('nope', { status: opts.status });
    const body = url.endsWith('.sig') ? payload.sig : payload.body;
    return new Response(body, { status: 200 });
  };
  return { fetcher, calls };
}

test('with nothing downloaded yet there is no catalogue: the built-in roles only, and no teams', () => {
  fresh();
  assert.deepEqual(catalogue.status(), { loaded: false, serial: null, roles: 0, teams: 0, error: null });
  assert.equal(roles.ROLES.length, BUILT_IN);
  assert.deepEqual(catalogue.teams(), []);
  assert.match(catalogue.memberProblem('marketing', 'lead'), /no prebuilt team/);
});

test('a download that verifies is stored and merged: the picker gains its roles, the Team screen its teams', async () => {
  const { signed } = fresh();
  const { fetcher, calls } = server(signed(10));
  const st = await catalogue.refresh({ fetcher });
  assert.equal(st.loaded, true, st.error);
  assert.equal(st.serial, 10);
  assert.deepEqual(calls.map((u) => u.replace(/^.*\//, '')).sort(), ['catalogue.json', 'catalogue.json.sig']);
  assert.ok(calls.every((u) => u.startsWith('https://installkosmos.com/catalogue/')), calls.join(' '));
  assert.equal(roles.ROLES.length, BUILT_IN + st.roles);
  assert.ok(roles.byKey('cmo'), 'a catalogue role reached ROLES');
  assert.equal(catalogue.teams().length, st.teams);
  assert.ok(fs.existsSync(catalogue.cacheFile()));
  // Within the gap, a second open does not download again.
  await catalogue.refresh({ fetcher });
  assert.equal(calls.length, 2);
});

test('a changed byte, another key, or a catalogue this version cannot read is refused, and nothing is stored', async () => {
  const { signed } = fresh();
  const good = signed(10);
  const cases = {
    tampered: { body: good.body.replace('Chief of Staff', 'Chief 0f Staff'), sig: good.sig },
    otherKey: { body: good.body, sig: crypto.sign(null, Buffer.from(good.body), crypto.generateKeyPairSync('ed25519').privateKey).toString('base64') },
    newFormat: signed(10, TEXT.replace('"version": 2', '"version": 3')),
    noSerial: signed(0),
  };
  for (const [name, payload] of Object.entries(cases)) {
    const st = await catalogue.refresh({ fetcher: server(payload).fetcher, force: true });
    assert.equal(st.loaded, false, name);
    assert.match(st.error, /was refused/, name);
    assert.equal(fs.existsSync(catalogue.cacheFile()), false, `${name}: stored`);
  }
  assert.equal(roles.ROLES.length, BUILT_IN);
  // CONTROL: the untouched payload is accepted by the same path.
  assert.equal((await catalogue.refresh({ fetcher: server(good).fetcher, force: true })).loaded, true);
});

test('an older catalogue never replaces the one held; a newer one does', async () => {
  const { signed } = fresh();
  await catalogue.refresh({ fetcher: server(signed(20)).fetcher, force: true });
  const older = await catalogue.refresh({ fetcher: server(signed(19)).fetcher, force: true });
  assert.equal(older.serial, 20);
  assert.match(older.error, /older than the one held/);
  const newer = await catalogue.refresh({ fetcher: server(signed(21)).fetcher, force: true });
  assert.equal(newer.serial, 21);
  assert.equal(newer.error, null);
});

test('offline, a missing file or an oversized one keeps what is held and says why', async () => {
  const { signed } = fresh();
  await catalogue.refresh({ fetcher: server(signed(30)).fetcher, force: true });
  for (const opts of [{ fail: true }, { status: 404 }]) {
    const st = await catalogue.refresh({ fetcher: server(signed(31), opts).fetcher, force: true });
    assert.equal(st.serial, 30);
    assert.ok(st.error, JSON.stringify(opts));
  }
  const huge = { body: 'x'.repeat(8 * 1024 * 1024 + 1), sig: 'AA==' };
  const st = await catalogue.refresh({ fetcher: server(huge).fetcher, force: true });
  assert.equal(st.serial, 30);
  assert.match(st.error, /larger than/);
  assert.ok(roles.byKey('cmo'), 'the held catalogue was dropped');
});

test('a file and signature from different publishes (caches out of step) are asked for once more, past the caches', async () => {
  const { signed } = fresh();
  const now = signed(60);
  const stale = signed(59);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const fresh2 = url.includes('?fresh=');
    if (url.includes('.sig')) return new Response(fresh2 ? now.sig : stale.sig);
    return new Response(now.body);
  };
  const st = await catalogue.refresh({ fetcher, force: true });
  assert.equal(st.serial, 60, st.error);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((u) => u.includes('?fresh=')).length, 2);
  // CONTROL: a signature that is still wrong after the second ask is refused.
  const bad = await catalogue.refresh({ fetcher: server({ body: signed(61).body, sig: stale.sig }).fetcher, force: true });
  assert.equal(bad.serial, 60);
  assert.match(bad.error, /signature does not verify/);
});

test('two opens at once download once', async () => {
  const { signed } = fresh();
  const { fetcher, calls } = server(signed(40));
  const [a, b] = await Promise.all([catalogue.refresh({ fetcher, force: true }), catalogue.refresh({ fetcher, force: true })]);
  assert.equal(a.serial, 40);
  assert.equal(b.serial, 40);
  assert.equal(calls.length, 2);
});

test('a stored copy changed on disk is not used after a restart, and one left alone is', async () => {
  const { signed, pem } = fresh();
  await catalogue.refresh({ fetcher: server(signed(50)).fetcher, force: true });
  // What a restart does: forget the parsed copy and read the store again, with the same key.
  catalogue.useKeyForTest(pem);
  assert.equal(catalogue.status().serial, 50, 'CONTROL: the untouched store is used after a restart');
  const file = catalogue.cacheFile();
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.text = stored.text.replace('Chief of Staff', 'Chief 0f Staff');
  fs.writeFileSync(file, JSON.stringify(stored));
  catalogue.useKeyForTest(pem);
  const st = catalogue.status();
  assert.equal(st.loaded, false);
  assert.match(st.error, /stored catalogue was not used: its signature does not verify/);
  roles.remerge();
  assert.equal(roles.ROLES.length, BUILT_IN);
});

test('the key this version trusts is an Ed25519 public key', () => {
  assert.equal(crypto.createPublicKey(catalogue.PUBLIC_KEY).asymmetricKeyType, 'ed25519');
});

test('the catalogue was checked against the roles this version has built in', () => {
  // The catalogue repo keeps a copy of Kosmos's built-in role keys (kosmos-builtin-roles.json) and
  // names them in every build as kosmosRoles. When roles.js gains, loses or renames one, this fails:
  // update that list in joshualeestone/kosmos-catalogue and refresh test-support/catalogue-fixture.json.
  const listed = JSON.parse(TEXT).kosmosRoles;
  assert.deepEqual(listed, roles.BUILT_IN.map((r) => r.key).sort());
});
