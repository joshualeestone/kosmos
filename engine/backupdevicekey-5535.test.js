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

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'devkey-5535-'));
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
    fs.writeFileSync(path.join(d, 'mac_key'), k.seed + '\n', { mode: 0o600 });
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
      fs.writeFileSync(path.join(d, 'mac_key'), body);
      const r = deviceKey({ stateDir: d });
      assert.equal(r.ok, false, what);
      assert.equal(r.privateKey, undefined, what);
      assert.doesNotMatch(r.because, new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${what}: no path`);
      assert.ok(!r.because.includes(k.seed.slice(0, 8)), `${what}: no key bytes`);
    }
    // Control: the exact form, with the connector's surrounding whitespace, is read.
    fs.writeFileSync(path.join(d, 'mac_key'), `  ${k.seed}\r\n`);
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
    // Control: the same bytes as a plain file are read.
    fs.rmdirSync(path.join(d, 'mac_key'));
    fs.copyFileSync(real, path.join(d, 'mac_key'));
    assert.equal(deviceKey({ stateDir: d }).ok, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('with no stateDir given it reads the connector folder remote.js uses (AGENT_WORKFORCE_TUNNEL_STATE)', () => {
  const d = tmp();
  const before = process.env.AGENT_WORKFORCE_TUNNEL_STATE;
  try {
    process.env.AGENT_WORKFORCE_TUNNEL_STATE = d;
    assert.equal(deviceKey().missing, true);
    fs.writeFileSync(path.join(d, 'mac_key'), connectorKey().seed);
    assert.equal(deviceKey().ok, true);
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_TUNNEL_STATE; else process.env.AGENT_WORKFORCE_TUNNEL_STATE = before;
    fs.rmSync(d, { recursive: true, force: true });
  }
});
