'use strict';
require('../test-support/tmpscope');   // kosmos#4273: every temp folder this file makes is removed when it exits
/*
 * kosmos#6596 step 8: the board trusts the coordinator keys the tunnel trusts (engine/trustkeys.js, the rule of
 * kosmos-relay crates/tunnel/src/trust.rs trusted_keys), checks a company policy against them, and its wipes of the
 * tunnel state folder keep the tunnel's trust files. Every arm has a control that gives the other answer.
 *   node --test engine/trustkeys-6596.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), 'trustkeys-' + name + '-'));
process.env.AGENT_WORKFORCE_DATA = tmp('data');
const TUNNEL = tmp('tunnel');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = TUNNEL;
process.env.HOME = tmp('home');

const servicekeys = require('./servicekeys');
const trustkeys = require('./trustkeys');
const kst1 = require('./kst1');
const orgpolicy = require('./orgpolicy');

const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const keyFromSeed = (byte) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, byte)]), format: 'der', type: 'pkcs8' });
const spkiOf = (priv) => crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).toString('base64');
const pinOf = (priv) => crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');

const ROOT = keyFromSeed(0x09);
const ROOT_PUB = spkiOf(ROOT);
const OLD = keyFromSeed(0x21);   // the key pinned at setup
const NEW = keyFromSeed(0x22);   // the key a rotation moves to
const STRANGER = keyFromSeed(0x23);

/* A set listing `keys` ([priv, role]), signed by `signer`, as the tunnel stores it. */
function setDoc(keys, { seq = 1 } = {}) {
  return JSON.stringify({
    type: servicekeys.SERVICE_KEYS_TYPE,
    service_keys: keys.map(([k, role]) => {
      const pub = spkiOf(k);
      return { kid: servicekeys.kidOf(servicekeys.rawKey(pub)), pub, role };
    }),
    seq,
    issued: '2026-10-24',
  });
}
const signed = (document, signer = ROOT) => ({ document, signature: crypto.sign(null, Buffer.from(document), signer).toString('base64') });
function stateWith(store) {
  const d = tmp('state');
  if (store !== undefined) fs.writeFileSync(path.join(d, trustkeys.STORE_FILE), typeof store === 'string' || Buffer.isBuffer(store) ? store : JSON.stringify(store));
  return d;
}
const ON = { recoveryKeys: [ROOT_PUB] };

test('CONTROL: the fixtures are what the relay would accept', () => {
  const s = signed(setDoc([[NEW, 'current'], [OLD, 'retiring']]));
  const v = servicekeys.verifyServiceKeySet({ bytes: s.document, sig: s.signature, recoveryKeys: [ROOT_PUB] });
  assert.equal(v.ok, true, v.why);
  assert.equal(v.keys.length, 2);
});

test('off as shipped: the pin alone, and the store is not even read', () => {
  const d = stateWith('not json at all');
  assert.deepEqual(trustkeys.trustedKeys(d, pinOf(OLD)), { keys: [pinOf(OLD)], fault: null }, 'the shipped (empty) recovery keys');
  assert.deepEqual(trustkeys.trustedKeys(d, pinOf(OLD), { recoveryKeys: [] }), { keys: [pinOf(OLD)], fault: null }, 'an empty list');
  // CONTROL: the same damaged store with a root is a fault, so "not read" above is observed, not assumed.
  assert.equal(trustkeys.trustedKeys(d, pinOf(OLD), ON).fault, 'unusable');
});

test('on, with no store: the pin alone; with no pin either: no key', () => {
  assert.deepEqual(trustkeys.trustedKeys(stateWith(), pinOf(OLD), ON), { keys: [pinOf(OLD)], fault: null });
  assert.deepEqual(trustkeys.trustedKeys(stateWith(), null, ON), { keys: [], fault: null });
});

test('a held set that verifies: its keys, and the pin only while the set lists it', () => {
  const both = trustkeys.trustedKeys(stateWith(signed(setDoc([[NEW, 'current'], [OLD, 'retiring']]))), pinOf(OLD), ON);
  assert.deepEqual(both, { keys: [pinOf(NEW), pinOf(OLD)], fault: null }, 'the set names both');
  const dropped = trustkeys.trustedKeys(stateWith(signed(setDoc([[NEW, 'current']]))), pinOf(OLD), ON);
  assert.deepEqual(dropped, { keys: [pinOf(NEW)], fault: null }, 'the set dropped the pin: the pin is not trusted');
});

