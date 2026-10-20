'use strict';
/**
 * #6609: the release recovery key's key list, phase 1 (the checks; wiring them into every update path is phase 2).
 * Throwaway keys throughout: a recovery key, two release keys, and a stranger's key.
 *   node --test engine/manifest-verify.recovery-6609.test.js
 */
require('../test-support/tmpscope');
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
  const bytes = Buffer.from(JSON.stringify(Object.assign({ type: mv.KEY_LIST_TYPE }, obj)));
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
  assert.equal(mv.storedKeyList(h).seq, 3);
  // POSIX modes only: Windows has no mode bits (Node reports 0666 and 0777 there). No Windows path writes the record yet
  // (engine/win32update.js checks its manifest with the built-in KEYS, not trustedKeys); when it does, this becomes a
  // Windows access-list check and the file joins the Windows CI job (.claude/plans/rkwin-6609.md).
  if (process.platform !== 'win32') {
    assert.equal((fs.statSync(path.join(h, mv.KEY_LIST_STATE, 'seq-3.json')).mode & 0o777), 0o600);
    assert.equal((fs.statSync(path.join(h, mv.KEY_LIST_STATE)).mode & 0o777), 0o700);
  }
  assert.deepEqual(fs.readdirSync(path.join(h, mv.KEY_LIST_STATE)), ['seq-3.json'], 'no temp file left behind');
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
  assert.equal(mv.storedKeyList(h).seq, 2);
  const back = mv.trustedKeys({ listBytes: v1.bytes, listSig: v1.sig, home: h, recoveryKeys: RK });
  assert.equal(back.ok, false);
  assert.match(back.why, /older than the 2 this copy has taken/);
  // The same seq again is fine (every update fetches it).
  assert.equal(mv.trustedKeys({ listBytes: v2.bytes, listSig: v2.sig, home: h, recoveryKeys: RK }).ok, true);
  assert.equal(mv.storedKeyList(h).seq, 2);
});

test('#6609: a revoked key no longer opens a release: the keys trustedKeys gives after the newer list refuse its manifest', () => {
  const d = home();
  const manifest = path.join(d, 'm.json'); const sig = path.join(d, 'm.sig');
  const bytes = Buffer.from(JSON.stringify({ version: '0.7.70', sha256: 'x' }));
  fs.writeFileSync(manifest, bytes);
  fs.writeFileSync(sig, crypto.sign(null, bytes, rel1.privateKey).toString('base64'));
  const check = (keys) => mv.verify({ manifest, sig, tarball: null, stage: '-', version: '0.7.70', installedVersion: '0.7.60', keys, skipTarball: true });
  const h = home();
  const v1 = list({ release_keys: [spki(rel1), spki(rel2)], seq: 1 });
  const k1 = mv.trustedKeys({ listBytes: v1.bytes, listSig: v1.sig, home: h, recoveryKeys: RK });
  assert.equal(check(k1.keys).code, 0, 'CONTROL: while list 1 is current, rel1 opens it');
  const v2 = list({ release_keys: [spki(rel2)], seq: 2 });
  const k2 = mv.trustedKeys({ listBytes: v2.bytes, listSig: v2.sig, home: h, recoveryKeys: RK });
  const after = check(k2.keys);
  assert.equal(after.code, 1);
  assert.match(after.why, /not signed by the Kosmos release key/);
  // And serving list 1 again does not bring it back.
  assert.equal(mv.trustedKeys({ listBytes: v1.bytes, listSig: v1.sig, home: h, recoveryKeys: RK }).ok, false);
});

