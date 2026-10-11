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

const WIN = process.platform === 'win32';
const bare = () => fs.mkdtempSync(path.join(os.tmpdir(), 'devkey-5535-'));
/* A state folder as the connector leaves it after registering: mac_id beside mac_key. */
const tmp = () => { const d = bare(); fs.writeFileSync(path.join(d, 'mac_id'), 'mac_test1\n'); return d; };
const writeKey = (d, body) => fs.writeFileSync(path.join(d, 'mac_key'), body);
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
    // No identity is claimed: the connector's two identity writes are not atomic (#5871), so none could be trusted.
    assert.equal('macId' in r, false);
    // It signs a manifest that verifies under the connector's public key (what restore and the content view hold).
    const member = hpkeKeyPair();
    const ctx = { org: 'o', member: 'm', epoch: '1', period: '2026-W41', snapshot: 's' };
    const obj = bf.sealManifest(member.pk, r.privateKey, ctx, { files: [] });
    assert.equal(bf.verifyManifestSignature(k.publicKey, ctx, obj), true);
    // Control: another device's key does not verify it.
    assert.equal(bf.verifyManifestSignature(crypto.generateKeyPairSync('ed25519').publicKey, ctx, obj), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('anything but the connector\'s exact form is refused (not as retry), with a fixed sentence that names no path', () => {
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
      ['whitespace only', ' \n'],
      ['hex', Buffer.from(k.seed, 'base64url').toString('hex')],
      ['larger than a key', k.seed + ' '.repeat(300)],
      ['a BOM (Rust keeps it, then cannot decode)', '﻿' + k.seed],
    ]) {
      writeKey(d, body);
      const r = deviceKey({ stateDir: d });
      assert.equal(r.ok, false, what);
      assert.equal(r.retry, undefined, `${what}: a wrong form is not a passing state`);
      assert.equal(r.privateKey, undefined, what);
      assert.ok(!r.because.includes(d), `${what}: no path`);
    }
    // Controls: the exact form with whitespace Rust also trims (CRLF, NEL U+0085, a no-break space) is read.
    for (const body of [`  ${k.seed}\r\n`, k.seed + '\u0085\n', ' ' + k.seed]) {
      writeKey(d, body);
      assert.equal(deviceKey({ stateDir: d }).ok, true, JSON.stringify(body.slice(-3)));
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('no mac_id, or no mac_key, is "missing"; an empty key file is a rewrite in progress (retry)', () => {
  const d = bare();
  try {
    const k = connectorKey();
    writeKey(d, k.seed);   // write_identity writes mac_key FIRST: a first registration cut off here
    const cut = deviceKey({ stateDir: d });
    assert.equal(cut.ok, false); assert.equal(cut.missing, true);
    fs.writeFileSync(path.join(d, 'mac_id'), 'mac_test1');
    assert.equal(deviceKey({ stateDir: d }).ok, true, 'control: with mac_id it reads');
    fs.unlinkSync(path.join(d, 'mac_key'));
    const nokey = deviceKey({ stateDir: d });
    assert.equal(nokey.ok, false); assert.equal(nokey.missing, true);
    writeKey(d, '');
    const empty = deviceKey({ stateDir: d });
    assert.equal(empty.ok, false); assert.equal(empty.retry, true); assert.equal(empty.missing, undefined);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a link and a folder are refused without being read (not as retry)', { skip: WIN && 'symlinks need privileges on Windows' }, () => {
  const d = tmp();
  try {
    const k = connectorKey();
    const real = path.join(d, 'elsewhere');
    fs.writeFileSync(real, k.seed);
    fs.symlinkSync(real, path.join(d, 'mac_key'));
    const link = deviceKey({ stateDir: d });
    assert.equal(link.ok, false); assert.equal(link.retry, undefined); assert.match(link.because, /link/);
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

test('a FIFO is refused as not a plain file without blocking', { skip: WIN && 'no mkfifo on Windows' }, () => {
  const d = tmp();
  try {
    require('child_process').execFileSync('mkfifo', [path.join(d, 'mac_key')]);
    const r = deviceKey({ stateDir: d });
    assert.equal(r.ok, false); assert.match(r.because, /not a plain file/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('the folder must be an absolute path, given or from AGENT_WORKFORCE_TUNNEL_STATE, which is the default', () => {
  for (const bad of ['', 'relative/dir', 5, null]) {
    const r = deviceKey({ stateDir: bad });
    assert.equal(r.ok, false, String(bad)); assert.match(r.because, /not an absolute path/, String(bad));
  }
  const d = tmp();
  const before = process.env.AGENT_WORKFORCE_TUNNEL_STATE;
  try {
    process.env.AGENT_WORKFORCE_TUNNEL_STATE = 'relative/state';
    assert.match(deviceKey().because, /not an absolute path/);
    process.env.AGENT_WORKFORCE_TUNNEL_STATE = d;
    assert.equal(deviceKey().missing, true);
    writeKey(d, connectorKey().seed);
    assert.equal(deviceKey().ok, true);
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_TUNNEL_STATE; else process.env.AGENT_WORKFORCE_TUNNEL_STATE = before;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('a file another program holds (EBUSY, a Windows sharing violation) is a passing state: retry', () => {
  const d = tmp();
  const realOpen = fs.openSync;
  try {
    writeKey(d, connectorKey().seed);
    fs.openSync = function (file, ...rest) {
      if (String(file).endsWith('mac_key')) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
      return realOpen.call(fs, file, ...rest);
    };
    const r = deviceKey({ stateDir: d });
    assert.equal(r.ok, false); assert.equal(r.retry, true); assert.match(r.because, /\(EBUSY\)/);
    fs.openSync = realOpen;
    assert.equal(deviceKey({ stateDir: d }).ok, true, 'control: once released it reads');
  } finally { fs.openSync = realOpen; fs.rmSync(d, { recursive: true, force: true }); }
});