test('a store that is there and cannot be used trusts no key, never the pin', () => {
  const good = signed(setDoc([[NEW, 'current'], [OLD, 'retiring']]));
  const cases = [
    ['not text', Buffer.from([0x7b, 0xff, 0x7d])],
    ['not json', '{'],
    ['a list', '[]'],
    ['no signature', { document: good.document }],
    ['a signature that is not text', { document: good.document, signature: 7 }],
    ['a member named twice', '{"document":' + JSON.stringify(good.document) + ',"signature":' + JSON.stringify(good.signature) + ',"document":' + JSON.stringify(good.document) + '}'],
    ['signed by another key', signed(good.document, STRANGER)],
    ['a changed byte', { document: good.document.replace('"seq":1', '"seq":2'), signature: good.signature }],
  ];
  for (const [name, store] of cases) {
    const r = trustkeys.trustedKeys(stateWith(store), pinOf(OLD), ON);
    assert.equal(r.fault, 'unusable', name);
    assert.deepEqual(r.keys, [], name);
    assert.match(r.why, /^the service key set this computer holds /, name);
    assert.doesNotMatch(r.why, new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), name + ': no path in a reason the page can show');
  }
  // CONTROL: the good store, written the same way, is used.
  assert.equal(trustkeys.trustedKeys(stateWith(good), pinOf(OLD), ON).fault, null);
});

test('a store that cannot be read (not a missing one) trusts no key', () => {
  const d = tmp('state');
  fs.mkdirSync(path.join(d, trustkeys.STORE_FILE));   // reading a folder fails with EISDIR, not ENOENT
  const r = trustkeys.trustedKeys(d, pinOf(OLD), ON);
  assert.equal(r.fault, 'unreadable');
  assert.deepEqual(r.keys, []);
});

test('kst1: a list verifies when any key signed it; a single key still works', () => {
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'x', exp: 2_000_000_000 })).toString('base64url');
  const token = body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), NEW).toString('base64url');
  assert.equal(kst1.verify(token, pinOf(NEW), 'x', 1).ok, true, 'one key, as before');
  assert.equal(kst1.verify(token, [pinOf(OLD), pinOf(NEW)], 'x', 1).ok, true, 'the second of two');
  assert.equal(kst1.verify(token, [pinOf(OLD), 'junk', pinOf(NEW)], 'x', 1).ok, true, 'a junk entry is skipped, not fatal');
  assert.equal(kst1.verify(token, [pinOf(OLD)], 'x', 1).why, 'the signature does not verify', 'CONTROL: a list without it');
  assert.equal(kst1.verify(token, [], 'x', 1).why, 'no pinned coordinator key', 'an empty list');
  assert.equal(kst1.verify(token, ['junk'], 'x', 1).why, 'no pinned coordinator key', 'a list of nothing usable');
});

/* The company policy, end to end through orgpolicy.refresh against the tunnel state folder. */
const NOW = 1_800_000_000;
const POLICY = { providers_allowed: ['anthropic'] };
function bundle(signer) {
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version: 1, iat: NOW - 10, exp: NOW + 86400, policy: POLICY })).toString('base64url');
  return body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), signer).toString('base64url');
}
function tunnel({ store, token }) {
  for (const f of fs.readdirSync(TUNNEL)) fs.rmSync(path.join(TUNNEL, f), { recursive: true, force: true });
  fs.rmSync(orgpolicy.APPLIED(), { force: true });
  fs.writeFileSync(path.join(TUNNEL, 'coordinator_pubkey'), pinOf(OLD) + '\n');
  if (store) fs.writeFileSync(path.join(TUNNEL, trustkeys.STORE_FILE), JSON.stringify(store));
  fs.writeFileSync(orgpolicy.BUNDLE(), token);
}

test('a policy signed by the rotated-to key is applied once the tunnel holds the set naming it', () => {
  tunnel({ store: signed(setDoc([[NEW, 'current'], [OLD, 'retiring']])), token: bundle(NEW) });
  const r = orgpolicy.refresh({ now: NOW, recoveryKeys: [ROOT_PUB] });
  assert.equal(r.refused, null);
  assert.equal(r.applied && r.applied.org, 'org-1');
  // CONTROL: the same token with no set held (the pin alone) is refused.
  tunnel({ token: bundle(NEW) });
  assert.equal(orgpolicy.refresh({ now: NOW, recoveryKeys: [ROOT_PUB] }).refused, 'the signature does not verify');
  // And off (as shipped), even with the set held: the pin alone, as before.
  tunnel({ store: signed(setDoc([[NEW, 'current']])), token: bundle(NEW) });
  assert.equal(orgpolicy.refresh({ now: NOW }).refused, 'the signature does not verify');
});

