'use strict';
// kosmos#5535 E0.6 slice (b): the device key a manifest is signed with is the connector's mac_key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { deviceKey } = require('./backupdevicekey');
const bf = require('./backupformat');
const { hpkeKeyPair } = require('./hpke');

const bare = () => fs.mkdtempSync(path.join(os.tmpdir(), 'devkey-5535-'));
/* A state folder as the connector leaves it after registering: mac_id beside mac_key (written by each test). */
const tmp = () => { const d = bare(); fs.writeFileSync(path.join(d, 'mac_id'), 'mac_test1\n'); return d; };
/* Write a key the way write_identity does: mac_key FIRST, then mac_id (here rewritten with its own text, so it is the
   newer file), so a fixture is a finished registration, not one caught between its two writes. */
function writeKey(d, body) {
  fs.writeFileSync(path.join(d, 'mac_key'), body);
  const id = path.join(d, 'mac_id');
  if (fs.existsSync(id)) fs.writeFileSync(id, fs.readFileSync(id));
}
/* A key the way the connector writes it (setup.rs: URL_SAFE_NO_PAD of the 32-byte seed) and its public half as the
   connector would register it (the raw 32 bytes), computed independently of the module under test. */
function connectorKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'jwk' }).d;   // base64url, no padding, 32 bytes
  const rawPub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { seed, rawPub, publicKey };
}

