'use strict';
/**
 * kosmos#8819 (#8764): an admin's computer signs a hand-over start (engine/handoversign.js, seadmin handoverStart).
 * The Enclave is stood in for by a small helper script answering `pub` and `sign` with a P-256 key, as
 * engine/enrolsign-7116.test.js does; the coordinator by a `send` function.
 *
 *   node --test engine/handoversign-8819.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const se = require('./seadmin');
const hs = require('./handoversign');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-handoversign-8819-'));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const d = path.join(SANDBOX, 'case-' + (++n)); fs.mkdirSync(d, { recursive: true }); return d; };

const NONCE = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const SHOWN = { org: 'org1', id: 'h1', from: 'acct-from', to: 'acct-to', agents: ['helper', 'clerk'] };
const bytesOf = (over = {}, gen = '7', nonce = NONCE) => {
  const x = Object.assign({}, SHOWN, over);
  return se.encodeHandoverStart(x.org, x.id, x.from, x.to, x.agents, gen, nonce);
};

function appWithHelper() {
  const app = fresh();
  fs.mkdirSync(path.join(app, 'bin'));
  const helper = path.join(app, 'bin', 'kosmos-se');
  fs.writeFileSync(helper, `#!${process.execPath}
const fs = require('fs'), crypto = require('crypto');
const [cmd, file] = process.argv.slice(2);
const priv = crypto.createPrivateKey(fs.readFileSync(file));
const pub = crypto.createPublicKey(priv).export({ format: 'jwk' });
if (cmd === 'pub') { process.stdout.write('04' + Buffer.from(pub.x, 'base64url').toString('hex') + Buffer.from(pub.y, 'base64url').toString('hex') + '\\n'); process.exit(0); }
if (cmd === 'sign') { const msg = fs.readFileSync(0); process.stdout.write(crypto.sign('sha256', msg, { key: priv, dsaEncoding: 'der' }).toString('hex') + '\\n'); process.exit(0); }
process.stderr.write('kosmos-se: usage\\n'); process.exit(2);
`, { mode: 0o755 });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const keyFile = path.join(app, 'admin.key');
  fs.writeFileSync(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  const jwk = publicKey.export({ format: 'jwk' });
  const expectedKey = Buffer.concat([Buffer.of(4), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { app, keyFile, expectedKey, publicKey };
}

/* A coordinator that answers `{id}` with `bytes` and records what is posted. */
function coordinator(bytes, extra = {}) {
  const posts = [];
  const send = async (method, route, body) => {
    posts.push([method, route, body]);
    if (body.sig) return { ok: true, data: { ok: true, signed: true } };
    return { ok: true, data: Object.assign({ ok: true, signed: false, bytes: bytes.toString('base64url'), nonce: NONCE.toString('base64url'), generation: 7, expiresAt: 1900000000 }, extra) };
  };
  return { send, posts };
}

test('the bytes match kosmos-relay roster.rs encode_handover_start (the vector both sides pin)', () => {
  const b = bytesOf();
  assert.equal(b.length, 129);
  assert.equal(crypto.createHash('sha256').update(b).digest('hex'), '7944c8fa646efca2f727388d537def66c99fa4d9fe2499ed5d7ce19648f4060b');
  assert.deepEqual(se.decodeHandoverStart(b).agents, ['helper', 'clerk']);
  assert.ok(se.SIGNED.includes('handoverStart'));
});

test('an admin signs exactly the hand-over shown, posts it with its nonce, and the signature verifies over those bytes', async () => {
  const h = appWithHelper();
  const c = coordinator(bytesOf());
  const r = await hs.review(SHOWN, { send: c.send });
  assert.equal(r.signed, false);
  const answer = await hs.approveAndSend(r, { adminId: 'a1', expectedKey: h.expectedKey, keyFile: h.keyFile, appDir: h.app, send: c.send });
  assert.equal(answer.signed, true);
  const [, route, body] = c.posts[1];
  assert.equal(route, hs.ROUTE);
  assert.equal(body.id, 'h1');
  assert.equal(body.nonce, NONCE.toString('base64url'));
  assert.equal(body.sig.adminId, 'a1');
  const der = Buffer.from(body.sig.se, 'base64url');
  assert.equal(crypto.verify('sha256', bytesOf(), { key: h.publicKey, dsaEncoding: 'der' }, der), true);
  // CONTROL for the refusals below: the same signature does not verify over a start to another successor.
  assert.equal(crypto.verify('sha256', bytesOf({ to: 'acct-other' }), { key: h.publicKey, dsaEncoding: 'der' }, der), false);
});

