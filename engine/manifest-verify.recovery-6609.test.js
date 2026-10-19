'use strict';
/**
 * #6609: the release recovery key's key list, phase 1 (the checks; wiring them into every update path is phase 2).
 * Throwaway keys throughout: a recovery key, two release keys, and a stranger's key.
 *   node --test engine/manifest-verify.recovery-6609.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const mv = require('./manifest-verify');

const spki = (k) => k.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const pem = (k) => k.privateKey.export({ format: 'pem', type: 'pkcs8' });
const recovery = crypto.generateKeyPairSync('ed25519');
const stranger = crypto.generateKeyPairSync('ed25519');
const rel1 = crypto.generateKeyPairSync('ed25519');
const rel2 = crypto.generateKeyPairSync('ed25519');
const RK = [spki(recovery)];

function list(obj, by = recovery) {
  const bytes = Buffer.from(JSON.stringify(obj));
  return { bytes, sig: crypto.sign(null, bytes, by.privateKey).toString('base64') };
}
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rk-6609-'));

test('#6609: no recovery key set (as shipped today): the built-in KEYS decide, and no list is needed', () => {
  assert.deepEqual(mv.RECOVERY_KEYS, [], 'shipping a recovery key turns the feature on; that is its own reviewed change');
  const r = mv.trustedKeys({ listBytes: null, listSig: null, home: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.keys, mv.KEYS);
});

test('#6609: a list the recovery key signed is taken, its keys are the trusted ones, and its seq is stored', () => {
  const h = home();
  const l = list({ release_keys: [spki(rel1)], seq: 3 });
  const r = mv.trustedKeys({ listBytes: l.bytes, listSig: l.sig, home: h, recoveryKeys: RK });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.keys, [spki(rel1)]);
  assert.equal(mv.storedKeyListSeq(h), 3);
  assert.equal((fs.statSync(path.join(h, mv.KEY_LIST_STATE)).mode & 0o777), 0o600);
});

test('#6609: refused: a list signed by another key, a tampered list, no list, no signature', () => {
  const good = list({ release_keys: [spki(rel1)], seq: 1 });
  const cases = [
    ['signed by a stranger (a stolen release key cannot sign a list)', list({ release_keys: [spki(rel1)], seq: 1 }, stranger), /not signed by the Kosmos recovery key/],
    ['one byte changed after signing', { bytes: Buffer.concat([good.bytes, Buffer.from(' ')]), sig: good.sig }, /not signed by the Kosmos recovery key/],
    ['no signature', { bytes: good.bytes, sig: '' }, /not signed by the Kosmos recovery key/],
  ];
  for (const [label, l, why] of cases) {
    const r = mv.trustedKeys({ listBytes: l.bytes, listSig: l.sig, home: home(), recoveryKeys: RK });
    assert.equal(r.ok, false, label);
    assert.match(r.why, why, label);
  }
  assert.equal(mv.trustedKeys({ listBytes: null, listSig: null, home: home(), recoveryKeys: RK }).ok, false, 'on, a missing list is not a pass');
});

test('#6609: an older list served again cannot bring a revoked key back; a newer one moves the stored seq on', () => {
  const h = home();
  const v1 = list({ release_keys: [spki(rel1), spki(rel2)], seq: 1 });
  const v2 = list({ release_keys: [spki(rel2)], seq: 2 });          // rel1 revoked
  assert.equal(mv.trustedKeys({ listBytes: v1.bytes, listSig: v1.sig, home: h, recoveryKeys: RK }).ok, true);
  const r2 = mv.trustedKeys({ listBytes: v2.bytes, listSig: v2.sig, home: h, recoveryKeys: RK });
  assert.deepEqual(r2.keys, [spki(rel2)]);
  assert.equal(mv.storedKeyListSeq(h), 2);
  const back = mv.trustedKeys({ listBytes: v1.bytes, listSig: v1.sig, home: h, recoveryKeys: RK });
  assert.equal(back.ok, false);
  assert.match(back.why, /older than the 2 this copy has taken/);
  // The same seq again is fine (every update fetches it).
  assert.equal(mv.trustedKeys({ listBytes: v2.bytes, listSig: v2.sig, home: h, recoveryKeys: RK }).ok, true);
  assert.equal(mv.storedKeyListSeq(h), 2);
});

test('#6609: a revoked key no longer opens a release: verify() with the list keys refuses its manifest', () => {
  const d = home();
  const manifest = path.join(d, 'm.json'); const sig = path.join(d, 'm.sig');
  const bytes = Buffer.from(JSON.stringify({ version: '0.7.70', sha256: 'x' }));
  fs.writeFileSync(manifest, bytes);
  fs.writeFileSync(sig, crypto.sign(null, bytes, rel1.privateKey).toString('base64'));
  const before = mv.verify({ manifest, sig, tarball: null, stage: '-', version: '0.7.70', installedVersion: '0.7.60', keys: [spki(rel1)], skipTarball: true });
  assert.equal(before.code, 0, 'CONTROL: rel1 opens it while trusted: ' + before.why);
  const after = mv.verify({ manifest, sig, tarball: null, stage: '-', version: '0.7.70', installedVersion: '0.7.60', keys: [spki(rel2)], skipTarball: true });
  assert.equal(after.code, 1);
  assert.match(after.why, /not signed by the Kosmos release key/);
});

test('#6609: malformed lists are refused even when properly signed', () => {
  const bad = [
    ['no keys', { release_keys: [], seq: 1 }, /names no release key/],
    ['keys not a list', { release_keys: spki(rel1), seq: 1 }, /names no release key/],
    ['a duplicate key', { release_keys: [spki(rel1), spki(rel1)], seq: 1 }, /not one/],
    ['a key that is not Ed25519', { release_keys: [crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64')], seq: 1 }, /not one/],
    ['seq 0', { release_keys: [spki(rel1)], seq: 0 }, /no sequence number/],
    ['seq not a whole number', { release_keys: [spki(rel1)], seq: 1.5 }, /no sequence number/],
    ['seq as text', { release_keys: [spki(rel1)], seq: '2' }, /no sequence number/],
  ];
  for (const [label, obj, why] of bad) {
    const l = list(obj);
    const r = mv.verifyKeyList({ bytes: l.bytes, sig: l.sig, recoveryKeys: RK });
    assert.equal(r.ok, false, label);
    assert.match(r.why, why, label);
  }
});

test('#6609: the signing tool writes a list the installed check accepts, reading the private key from stdin only', () => {
  const out = home();
  const tool = path.join(__dirname, '..', 'tools', 'lib', 'release-keys-sign.js');
  const r = spawnSync(process.execPath, [tool, '1', out, spki(rel1), spki(rel2)], { input: pem(recovery), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp('signed by recovery key ' + RK[0].replace(/[+/=]/g, '\\$&')));
  const bytes = fs.readFileSync(path.join(out, 'release-keys.json'));
  const sig = fs.readFileSync(path.join(out, 'release-keys.json.sig'), 'utf8');
  const v = mv.verifyKeyList({ bytes, sig, recoveryKeys: RK });
  assert.equal(v.ok, true, v.why);
  assert.deepEqual(v.keys, [spki(rel1), spki(rel2)]);
  assert.deepEqual(fs.readdirSync(out).sort(), ['release-keys.json', 'release-keys.json.sig'], 'nothing else written, the private key least of all');
  // Refusals: not a private key, a bad seq, a duplicate.
  assert.equal(spawnSync(process.execPath, [tool, '2', out, spki(rel1)], { input: 'not a key', encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [tool, '0', out, spki(rel1)], { input: pem(recovery), encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [tool, '2', out, spki(rel1), spki(rel1)], { input: pem(recovery), encoding: 'utf8' }).status, 1);
});