test('#6609: no record falls back to the built-in floor; a damaged top record keeps its seq as the floor and is repaired only by a list at or above it', () => {
  assert.equal(mv.storedKeyList(home()).seq, mv.MIN_KEY_LIST_SEQ);
  const h = home();
  const dir = path.join(h, mv.KEY_LIST_STATE);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'seq-1.json'), JSON.stringify({ seq: 1, release_keys: [spki(rel1), spki(rel2)] }));
  fs.writeFileSync(path.join(dir, 'seq-2.json'), '');   // a power loss left the top file empty
  assert.deepEqual(mv.storedKeyList(h), { seq: 2, keys: null, damaged: true });
  // The list below it (which may still hold the key list 2 revoked) is refused: damage must not lower the floor.
  const v1 = list({ release_keys: [spki(rel1), spki(rel2)], seq: 1 });
  const low = mv.trustedKeys({ listBytes: v1.bytes, listSig: v1.sig, home: h, recoveryKeys: RK });
  assert.equal(low.ok, false);
  assert.match(low.why, /older than the 2 this copy has taken/);
  // The list at that seq repairs the record in place, with nothing removed by hand.
  const v2 = list({ release_keys: [spki(rel2)], seq: 2 });
  assert.equal(mv.trustedKeys({ listBytes: v2.bytes, listSig: v2.sig, home: h, recoveryKeys: RK }).ok, true);
  assert.deepEqual(mv.storedKeyList(h), { seq: 2, keys: [spki(rel2)] });
  // A record without its keys is damaged the same way; a list above it is recorded above.
  const h2 = home();
  fs.mkdirSync(path.join(h2, mv.KEY_LIST_STATE));
  fs.writeFileSync(path.join(h2, mv.KEY_LIST_STATE, 'seq-3.json'), JSON.stringify({ seq: 3 }));
  assert.equal(mv.storedKeyList(h2).damaged, true);
  const v5 = list({ release_keys: [spki(rel1)], seq: 5 });
  assert.equal(mv.trustedKeys({ listBytes: v5.bytes, listSig: v5.sig, home: h2, recoveryKeys: RK }).ok, true);
  assert.equal(mv.storedKeyList(h2).seq, 5);
});

test('#6609: a floor above 1 (raised after a revocation) refuses the older list on a copy with no record', () => {
  const v1 = list({ release_keys: [spki(rel1)], seq: 1 });
  const v3 = list({ release_keys: [spki(rel2)], seq: 3 });
  assert.equal(mv.trustedKeys({ listBytes: v1.bytes, listSig: v1.sig, home: home(), recoveryKeys: RK, minSeq: 3 }).ok, false);
  assert.equal(mv.trustedKeys({ listBytes: v3.bytes, listSig: v3.sig, home: home(), recoveryKeys: RK, minSeq: 3 }).ok, true);
  assert.equal(mv.trustedKeys({ listBytes: v1.bytes, listSig: v1.sig, home: home(), recoveryKeys: RK, minSeq: 1 }).ok, true, 'CONTROL: floor 1 takes it');
});

test('#6609: one key has one spelling: the pad dropped, or the unused low bits of the last character changed, is not a key', () => {
  const k = spki(rel1);
  assert.ok(mv.ed25519Key(k));
  assert.equal(mv.ed25519Key(k.replace(/=$/, '')), null);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const last = k[58];
  const twin = k.slice(0, 58) + alphabet[alphabet.indexOf(last) ^ 1] + '=';
  assert.ok(Buffer.from(twin, 'base64').equals(Buffer.from(k, 'base64')), 'the twin decodes to the same bytes (the case this guards)');
  assert.equal(mv.ed25519Key(twin), null);
  const l = list({ release_keys: [k, twin], seq: 1 });
  assert.equal(mv.verifyKeyList({ bytes: l.bytes, sig: l.sig, recoveryKeys: RK }).ok, false, 'one key listed twice in two spellings is refused');
});

test('#6609: a list at exactly the floor is recorded, so a different list with the same seq is refused (activation case)', () => {
  const h = home();
  const a1 = list({ release_keys: [spki(rel1)], seq: 1 });
  const b1 = list({ release_keys: [spki(rel2)], seq: 1 });
  assert.equal(mv.trustedKeys({ listBytes: a1.bytes, listSig: a1.sig, home: h, recoveryKeys: RK }).ok, true);
  assert.deepEqual(mv.storedKeyList(h).keys, [spki(rel1)], 'the seq-1 list was recorded');
  const r = mv.trustedKeys({ listBytes: b1.bytes, listSig: b1.sig, home: h, recoveryKeys: RK });
  assert.equal(r.ok, false);
  assert.match(r.why, /names other keys than the list 1/);
});

test('#6609: only a canonical seq name counts: a leading zero or a number past the largest seq is not a record', () => {
  const h = home();
  fs.mkdirSync(path.join(h, mv.KEY_LIST_STATE));
  fs.writeFileSync(path.join(h, mv.KEY_LIST_STATE, 'seq-007.json'), JSON.stringify({ seq: 7, release_keys: [spki(rel1)] }));
  fs.writeFileSync(path.join(h, mv.KEY_LIST_STATE, 'seq-9999999999.json'), JSON.stringify({ seq: 9999999999, release_keys: [spki(rel1)] }));
  assert.deepEqual(mv.storedKeyList(h), { seq: mv.MIN_KEY_LIST_SEQ, keys: null });
  const l = list({ release_keys: [spki(rel2)], seq: 2 });
  assert.equal(mv.trustedKeys({ listBytes: l.bytes, listSig: l.sig, home: h, recoveryKeys: RK }).ok, true, 'neither name blocks a real list');
});