test('a policy signed by the pin is refused once the set held dropped the pin', () => {
  tunnel({ store: signed(setDoc([[NEW, 'current']])), token: bundle(OLD) });
  assert.equal(orgpolicy.refresh({ now: NOW, recoveryKeys: [ROOT_PUB] }).refused, 'the signature does not verify');
  // CONTROL: while the set still lists it, the same policy is applied.
  tunnel({ store: signed(setDoc([[NEW, 'current'], [OLD, 'retiring']])), token: bundle(OLD) });
  assert.equal(orgpolicy.refresh({ now: NOW, recoveryKeys: [ROOT_PUB] }).refused, null);
});

test('a store the board cannot use is a local refusal, not one of what the company sent', () => {
  tunnel({ store: { document: 'x', signature: 'y' }, token: bundle(OLD) });
  const r = orgpolicy.refresh({ now: NOW, recoveryKeys: [ROOT_PUB] });
  assert.equal(r.local, true);
  assert.match(r.refused, /^no coordinator key is trusted: the service key set this computer holds no longer verifies/);
  assert.equal(r.applied, null, 'nothing applied');
});

test('the board\'s wipes of the tunnel state folder keep the tunnel\'s trust files and remove the rest', () => {
  const remote = require('./remote');
  const make = () => {
    for (const f of fs.readdirSync(TUNNEL)) fs.rmSync(path.join(TUNNEL, f), { recursive: true, force: true });
    for (const f of ['mac_id', 'mac_key', 'coordinator_pubkey', trustkeys.STORE_FILE, trustkeys.FLOOR_FILE, 'device_key']) fs.writeFileSync(path.join(TUNNEL, f), 'x');
    fs.writeFileSync(path.join(TUNNEL, trustkeys.LOCK_FILE), '');
    fs.mkdirSync(path.join(TUNNEL, 'other'));
  };
  make();
  remote.clearStateDir([]);
  assert.deepEqual(fs.readdirSync(TUNNEL).sort(), [...trustkeys.KEEP].sort(), 'only the trust files are left');
  make();
  remote.clearStateDir(['device_key']);
  assert.deepEqual(fs.readdirSync(TUNNEL).sort(), [...trustkeys.KEEP, 'device_key'].sort(), 'and a name the caller keeps');
  // Both wipes go through it: no other recursive removal of the whole state folder is left in remote.js.
  const src = fs.readFileSync(path.join(__dirname, 'remote.js'), 'utf8');
  assert.equal((src.match(/rmSync\(STATE_DIR\(\)/g) || []).length, 0, 'no rmSync of the whole folder');
  assert.equal((src.match(/clearStateDir\(/g) || []).length, 3, 'the definition and its two callers');
});

test('a recovery key that does not decode trusts no key, as the tunnel; the shipped list all decodes', () => {
  const pin = pinOf(OLD);
  const bad = trustkeys.trustedKeys(stateWith(), pin, { recoveryKeys: [ROOT_PUB, 'not-a-key'] });
  assert.equal(bad.fault, 'unusable', 'one bad root beside a good one');
  assert.deepEqual(bad.keys, []);
  assert.equal(trustkeys.trustedKeys(stateWith(), pin, { recoveryKeys: ['not-a-key'] }).fault, 'unusable', 'every root bad, no store: not the pin');
  assert.deepEqual(trustkeys.trustedKeys(stateWith(), pin, ON), { keys: [pin], fault: null }, 'CONTROL: good roots, no store: the pin');
  const { RECOVERY_KEYS } = require('./manifest-verify');
  for (const k of RECOVERY_KEYS) assert.ok(servicekeys.rawKey(k), 'a shipped recovery key decodes: ' + k);
});

test('the store is read as the tunnel reads it: the list form, unknown members ignored, document or signature twice refused', () => {
  const s = signed(setDoc([[NEW, 'current']]));
  const want = [pinOf(NEW)];
  const keysOf = (text) => trustkeys.trustedKeys(stateWith(text), pinOf(OLD), ON);
  assert.deepEqual(keysOf(JSON.stringify(s)).keys, want, 'CONTROL: the object form');
  assert.deepEqual(keysOf(JSON.stringify([s.document, s.signature])).keys, want, 'the two as a list');
  assert.equal(keysOf(JSON.stringify([s.document, s.signature, 'x'])).fault, 'unusable', 'a list of three');
  const extra = '{"note":{"k":1,"k":2},"document":' + JSON.stringify(s.document) + ',"signature":' + JSON.stringify(s.signature) + '}';
  assert.deepEqual(keysOf(extra).keys, want, 'a name twice inside an unknown member is ignored');
  const unknownTwice = '{"note":1,"note":2,"document":' + JSON.stringify(s.document) + ',"signature":' + JSON.stringify(s.signature) + '}';
  assert.deepEqual(keysOf(unknownTwice).keys, want, 'an unknown member named twice is ignored, as serde does');
  const sigTwice = '{"document":' + JSON.stringify(s.document) + ',"signature":' + JSON.stringify(s.signature) + ',"signature":' + JSON.stringify(s.signature) + '}';
  assert.equal(keysOf(sigTwice).fault, 'unusable', 'signature named twice');
  const twice = '{"document":' + JSON.stringify(s.document) + ',"document":' + JSON.stringify(s.document) + ',"signature":' + JSON.stringify(s.signature) + '}';
  assert.equal(keysOf(twice).fault, 'unusable', 'document named twice at the top');
  assert.equal(keysOf(twice).why, 'the service key set this computer holds does not parse', 'with a fixed reason, never a name from the file');
  const tricky = '{"note":"x,\\"signature\\":1}","document":' + JSON.stringify(s.document) + ',"signature":' + JSON.stringify(s.signature) + '}';
  assert.deepEqual(keysOf(tricky).keys, want, 'a comma, a quoted name and a brace inside a string are not members');
  const lone = '{"document":' + JSON.stringify(s.document) + ',"signature":' + JSON.stringify(s.signature).slice(0, -1) + '\\ud800"}';
  assert.equal(keysOf(lone).fault, 'unusable', 'a lone surrogate in a field, which serde refuses');
});

test('a lone surrogate in the document is refused, as serde refuses it, though the signature would pass', () => {
  // A signed set holding U+FFFD: the signature covers its UTF-8 bytes, EF BF BD.
  const doc = setDoc([[NEW, 'current']]).replace(/}$/, ',"x":"\ufffd"}');
  const s = signed(doc);
  const text = JSON.stringify(s);
  const keysOf = (t) => trustkeys.trustedKeys(stateWith(t), pinOf(OLD), ON);
  assert.deepEqual(keysOf(text).keys, [pinOf(NEW)], 'CONTROL: the set spelled as signed verifies');
  // The same character spelled as an escape of a lone surrogate: JSON.parse keeps it, and Buffer.from would turn it
  // back into EF BF BD, so only the surrogate check stands between this and a trusted key.
  const lone = text.replace('\ufffd', '\\ud800');
  assert.notEqual(lone, text, 'CONTROL: the escape is in the store');
  assert.equal(servicekeys.verifyServiceKeySet({ bytes: JSON.parse(lone).document, sig: s.signature, recoveryKeys: [ROOT_PUB] }).ok, true,
    'CONTROL: without the surrogate check the signature passes');
  const r = keysOf(lone);
  assert.equal(r.fault, 'unusable');
  assert.deepEqual(r.keys, []);
});

test('a set that does not verify gives a fixed reason, never text from the document', () => {
  const plain = setDoc([[NEW, 'current']]).replace(/}$/, ',"x":{"SECRET-NAME":1}}');
  assert.deepEqual(trustkeys.trustedKeys(stateWith(signed(plain)), pinOf(OLD), ON).keys, [pinOf(NEW)], 'CONTROL: the same set without the repeat verifies');
  const twice = plain.replace('{"SECRET-NAME":1}', '{"SECRET-NAME":1,"SECRET-NAME":2}');
  const why = servicekeys.verifyServiceKeySet({ bytes: twice, sig: signed(twice).signature, recoveryKeys: [ROOT_PUB] }).why;
  assert.match(why, /SECRET-NAME/, 'CONTROL: the check itself names the member');
  const r = trustkeys.trustedKeys(stateWith(signed(twice)), pinOf(OLD), ON);
  assert.equal(r.fault, 'unusable');
  assert.equal(r.why, 'the service key set this computer holds no longer verifies');
});

test('Forget removes a file where the tunnel folder should be', () => {
  const remote = require('./remote');
  const saved = process.env.AGENT_WORKFORCE_TUNNEL_STATE;
  const f = path.join(tmp('notdir'), 'state');
  fs.writeFileSync(f, 'x');
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = f;
  try {
    remote.clearStateDir([]);
    assert.equal(fs.existsSync(f), false);
  } finally { process.env.AGENT_WORKFORCE_TUNNEL_STATE = saved; }
});