test('the connector\'s mac_key is read as an Ed25519 key whose public half is the one the connector registers', () => {
  const d = tmp();
  try {
    const k = connectorKey();
    writeKey(d, k.seed + '\n');
    const r = deviceKey({ stateDir: d });
    assert.equal(r.ok, true, r.because);
    assert.equal(r.privateKey.asymmetricKeyType, 'ed25519');
    assert.ok(Buffer.from(r.publicKey.export({ format: 'jwk' }).x, 'base64url').equals(k.rawPub));
    // It signs a manifest that verifies under the connector's public key (what restore and the content view hold).
    const member = hpkeKeyPair();
    const ctx = { org: 'o', member: 'm', epoch: '1', period: '2026-W41', snapshot: 's' };
    const obj = bf.sealManifest(member.pk, r.privateKey, ctx, { files: [] });
    assert.equal(bf.verifyManifestSignature(k.publicKey, ctx, obj), true);
    // Control: another device's key does not verify it.
    assert.equal(bf.verifyManifestSignature(crypto.generateKeyPairSync('ed25519').publicKey, ctx, obj), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('anything but the connector\'s exact form is refused, with a fixed sentence that names no path and no byte', () => {
  const d = tmp();
  try {
    const k = connectorKey();
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const noncanonical = k.seed.slice(0, 42) + A[A.indexOf(k.seed[42]) ^ 1];
    for (const [what, body] of [
      ['standard base64 with padding', Buffer.from(k.seed, 'base64url').toString('base64')],
      ['too short', k.seed.slice(0, 42)],
      ['too long', k.seed + 'A'],
      ['a non-canonical spelling', noncanonical],
      ['empty', ''],
      ['hex', Buffer.from(k.seed, 'base64url').toString('hex')],
      ['larger than a key', k.seed + ' '.repeat(300)],
    ]) {
      writeKey(d, body);
      const r = deviceKey({ stateDir: d });
      assert.equal(r.ok, false, what);
      assert.equal(r.privateKey, undefined, what);
      assert.doesNotMatch(r.because, new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${what}: no path`);
      assert.ok(!r.because.includes(k.seed.slice(0, 8)), `${what}: no key bytes`);
    }
    // Control: the exact form, with the connector's surrounding whitespace, is read.
    writeKey(d, `  ${k.seed}\r\n`);
    assert.equal(deviceKey({ stateDir: d }).ok, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('no file is "missing"; a link and a folder are refused without being read', () => {
  const d = tmp();
  try {
    const none = deviceKey({ stateDir: d });
    assert.equal(none.ok, false); assert.equal(none.missing, true);
    const k = connectorKey();
    const real = path.join(d, 'elsewhere');
    fs.writeFileSync(real, k.seed);
    fs.symlinkSync(real, path.join(d, 'mac_key'));
    const link = deviceKey({ stateDir: d });
    assert.equal(link.ok, false); assert.equal(link.missing, undefined); assert.match(link.because, /link/);
    fs.unlinkSync(path.join(d, 'mac_key'));
    fs.mkdirSync(path.join(d, 'mac_key'));
    const dir = deviceKey({ stateDir: d });
    assert.equal(dir.ok, false); assert.equal(dir.missing, undefined);
    assert.match(dir.because, /not a plain file/, 'refused as what it is, not as a read error');
    // Control: the same bytes as a plain file are read.
    fs.rmdirSync(path.join(d, 'mac_key'));
    writeKey(d, fs.readFileSync(real));
    assert.equal(deviceKey({ stateDir: d }).ok, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('with no stateDir given it reads the connector folder remote.js uses (AGENT_WORKFORCE_TUNNEL_STATE)', () => {
  const d = bare();
  const before = process.env.AGENT_WORKFORCE_TUNNEL_STATE;
  try {
    process.env.AGENT_WORKFORCE_TUNNEL_STATE = d;
    assert.equal(deviceKey().missing, true);
    writeKey(d, connectorKey().seed);
    fs.writeFileSync(path.join(d, 'mac_id'), 'mac_test1');
    assert.equal(deviceKey().ok, true);
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_TUNNEL_STATE; else process.env.AGENT_WORKFORCE_TUNNEL_STATE = before;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('round 1: trimmed exactly as Rust trims: a BOM is refused (the connector cannot read it), U+0085 is trimmed', () => {
  const d = tmp();
  try {
    const k = connectorKey();
    writeKey(d, '\uFEFF' + k.seed);
    const bom = deviceKey({ stateDir: d });
    assert.equal(bom.ok, false); assert.match(bom.because, /form the connector writes/);
    // Rust's char::is_whitespace includes U+0085 (NEL), which JS trim() keeps: the connector reads this one.
    writeKey(d, k.seed + '\u0085\n');
    assert.equal(deviceKey({ stateDir: d }).ok, true);
    // And a no-break space, which both trim.
    writeKey(d, '\u00A0' + k.seed);
    assert.equal(deviceKey({ stateDir: d }).ok, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('round 1: a FIFO is refused as not a plain file without blocking; a stateDir must be an absolute path', () => {
  const d = tmp();
  try {
    require('child_process').execFileSync('mkfifo', [path.join(d, 'mac_key')]);
    const r = deviceKey({ stateDir: d });
    assert.equal(r.ok, false); assert.match(r.because, /not a plain file/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
  for (const bad of ['', 'relative/dir', 5, null]) {
    const r = deviceKey({ stateDir: bad });
    assert.equal(r.ok, false, String(bad)); assert.match(r.because, /not an absolute path/, String(bad));
  }
});

test('round 2: the key belongs to mac_id: none is missing (a registration cut off), a bad one is refused, it is returned', () => {
  const d = bare();
  try {
    const k = connectorKey();
    writeKey(d, k.seed);   // write_identity writes mac_key FIRST
    const cut = deviceKey({ stateDir: d });
    assert.equal(cut.ok, false); assert.equal(cut.missing, true);
    for (const bad of ['', 'mac id with spaces', 'x'.repeat(129), '\uFEFFmac_test1']) {
      fs.writeFileSync(path.join(d, 'mac_id'), bad);
      const r = deviceKey({ stateDir: d });
      assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(r.missing, undefined, JSON.stringify(bad));
    }
    fs.writeFileSync(path.join(d, 'mac_id'), '  mac_abc-1\n');
    const r = deviceKey({ stateDir: d });
    assert.equal(r.ok, true, r.because); assert.equal(r.macId, 'mac_abc-1');
    // A link in place of mac_id is refused, as for mac_key.
    fs.renameSync(path.join(d, 'mac_id'), path.join(d, 'id-elsewhere'));
    fs.symlinkSync(path.join(d, 'id-elsewhere'), path.join(d, 'mac_id'));
    assert.match(deviceKey({ stateDir: d }).because, /link/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('round 2: registered again while the key was read (mac_id changed between the two reads) is refused', () => {
  const d = tmp();
  const realOpen = fs.openSync;
  try {
    writeKey(d, connectorKey().seed);
    let swapped = false;
    fs.openSync = function (file, ...rest) {
      const fd = realOpen.call(fs, file, ...rest);
      // Right after the key is opened, a new registration lands: a new identity (and in reality a new key).
      if (String(file).endsWith('mac_key') && !swapped) { swapped = true; fs.writeFileSync(path.join(d, 'mac_id'), 'mac_test2'); }
      return fd;
    };
    const r = deviceKey({ stateDir: d });
    assert.equal(swapped, true, 'the swap ran');
    assert.equal(r.ok, false); assert.match(r.because, /registered again/);
    // Control: without the swap the same folder reads, under the new identity.
    fs.openSync = realOpen;
    assert.equal(deviceKey({ stateDir: d }).macId, 'mac_test2');
  } finally { fs.openSync = realOpen; fs.rmSync(d, { recursive: true, force: true }); }
});

test('round 3: a registration caught between its two writes (new key, old id) is refused with retry; an empty file too', () => {
  const d = tmp();
  try {
    const k = connectorKey();
    writeKey(d, k.seed);
    assert.equal(deviceKey({ stateDir: d }).ok, true, 'control: a finished registration reads');
    // write_identity has written the NEW key; mac_id is still the OLD one: the key file is the newer.
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(d, 'mac_key'), connectorKey().seed);
    fs.utimesSync(path.join(d, 'mac_key'), later, later);
    const mid = deviceKey({ stateDir: d });
    assert.equal(mid.ok, false); assert.equal(mid.retry, true); assert.match(mid.because, /being registered again/);
    // Then mac_id lands (written after the key): it reads, under the new identity.
    fs.writeFileSync(path.join(d, 'mac_id'), 'mac_test2');
    const t2 = new Date(later.getTime() + 1000);
    fs.utimesSync(path.join(d, 'mac_id'), t2, t2);
    const done = deviceKey({ stateDir: d });
    assert.equal(done.ok, true, done.because); assert.equal(done.macId, 'mac_test2');
    // An empty file is one being rewritten (std::fs::write truncates first).
    fs.writeFileSync(path.join(d, 'mac_id'), '');
    const empty = deviceKey({ stateDir: d });
    assert.equal(empty.ok, false); assert.equal(empty.retry, true);
    // An OLD pair in that order is not a live registration: read, never refused for good.
    fs.writeFileSync(path.join(d, 'mac_id'), 'mac_test3');
    const hourAgo = new Date(Date.now() - 3600 * 1000), before = new Date(Date.now() - 3601 * 1000);
    fs.utimesSync(path.join(d, 'mac_id'), before, before);
    fs.utimesSync(path.join(d, 'mac_key'), hourAgo, hourAgo);
    const old = deviceKey({ stateDir: d });
    assert.equal(old.ok, true, old.because);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