test('#6609: the race window between reading the record and linking: a newer list that lands there wins, and a same-seq list with other keys is refused', () => {
  const realLink = fs.linkSync;
  try {
    // A newer list (seq 7) is recorded by another check just before this check links seq 6.
    const h = home();
    const v6 = list({ release_keys: [spki(rel1), spki(rel2)], seq: 6 });
    fs.linkSync = (from, to) => {
      fs.writeFileSync(path.join(h, mv.KEY_LIST_STATE, 'seq-7.json'), JSON.stringify({ seq: 7, release_keys: [spki(rel2)] }));
      return realLink(from, to);
    };
    const r = mv.trustedKeys({ listBytes: v6.bytes, listSig: v6.sig, home: h, recoveryKeys: RK });
    assert.equal(r.ok, false, 'list 6 may hold a key list 7 dropped');
    assert.match(r.why, /a newer release key list was taken meanwhile/);
    assert.equal(mv.storedKeyList(h).seq, 7);
    // Another check records seq 5 with other keys in the same window: the link finds it, and this list is refused.
    const h2 = home();
    const mine5 = list({ release_keys: [spki(rel2)], seq: 5 });
    fs.linkSync = (from, to) => {
      fs.writeFileSync(to, JSON.stringify({ seq: 5, release_keys: [spki(rel1)] }));
      return realLink(from, to);
    };
    const r2 = mv.trustedKeys({ listBytes: mine5.bytes, listSig: mine5.sig, home: h2, recoveryKeys: RK });
    assert.equal(r2.ok, false);
    assert.match(r2.why, /names other keys than the list 5/);
    // CONTROL: the same window with the SAME keys is fine (two checks taking one list).
    const h3 = home();
    fs.linkSync = (from, to) => {
      fs.writeFileSync(to, JSON.stringify({ seq: 5, release_keys: [spki(rel2)] }));
      return realLink(from, to);
    };
    assert.equal(mv.trustedKeys({ listBytes: mine5.bytes, listSig: mine5.sig, home: h3, recoveryKeys: RK }).ok, true);
  } finally { fs.linkSync = realLink; }
});

test('#6609: switched on, no install home is a refusal (the record is what stops rollback)', () => {
  const l = list({ release_keys: [spki(rel1)], seq: 2 });
  const r = mv.trustedKeys({ listBytes: l.bytes, listSig: l.sig, home: '', recoveryKeys: RK });
  assert.equal(r.ok, false);
  assert.match(r.why, /cannot be checked without this copy/);
  // A home that does not exist (a wrong path) is refused too, and nothing is created there.
  const wrong = path.join(home(), 'not-the-install');
  const w = mv.trustedKeys({ listBytes: l.bytes, listSig: l.sig, home: wrong, recoveryKeys: RK });
  assert.equal(w.ok, false);
  assert.match(w.why, /cannot be checked without this copy/);
  assert.equal(fs.existsSync(wrong), false, 'a mistyped home must not start a fresh record');
});

test('#6609: the record only moves forward: once a newer list is recorded, the older one is refused and the record keeps the newer', () => {
  const h = home();
  const v6 = list({ release_keys: [spki(rel1), spki(rel2)], seq: 6 });
  const v7 = list({ release_keys: [spki(rel2)], seq: 7 });
  // A check of list 6 starts on a copy at seq 6...
  assert.equal(mv.trustedKeys({ listBytes: v6.bytes, listSig: v6.sig, home: h, recoveryKeys: RK }).ok, true);
  // ...another check records list 7 meanwhile (as a concurrent check would, by adding its file)...
  fs.writeFileSync(path.join(h, mv.KEY_LIST_STATE, 'seq-7.json'), JSON.stringify({ seq: 7, release_keys: [spki(rel2)] }));
  // ...so list 6, which still holds the key list 7 dropped, is refused from now on, and seq 7 stays the record.
  const r = mv.trustedKeys({ listBytes: v6.bytes, listSig: v6.sig, home: h, recoveryKeys: RK });
  assert.equal(r.ok, false);
  assert.equal(mv.storedKeyList(h).seq, 7);
  assert.equal(mv.trustedKeys({ listBytes: v7.bytes, listSig: v7.sig, home: h, recoveryKeys: RK }).ok, true);
  // And a seq already recorded by another check with other keys is refused, not overwritten.
  const h2 = home();
  fs.mkdirSync(path.join(h2, mv.KEY_LIST_STATE), { recursive: true });
  fs.writeFileSync(path.join(h2, mv.KEY_LIST_STATE, 'seq-5.json'), JSON.stringify({ seq: 5, release_keys: [spki(rel1)] }));
  const other5 = list({ release_keys: [spki(rel2)], seq: 5 });
  assert.equal(mv.trustedKeys({ listBytes: other5.bytes, listSig: other5.sig, home: h2, recoveryKeys: RK }).ok, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h2, mv.KEY_LIST_STATE, 'seq-5.json'), 'utf8')).release_keys[0], spki(rel1));
});