test('bytes naming anything but the hand-over shown are refused before anything is signed or sent', async () => {
  const cases = [
    ['another successor (the attack #8764 closes)', bytesOf({ to: 'acct-other' })],
    ['another leaving member', bytesOf({ from: 'acct-other' })],
    ['another hand-over', bytesOf({ id: 'h2' })],
    ['another company', bytesOf({ org: 'org2' })],
    ['an extra agent', bytesOf({ agents: ['helper', 'clerk', 'payroll'] })],
    ['the agents in another order', bytesOf({ agents: ['clerk', 'helper'] })],
    ['one agent fewer', bytesOf({ agents: ['helper'] })],
  ];
  for (const [why, bytes] of cases) {
    const c = coordinator(bytes);
    await assert.rejects(hs.review(SHOWN, { send: c.send }), /different hand-over/, why);
    assert.equal(c.posts.filter(([, , b]) => b.sig).length, 0, `${why}: nothing posted`);
  }
  // Parts that disagree: a nonce or generation other than the bytes hold.
  await assert.rejects(hs.review(SHOWN, { send: coordinator(bytesOf(), { nonce: Buffer.alloc(16, 9).toString('base64url') }).send }), /do not agree/);
  await assert.rejects(hs.review(SHOWN, { send: coordinator(bytesOf(), { generation: 8 }).send }), /do not agree/);
  await assert.rejects(hs.review(SHOWN, { send: coordinator(bytesOf(), { generation: undefined }).send }), /do not agree/);
  // Not a hand-over at all (another action's bytes).
  const enrol = se.encodeReviewerRevoke('org1', Buffer.from('cred'));
  await assert.rejects(hs.review(SHOWN, { send: coordinator(enrol).send }), /not a hand-over/);
  // Malformed agents: none, a name escrowd would refuse, from and to the same member.
  for (const bad of [bytesOf({ agents: [] }), bytesOf({ agents: ['bad name'] }), bytesOf({ to: 'acct-from' })]) {
    await assert.rejects(hs.review(Object.assign({}, SHOWN), { send: coordinator(bad).send }), /not a hand-over/);
  }
});

test('already signed is said, and nothing is signed; only what review returned is approved', async () => {
  const send = async () => ({ ok: true, data: { ok: true, signed: true } });
  assert.deepEqual(await hs.review(SHOWN, { send }), { signed: true, kosmosSays: true });
  await assert.rejects(hs.approveAndSend({ signed: true }, {}), /approve only what review returned/);
  // Review 1 (Mona Lisa's probe): a hand-built object holding seadmin.prepare() of bytes to ANOTHER successor, shaped
  // like review()'s answer, is refused and nothing is posted.
  const h = appWithHelper();
  const c = coordinator(bytesOf());
  const forged = { signed: false, prepared: se.prepare('handoverStart', bytesOf({ to: 'acct-other' })), nonce: NONCE.toString('base64url') };
  await assert.rejects(hs.approveAndSend(forged, { adminId: 'a1', expectedKey: h.expectedKey, keyFile: h.keyFile, appDir: h.app, send: c.send }), /approve only what review returned/);
  assert.equal(c.posts.length, 0, 'nothing posted');
  // CONTROL, and spent once: review()'s own answer signs, then the same one is refused.
  const r = await hs.review(SHOWN, { send: c.send });
  await hs.approveAndSend(r, { adminId: 'a1', expectedKey: h.expectedKey, keyFile: h.keyFile, appDir: h.app, send: c.send });
  await assert.rejects(hs.approveAndSend(r, { adminId: 'a1', expectedKey: h.expectedKey, keyFile: h.keyFile, appDir: h.app, send: c.send }), /approve only what review returned/);
  assert.equal(c.posts.filter(([, , b]) => b.sig).length, 1, 'signed and posted once');
  // A coordinator refusal reads as a fixed sentence, never its own words.
  await assert.rejects(hs.review(SHOWN, { send: async () => ({ ok: false, because: 'tunnel line /Users/x' }) }), (e) => /did not give the hand-over to sign/.test(e.message) && !/Users/.test(e.message));
});

test('review 2 (April): a repeated agent in what is shown is refused; a failed signature says to ask again', async () => {
  await assert.rejects(hs.review(Object.assign({}, SHOWN, { agents: ['helper', 'helper'] }), { send: coordinator(bytesOf()).send }), /listed twice/);
  const h = appWithHelper();
  const c = coordinator(bytesOf());
  const r = await hs.review(SHOWN, { send: c.send });
  // A key file holding another key: the Enclave step fails; the review is spent; the error says ask again.
  const other = appWithHelper();
  await assert.rejects(hs.approveAndSend(r, { adminId: 'a1', expectedKey: other.expectedKey, keyFile: h.keyFile, appDir: h.app, send: c.send }), (e) => e.askAgain === true && /ask again/.test(e.message));
  assert.equal(c.posts.filter(([, , b]) => b.sig).length, 0, 'nothing posted');
});

test('an admin id is required to sign a hand-over start', async () => {
  const h = appWithHelper();
  const r = await hs.review(SHOWN, { send: coordinator(bytesOf()).send });
  await assert.rejects(hs.approveAndSend(r, { expectedKey: h.expectedKey, keyFile: h.keyFile, appDir: h.app, send: coordinator(bytesOf()).send }), /which admin is starting/);
});