test('#6609: RECOVERY_KEYS cannot be turned on from inside the process', () => {
  assert.equal(mv.RECOVERY_KEYS.filter((k) => mv.KEYS.includes(k)).length, 0, 'a recovery key is never also a built-in release key');
  assert.throws(() => mv.RECOVERY_KEYS.push(spki(recovery)));
  assert.equal(mv.RECOVERY_KEYS.length, 0);
});

test('#6609: a seq is never reused: the same seq with other keys is refused; a failed record write is a refusal, not a throw', () => {
  const h = home();
  const a = list({ release_keys: [spki(rel1)], seq: 4 });
  const b = list({ release_keys: [spki(rel2)], seq: 4 });
  assert.equal(mv.trustedKeys({ listBytes: a.bytes, listSig: a.sig, home: h, recoveryKeys: RK }).ok, true);
  const r = mv.trustedKeys({ listBytes: b.bytes, listSig: b.sig, home: h, recoveryKeys: RK });
  assert.equal(r.ok, false);
  assert.match(r.why, /names other keys than the list 4/);
  const ro = home();
  fs.chmodSync(ro, 0o500);   // a home this check cannot write in
  try {
    if (process.getuid && process.getuid() === 0) return;   // root writes anyway: the arm cannot be exercised
    if (process.platform === 'win32') return;   // a folder mode does not stop writes on Windows: the arm cannot be exercised there
    const w = mv.trustedKeys({ listBytes: a.bytes, listSig: a.sig, home: ro, recoveryKeys: RK });
    assert.equal(w.ok, false);
    assert.match(w.why, /could not be written/);
  } finally { fs.chmodSync(ro, 0o700); }
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
    ['no type (a recovery signature over something that is not a key list)', { type: undefined, release_keys: [spki(rel1)], seq: 1 }, /not a release key list/],
    ['another type', { type: 'something-else', release_keys: [spki(rel1)], seq: 1 }, /not a release key list/],
    ['the recovery key named as a release key', { release_keys: [spki(rel1), spki(recovery)], seq: 1 }, /names a recovery key as a release key/],
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
  assert.ok(r.stdout.includes('signed by recovery key ' + RK[0]), r.stdout);
  const body = pem(recovery).split('\n').filter((l) => l && !l.startsWith('-----')).join('');
  assert.ok(!(r.stdout + r.stderr).includes(body.slice(10, 40)), 'no part of the private key reaches the output');
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
  const over = spawnSync(process.execPath, [tool, '1', out, spki(rel2)], { input: pem(recovery), encoding: 'utf8' });
  assert.equal(over.status, 1, 'a list with the same or a lower number than the one in the folder is not written');
  assert.match(over.stderr, /already holds list 1/);
  assert.equal(spawnSync(process.execPath, [tool, '2147483648', out, spki(rel1)], { input: pem(recovery), encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [tool, '2', out, spki(rel2)], { input: pem(recovery), encoding: 'utf8' }).status, 0, 'a higher number is written');
  const out2 = home();
  fs.writeFileSync(path.join(out2, 'release-keys.json'), 'garbage');
  const g = spawnSync(process.execPath, [tool, '5', out2, spki(rel1)], { input: pem(recovery), encoding: 'utf8' });
  assert.equal(g.status, 1, 'an unreadable list in the folder is not overwritten');
  const out3 = home();
  const asRelease = spawnSync(process.execPath, [tool, '1', out3, spki(recovery)], { input: pem(recovery), encoding: 'utf8' });
  assert.equal(asRelease.status, 2, 'the recovery key is never also a release key');
  assert.deepEqual(fs.readdirSync(out3), []);
  fs.writeFileSync(path.join(out3, 'release-keys.json'), 'null');
  const nul = spawnSync(process.execPath, [tool, '1', out3, spki(rel1)], { input: pem(recovery), encoding: 'utf8' });
  assert.equal(nul.status, 1);
  assert.match(nul.stderr, /^the folder already holds list \(unreadable number\); a new list needs a higher number\n$/, 'refused with its own sentence, not a crash: ' + nul.stderr);
  assert.equal(fs.readFileSync(path.join(out2, 'release-keys.json'), 'utf8'), 'garbage');
});
