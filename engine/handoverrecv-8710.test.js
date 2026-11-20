'use strict';
/* kosmos#8710 slice 4: engine/handoverrecv.js, the successor's computer receiving a hand-over. A sandboxed data root and
   worlds registry (as restoreworld-5536.test.js), a loopback store, and a fake coordinator for the four routes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-handoverrecv-')));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const hr = require('./handoverrecv');
const snap = require('./backupsnapshot');
const up = require('./backupupload');
const worlds = require('./worlds');
up.allowHttpForTests(true);

const ORG = 'org1';
// kosmos#8733: escrowd's history key (a test stand-in) and this (the successor's) computer's device key.
const seal = require('./handoverseal');
const dkh = require('./devkeyhist');
const ESCROWD = crypto.generateKeyPairSync('ed25519');
dkh.setVerifyingKeyForTests(ESCROWD.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
const SUCC = crypto.generateKeyPairSync('ed25519');
const SUCC_DK = () => ({ ok: true, privateKey: SUCC.privateKey, publicKey: SUCC.publicKey });
function signedHistory(org, member, publicKey, extra, more) {
  const t = Math.floor(Date.now() / 1000);
  const entries = [Object.assign({ kind: 'enrol', key: seal.keyHex(publicKey), at: 0, backfill: false }, extra || {})].concat(more || []);
  return { org, member, entries, issuedAt: t, signature: crypto.sign(null, dkh.encodeHead(org, member, entries, t), ESCROWD.privateKey).toString('base64url') };
}
/* escrowd's record for hand-over `id`, issued a minute ago (before any pack a test makes), m-leave -> m-succ. */
function signedRecord(id, agents, over) {
  const r = Object.assign({ org: ORG, id, from: 'm-leave', to: 'm-succ', agents, issuedAt: Math.floor(Date.now() / 1000) - 60 }, over || {});
  return Object.assign(r, { signature: crypto.sign(null, seal.encodeRecord(r), ESCROWD.privateKey).toString('base64url') });
}
const md5 = (b) => crypto.createHash('md5').update(b).digest('base64');
const sha256b = (b) => crypto.createHash('sha256').update(b).digest('base64');
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const amzDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const fresh = (t, name) => { const d = fs.mkdtempSync(path.join(SANDBOX, name + '-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

/* A store that takes PUTs (as slice 3's test) and answers GETs. */
async function bucket() {
  const stored = new Map();
  const gets = [];
  const srv = http.createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/bucket\//, '');
    if (req.method === 'GET') {
      gets.push(key);
      const v = stored.get(key);
      if (!v) { res.statusCode = 404; return res.end(''); }
      res.statusCode = 200; return res.end(v.body);
    }
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
      const body = Buffer.concat(parts);
      const sha = req.headers['x-amz-checksum-sha256'];
      if (sha !== undefined ? sha !== sha256b(body) : req.headers['content-md5'] !== md5(body)) { res.statusCode = 400; return res.end(''); }
      if (stored.has(key)) { res.statusCode = 412; return res.end(''); }
      stored.set(key, { body }); res.statusCode = 200; res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { stored, gets, base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
}

/* The coordinator, both sides of one hand-over, held in memory. */
function coordinator(b, id) {
  const prefix = `handover/${ORG}/${id}/`;
  const rec = { id, state: 'requested', seal_pub: null, manifest: null, agents: ['Ledger'] };
  const calls = [];
  let n = 0;
  // kosmos#8764: the leaving computer's clock for its grants, when a test packs at another time (null: the real clock).
  const clock = { ms: null };
  const urlOf = (key, signed) => {
    const expMs = (clock.ms || Date.now()) + 15 * 60 * 1000, at = Math.floor(expMs / 1000) * 1000 - 15 * 60 * 1000;
    return `${b.base}/bucket/${key.split('/').map(encodeURIComponent).join('/')}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDTEST%2F20261119%2Fus-east-2%2Fs3%2Faws4_request&X-Amz-Date=${amzDate(at)}&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(signed)}&X-Amz-Signature=00`;
  };
  const sender = crypto.generateKeyPairSync('ed25519');
  const senderB64 = sender.publicKey.export({ format: 'jwk' }).x;   // base64url of the raw 32 bytes, as the coordinator stores it
  const recv = async (method, route, body) => {
    calls.push([route, body]);
    if (route === hr.MINE_ROUTE) {
      const row = { id, side: 'receive', state: rec.state, agents: rec.agents, seal_pub: rec.seal_pub, sender_pubkey: 'sender_pubkey' in rec ? rec.sender_pubkey : senderB64 };
      // kosmos#8764: escrowd's signed record (an admin approved m-leave -> m-succ for these agents), on both sides.
      row.record = 'record' in rec ? rec.record : signedRecord(id, rec.agents);
      if (rec.manifest && (rec.state === 'packed' || rec.state === 'receiving')) {
        row.manifest = rec.manifest;
        // kosmos#8733: the leaving member and escrowd's signed history for them, as kosmos-relay's /mine gives them.
        row.sender_member = 'm-leave';
        row.sender_history = 'sender_history' in rec ? rec.sender_history : signedHistory(ORG, 'm-leave', sender.publicKey);
      }
      return { ok: true, data: { handovers: [row] } };
    }
    if (route === hr.KEY_ROUTE) {
      if (rec.state !== 'requested') return { ok: false, because: 'refused (HTTP 409 on /v1/mac/org/handover/key, code handover_wrong_state)' };
      // kosmos#8733: as kosmos-relay's /key does, the key must be signed by this computer's own device key.
      const msg = seal.sealMessage(id, body.pubkey);
      if (!msg || typeof body.sig !== 'string' || !crypto.verify(null, msg, SUCC.publicKey, Buffer.from(body.sig, 'base64url'))) return { ok: false, because: 'refused (HTTP 400 on /v1/mac/org/handover/key, code handover_bad_seal_sig)' };
      rec.seal_pub = body.pubkey; rec.seal_sig = body.sig; rec.state = 'packing'; return { ok: true, data: { ok: true, state: 'packing' } };
    }
    if (route === hr.READ_ROUTE) {
      if (rec.state === 'packed') rec.state = 'receiving';
      return { ok: true, data: { reads: body.keys.map((k) => ({ key: k, url: urlOf(k, 'host') })) } };
    }
    if (route === hr.DONE_ROUTE) { rec.state = body.ok ? 'done' : 'failed'; return { ok: true, data: { ok: true, state: rec.state } }; }
    return { ok: false, because: `refused (HTTP 404 on ${route})` };
  };
  /* The leaving computer's half, through the real snapshot. */
  const send = async (method, route, body) => {
    if (route === up.HANDOVER_GRANT_ROUTE) {
      const expMs = (clock.ms || Date.now()) + 15 * 60 * 1000;
      return { ok: true, data: { expires_at: iso(expMs), uploads: body.chunks.map((c) => { const key = `${prefix}c${++n}`; return { key, url: urlOf(key, 'content-length;content-md5;host;if-none-match'), headers: { 'content-md5': c.md5, 'if-none-match': '*' } }; }) } };
    }
    if (route === up.HANDOVER_MANIFEST_ROUTE) {
      const key = `${prefix}manifest`;
      rec.state = 'packed'; rec.manifest = { key, sha256: body.sha256, size: body.size };
      return { ok: true, data: { expires_at: iso((clock.ms || Date.now()) + 15 * 60 * 1000), upload: { key, url: urlOf(key, 'content-length;host;if-none-match;x-amz-checksum-sha256'), headers: { 'x-amz-checksum-sha256': body.sha256, 'if-none-match': '*' } } } };
    }
    return { ok: false, because: 'refused' };
  };
  return { rec, calls, recv, send, sender, prefix, clock };
}

function agentFolder(t) {
  const base = fresh(t, 'sender');
  const dir = path.join(base, 'ledger');
  fs.mkdirSync(path.join(dir, 'Files'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# You are Ledger\nYou keep the ledger.\n');
  fs.writeFileSync(path.join(dir, 'Files', 'q3.txt'), 'quarter three\n');
  return dir;
}

async function pack(c, dir, atMs) {
  const pk = Buffer.from(c.rec.seal_pub, 'base64');
  const nk = crypto.randomBytes(32);
  const r = await snap.takeSnapshot({ roots: [{ name: 'workers/ledger', path: dir }], memberPk: pk, namingKey: nk, namingKeyId: require('./backupkeys').namingKeyId(nk),
    deviceKey: c.sender.privateKey, ctx: snap.handoverContext(ORG, c.rec.id), handover: { id: c.rec.id, prefix: c.prefix } }, Object.assign({ macRequest: c.send, fetch, sleep: async () => {} }, atMs ? { now: () => atMs } : {}));
  assert.equal(r.ok, true, r.because);
}

const stateNew = () => hr.newState();

test('end to end: key kept before it is sent, the pack received into a "Handed over" Kosmos, done, key gone', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'ho1');
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, member: 'Ann Lee', fetch };
  const st = stateNew();
  // requested: the key is on disk before /key is sent.
  let wroteFirst = null;
  const recvWatch = async (m, route, body) => { if (route === hr.KEY_ROUTE) wroteFirst = !!hr.readKey('ho1', root) && hr.readKey('ho1', root).pk.toString('base64') === body.pubkey; return c.recv(m, route, body); };
  assert.equal((await hr.tick(st, Object.assign({}, deps, { macRequest: recvWatch }))).ok, true);
  assert.equal(wroteFirst, true);
  assert.equal(c.rec.state, 'packing');
  if (typeof process.getuid === 'function') assert.equal(fs.statSync(path.join(root, 'handover', 'ho1.key.json')).mode & 0o777, 0o600);   // POSIX file modes only
  // packing: nothing to do yet.
  assert.deepEqual(await hr.tick(st, deps), { ok: true, none: true });
  // The leaving computer packs; then this one receives.
  await pack(c, agentFolder(t));
  const r = await hr.tick(st, deps);
  assert.equal(r.ok, true, r.because);
  assert.equal(c.rec.state, 'done');
  assert.equal(hr.readKey('ho1', root), null, 'the one-time key is gone');
  const w = worlds.readRegistry(base).worlds.find((x) => /^Handed over: Ann Lee, /.test(x.name));
  assert.ok(w, 'a "Handed over" Kosmos is on the list');
  const workers = worlds.envOverridesFor(base, w).AGENT_WORKFORCE_WORKERS;
  assert.equal(fs.readFileSync(path.join(workers, 'ledger', 'CLAUDE.md'), 'utf8'), '# You are Ledger\nYou keep the ledger.\n');
  assert.equal(fs.readFileSync(path.join(workers, 'ledger', 'Files', 'q3.txt'), 'utf8'), 'quarter three\n');
  // Done is not asked again.
  const before = c.calls.length;
  await hr.tick(st, deps);
  assert.equal(c.calls.filter(([x]) => x === hr.DONE_ROUTE).length, 1);
  assert.ok(c.calls.length > before);
});

test('a lost /key answer sends the same public half again; a key that cannot be kept sends nothing', async (t) => {
  const root = fresh(t, 'data');
  const sent = [];
  const state = 'requested';
  const mac = async (m, route, body) => {
    if (route === hr.MINE_ROUTE) return { ok: true, data: { handovers: [{ id: 'ho2', side: 'receive', state, seal_pub: null }] } };
    if (route === hr.KEY_ROUTE) { sent.push(body.pubkey); return { ok: false, because: 'no answer' }; }
    return { ok: false };
  };
  await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, macRequest: mac, root });
  await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, macRequest: mac, root });
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1], 'the same key both times');
  // A key that cannot be kept: nothing is sent.
  sent.length = 0;
  const r = await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, macRequest: mac, root: fresh(t, 'data2'), writeKey: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } });
  assert.match(r.because, /could not be kept on this computer, so none was sent/);
  assert.equal(sent.length, 0);
});

test('refusals end the hand-over as failed, once, and leave no Kosmos: a foreign key, a lost key, no packing computer, a wrong manifest', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  const cases = [
    ['foreign seal_pub', (c) => { c.rec.seal_pub = Buffer.alloc(32, 7).toString('base64'); }, /sealed to a key this computer does not hold/],
    ['key lost from this computer', (c, root) => { fs.rmSync(path.join(root, 'handover'), { recursive: true, force: true }); }, /no longer on this computer/],
    ['no sender_pubkey', (c) => { c.rec.sender_pubkey = null; }, /no longer known to Kosmos\+/],
    // kosmos#8733: the packing key checked against escrowd's signed history for the LEAVING member.
    ['a packing key escrowd lists for the leaving member but revoked', (c) => { c.rec.sender_history = signedHistory(ORG, 'm-leave', c.sender.publicKey, null, [{ kind: 'revoke', key: seal.keyHex(c.sender.publicKey), at: 1 }]); }, /no longer the leaving member's/],
    ['a history for another member', (c) => { c.rec.sender_history = signedHistory(ORG, 'm-other', c.sender.publicKey); }, /names a different member/],
    // Review 5: revoked an hour ago, and this pack was made just now, so after the revocation: refused at the pack's own
    // signed time (kosmos#8764), as it was at now.
    ['a packing key revoked an hour ago', (c) => { c.rec.sender_history = signedHistory(ORG, 'm-leave', c.sender.publicKey, null, [{ kind: 'revoke', key: seal.keyHex(c.sender.publicKey), at: Math.floor(Date.now() / 1000) - 3600 }]); }, /no longer the leaving member's/],
    ['a backfilled packing key (escrowd never upgrades it)', (c) => { c.rec.sender_history = signedHistory(ORG, 'm-leave', c.sender.publicKey, { backfill: true }); }, /carried over from before/],
    ['manifest not the recorded one', (c) => { c.rec.manifest.sha256 = sha256b(Buffer.from('other')); }, /not the one Kosmos\+ recorded/],
    ['a chunk that is not what was signed', (c) => { const k = [...b.stored.keys()].find((x) => x.startsWith(c.prefix) && !x.endsWith('manifest')); const v = b.stored.get(k); v.body = Buffer.from(v.body); v.body[v.body.length - 1] ^= 1; }, /not what its sender signed/],
  ];
  for (const [label, spoil, why] of cases) {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const id = 'h' + crypto.randomBytes(4).toString('hex');
    const c = coordinator(b, id);
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch };
    const st = stateNew();
    await hr.tick(st, deps);   // keyed
    await pack(c, agentFolder(t));
    spoil(c, root);
    const r = await hr.tick(st, deps);
    assert.equal(r.ok, false, label);
    assert.match(r.because || '', why, label);
    assert.equal(c.calls.filter(([x, body]) => x === hr.DONE_ROUTE && body.ok === false).length, 1, label + ': done {ok:false}');
    await hr.tick(st, deps);
    assert.equal(c.calls.filter(([x]) => x === hr.DONE_ROUTE).length, 1, label + ': not again');
    assert.equal(worlds.readRegistry(base).worlds.some((x) => /^Handed over/.test(x.name) && !x.hiddenAt), false, label + ': no Kosmos on the list');
    assert.equal(hr.readKey(id, root), null, label + ': the one-time key is gone');
  }
  // CONTROL: the same steps unspoiled receive.
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hctl');
  const st = stateNew();
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch };
  await hr.tick(st, deps);
  await pack(c, agentFolder(t));
  assert.equal((await hr.tick(st, deps)).ok, true);
});

test('a missing manifest gets MISSING_GRACE_MS before it is final; a lost /done is sent again, never received again', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  let clock = Date.now();
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hmiss');
  const st = stateNew();
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
  await hr.tick(st, deps);
  await pack(c, agentFolder(t));
  const saved = b.stored.get(c.rec.manifest.key);
  b.stored.delete(c.rec.manifest.key);
  assert.equal((await hr.tick(st, deps)).ok, false);
  clock += hr.MISSING_GRACE_MS - 1000;
  await hr.tick(st, deps);
  assert.equal(c.calls.filter(([x]) => x === hr.DONE_ROUTE).length, 0, 'still within the grace');
  // The sender's upload lands within the grace: received at the next look (MISSING_RECHECK_MS later).
  b.stored.set(c.rec.manifest.key, saved);
  clock += hr.MISSING_RECHECK_MS + 1;
  // ... but the first /done answer is lost.
  let lose = true;
  const lossy = async (m, route, body) => { const r = await c.recv(m, route, body); if (route === hr.DONE_ROUTE && lose) { lose = false; return { ok: false, because: 'no answer' }; } return r; };
  const d2 = Object.assign({}, deps, { macRequest: lossy });
  assert.match((await hr.tick(st, d2)).because, /did not take the answer/);
  assert.ok(hr.readKey('hmiss', root).received, 'marked received before /done');
  c.rec.state = 'receiving';   // the coordinator never heard the /done
  await hr.tick(st, d2);
  assert.equal(worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name)).length, 1, 'one Kosmos, not two');
  assert.equal(c.calls.filter(([x]) => x === hr.DONE_ROUTE).length, 2);
  assert.equal(hr.readKey('hmiss', root), null);
  // And past the grace with nothing there: final.
  const c2 = coordinator(b, 'hgone');
  const st2 = stateNew();
  const d3 = Object.assign({}, deps, { macRequest: c2.recv });
  await hr.tick(st2, d3);
  await pack(c2, agentFolder(t));
  b.stored.delete(c2.rec.manifest.key);
  await hr.tick(st2, d3);
  clock += hr.MISSING_GRACE_MS;
  const r = await hr.tick(stateNew(), d3);   // a restart: the first miss is kept beside the key
  assert.match(r.because, /never finished arriving/);
  assert.equal(c2.calls.filter(([x, body]) => x === hr.DONE_ROUTE && body.ok === false).length, 1);
});

test('a chunk that does not arrive is tried again after RETRY_MS, MAX_ATTEMPTS times, then final; each try leaves nothing behind', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  let clock = Date.now();
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hretry');
  const st = stateNew();
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
  await hr.tick(st, deps);
  await pack(c, agentFolder(t));
  for (const k of [...b.stored.keys()]) if (k.startsWith(c.prefix) && !k.endsWith('manifest')) b.stored.delete(k);
  for (let i = 1; i < hr.MAX_ATTEMPTS; i++) {
    const r = await hr.tick(st, deps);
    assert.equal(r.ok, false, 'try ' + i);
    assert.deepEqual(await hr.tick(st, deps), { ok: true, none: true }, 'waits RETRY_MS after try ' + i);
    clock += hr.RETRY_MS + 1;
  }
  const last = await hr.tick(st, deps);
  assert.match(last.because, /tried 5 times/);
  assert.equal(c.calls.filter(([x, body]) => x === hr.DONE_ROUTE && body.ok === false).length, 1);
  const handed = worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name));
  assert.equal(handed.filter((x) => !x.hiddenAt).length, 0, 'none on the list');
  for (const w of handed) {
    const dir = path.join(path.dirname(worlds.envOverridesFor(base, w).AGENT_WORKFORCE_WORKERS), require('./restoreworld').RESTORE_DIR);
    assert.equal(fs.existsSync(dir), false, 'a failed try took out its restore folder');
  }
});

test('the read links: https on a named host, a path ending in its key, and a cap on what is read', () => {
  hr.allowHttpForTests(false);
  const k = 'handover/org1/ho1/c1';
  assert.equal(hr.urlProblem(`https://bucket.s3.us-east-2.amazonaws.com/${k}?X-Amz-Signature=1`, k), null);
  assert.equal(hr.urlProblem(`http://bucket.s3.us-east-2.amazonaws.com/${k}`, k), 'not https');
  assert.equal(hr.urlProblem(`https://127.0.0.1/${k}`, k), 'not a named host');
  assert.equal(hr.urlProblem(`https://[::1]/${k}`, k), 'not a named host');
  assert.equal(hr.urlProblem(`https://localhost/${k}`, k), 'not a named host');
  assert.equal(hr.urlProblem(`https://bucket.example/${k}x`, k), 'a path that is not its key');
  assert.equal(hr.urlProblem(`https://bucket.example/other/${k.replace('c1', 'c2')}`, k), 'a path that is not its key');
  assert.equal(hr.urlProblem('nonsense', k), 'not a URL');
  assert.equal(hr.urlProblem(`https://bucket/${k}`, k), 'not a named host', 'a single-label name');
  assert.equal(hr.urlProblem(`https://nas.local/${k}`, k), 'not a named host', 'a .local name');
  hr.allowHttpForTests(true);
});

test('an object outside the hand-over is never asked for, and one past its cap is refused', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  b.stored.set('handover/org1/ho1/big', { body: Buffer.alloc(100) });
  const asked = [];
  const f = hr.readFetcher({ id: 'ho1', prefix: 'handover/org1/ho1/', fetch,
    macRequest: async (m, route, body) => { asked.push(body.keys); return { ok: true, data: { reads: body.keys.map((key) => ({ key, url: `${b.base}/bucket/${key}` })) } }; } });
  assert.equal(await f.fetchObject('handover/org1/ho2/c1'), null);
  assert.equal(asked.length, 0);
  assert.equal(await f.fetchObject('handover/org1/ho1/big', { maxBytes: 99 }), null);
  assert.match(f.state.why, /larger than it can be/);
  assert.equal((await f.fetchObject('handover/org1/ho1/big', { maxBytes: 100 })).length, 100, 'CONTROL: at its cap it is read');
});

test('the packing computer\'s key is read only in the form the coordinator stores it', () => {
  const k = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x;
  assert.ok(hr.senderKeyOf(k));
  assert.equal(hr.senderKeyOf(null), null);
  assert.equal(hr.senderKeyOf(Buffer.from(k, 'base64url').toString('base64')), null, 'standard base64 is not the stored form');
  assert.equal(hr.senderKeyOf(k.slice(0, 42)), null);
});

test('a read link the rules refuse is never fetched', async () => {
  hr.allowHttpForTests(false);
  try {
    let fetched = 0;
    const fakeFetch = async () => { fetched++; return { status: 200, body: [Buffer.from('x')] }; };
    const key = 'handover/org1/ho1/c1';
    const answer = (url) => async (m, route, body) => ({ ok: true, data: { reads: body.keys.map((k) => ({ key: k, url })) } });
    const bad = hr.readFetcher({ id: 'ho1', prefix: 'handover/org1/ho1/', fetch: fakeFetch, macRequest: answer(`https://127.0.0.1/${key}`) });
    assert.equal(await bad.fetchObject(key), null);
    assert.match(bad.state.why, /will not use \(not a named host\)/);
    assert.equal(fetched, 0);
    // CONTROL: the same answer with a named https host is fetched.
    const good = hr.readFetcher({ id: 'ho1', prefix: 'handover/org1/ho1/', fetch: fakeFetch, macRequest: answer(`https://bucket.s3.us-east-2.amazonaws.com/${key}`) });
    assert.equal(String(await good.fetchObject(key)), 'x');
    assert.equal(fetched, 1);
  } finally { hr.allowHttpForTests(true); }
});

test('a refused /mine (an older connector) makes no key and reads nothing; off unless KOSMOS_ORG_HANDOVER=1', async (t) => {
  const root = fresh(t, 'data');
  const routes = [];
  const r = await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root, macRequest: async (m, route) => { routes.push(route); return { ok: false, notSent: true, because: 'mac-request does not sign that' }; } });
  assert.equal(r.ok, false);
  assert.deepEqual(routes, [hr.MINE_ROUTE]);
  assert.equal(fs.existsSync(path.join(root, 'handover')), false, 'no key was made');
  assert.equal(hr.startHere({}), null);
  // Not in a company that may send: nothing is asked.
  routes.length = 0;
  assert.deepEqual(await hr.tick(stateNew(), { org: () => null, root, macRequest: async (m, route) => { routes.push(route); return { ok: true, data: {} }; } }), { ok: true, none: true });
  assert.deepEqual(routes, []);
});

test('the attempt count survives a restart; a try that stopped part way is taken out first; no base spends no attempt', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  let clock = Date.now();
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hpers');
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
  await hr.tick(stateNew(), deps);
  await pack(c, agentFolder(t));
  // No base: nothing counted.
  await hr.tick(stateNew(), Object.assign({}, deps, { base: null }));
  assert.equal(hr.readKey('hpers', root).attempts, undefined);
  // Chunks gone: each try counts, across fresh states (restarts).
  const saved = new Map([...b.stored].filter(([k]) => k.startsWith(c.prefix) && !k.endsWith('manifest')));
  for (const k of saved.keys()) b.stored.delete(k);
  for (let i = 1; i <= 2; i++) { await hr.tick(stateNew(), deps); assert.equal(hr.readKey('hpers', root).attempts, i); }
  // A try that died part way: its Kosmos is noted as restoring; the next tick takes it out before trying again.
  const rw = require('./restoreworld');
  const stale = rw.prepareRestoreWorld(base, { member: 'x', memberId: 'hpers', kind: 'handover' });
  hr.updateKey('hpers', root, { restoring: stale.world.id });
  for (const [k, v] of saved) b.stored.set(k, v);
  assert.equal((await hr.tick(stateNew(), deps)).ok, true);
  assert.equal(fs.existsSync(stale.dir), false, 'the stopped try\'s folder is gone');
  assert.ok(worlds.readRegistry(base).worlds.find((x) => x.id === stale.world.id).hiddenAt, 'and it is off the list');
  assert.equal(worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name) && !x.hiddenAt).length, 1, 'one copy on the list');
});

test('a damaged key while still requested is replaced, and later rows are not starved', async (t) => {
  const root = fresh(t, 'data');
  fs.mkdirSync(path.join(root, 'handover'), { recursive: true });
  fs.writeFileSync(path.join(root, 'handover', 'hbad.key.json'), '{not json');
  const sent = [];
  const mac = async (m, route, body) => {
    if (route === hr.MINE_ROUTE) return { ok: true, data: { handovers: [{ id: 'hbad', side: 'receive', state: 'requested' }, { id: 'hnext', side: 'receive', state: 'requested' }] } };
    if (route === hr.KEY_ROUTE) { sent.push(body.id); return { ok: true, data: {} }; }
    return { ok: false };
  };
  await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, macRequest: mac, root });
  assert.deepEqual(sent, ['hbad', 'hnext']);
  assert.equal(hr.readKey('hbad', root).problem, undefined, 'a good key replaced the damaged one');
});

test('a key write that fails leaves no temp file holding the secret', (t) => {
  const root = fresh(t, 'data');
  fs.mkdirSync(path.join(root, 'handover', 'hdir.key.json', 'x'), { recursive: true });   // the rename target is a non-empty folder
  assert.throws(() => hr.writeKey('hdir', require('./hpke').hpkeKeyPair(), root));
  assert.deepEqual(fs.readdirSync(path.join(root, 'handover')).filter((n) => n.endsWith('.tmp')), []);
});

test('a refusal is noted, so a /done that fails is sent again alone; a full disk is this computer\'s, retried, never the sender\'s', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hfin');
  let doneFails = true;
  const mac = async (m, route, body) => (route === hr.DONE_ROUTE && doneFails ? { ok: false, because: 'no answer' } : c.recv(m, route, body));
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: mac, root, base, fetch };
  await hr.tick(stateNew(), deps);
  await pack(c, agentFolder(t));
  c.rec.manifest.sha256 = sha256b(Buffer.from('other'));
  await hr.tick(stateNew(), deps);
  assert.match(hr.readKey('hfin', root).final, /not the one Kosmos\+ recorded/);
  const reads = c.calls.filter(([x]) => x === hr.READ_ROUTE).length;
  doneFails = false;
  await hr.tick(stateNew(), deps);
  assert.equal(c.calls.filter(([x]) => x === hr.READ_ROUTE).length, reads, 'nothing read again');
  assert.equal(c.rec.state, 'failed');
  assert.equal(hr.readKey('hfin', root), null);
  // No room: not final, said as this computer's.
  const c2 = coordinator(b, 'hroom');
  const root2 = fresh(t, 'data');
  const d2 = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c2.recv, root: root2, base, fetch, maxTotalBytes: 1 };
  await hr.tick(stateNew(), d2);
  await pack(c2, agentFolder(t));
  const r = await hr.tick(stateNew(), d2);
  assert.match(r.because, /could not be written on this computer \(no room left/);
  assert.equal(c2.calls.filter(([x]) => x === hr.DONE_ROUTE).length, 0, 'the hand-over is not ended');
  assert.equal(hr.readKey('hroom', root2).attempts, 1);
});

test('cleanup never removes a Kosmos a person put something in: it is hidden, its files left', async (t) => {
  const base = fresh(t, 'base');
  const rw = require('./restoreworld');
  const used = rw.prepareRestoreWorld(base, { member: 'x', memberId: 'hused', kind: 'handover' });
  const workers = worlds.envOverridesFor(base, used.world).AGENT_WORKFORCE_WORKERS;
  fs.mkdirSync(path.join(workers, 'mine'), { recursive: true });
  fs.writeFileSync(path.join(workers, 'mine', 'CLAUDE.md'), '# You are Mine\n');
  const root = fresh(t, 'data');
  hr.writeKey('hused', require('./hpke').hpkeKeyPair(), root, { restoring: used.world.id, expect: ['ledger'] });   // the person's 'mine' is not the expected 'ledger'
  const kp = hr.readKey('hused', root);
  // The tick's restart cleanup on this key (a packed row, no pack to read: the cleanup runs before the try).
  await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root, base, fetch, macRequest: async (m, route) => (route === hr.MINE_ROUTE
    ? { ok: true, data: { handovers: [{ id: 'hused', side: 'receive', state: 'packed', seal_pub: kp.pk.toString('base64'), sender_pubkey: null }] } }
    : { ok: true, data: {} }) });
  assert.equal(fs.readFileSync(path.join(workers, 'mine', 'CLAUDE.md'), 'utf8'), '# You are Mine\n', 'the person\'s agent is still there');
  assert.ok(fs.existsSync(used.restoreDir), 'and its restore folder is kept: something was put in its workers');
  assert.ok(worlds.readRegistry(base).worlds.find((x) => x.id === used.world.id).hiddenAt, 'hidden');
  // CONTROL: an untouched Kosmos is removed.
  const clean = rw.prepareRestoreWorld(base, { member: 'y', memberId: 'hclean', kind: 'handover' });
  hr.writeKey('hclean', require('./hpke').hpkeKeyPair(), root, { restoring: clean.world.id });
  const kp2 = hr.readKey('hclean', root);
  await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root, base, fetch, macRequest: async (m, route) => (route === hr.MINE_ROUTE
    ? { ok: true, data: { handovers: [{ id: 'hclean', side: 'receive', state: 'packed', seal_pub: kp2.pk.toString('base64'), sender_pubkey: null }] } }
    : { ok: true, data: {} }) });
  assert.equal(fs.existsSync(clean.dir), false);
});

test('a key whose hand-over is no longer listed is removed once a day old; a listed or recent one is kept', (t) => {
  const root = fresh(t, 'data');
  for (const id of ['hold', 'hopen', 'hnew']) hr.writeKey(id, require('./hpke').hpkeKeyPair(), root);
  const old = (Date.now() - hr.STALE_KEY_MS - 1000) / 1000;
  for (const id of ['hold', 'hopen']) fs.utimesSync(path.join(root, 'handover', `${id}.key.json`), old, old);
  fs.writeFileSync(path.join(root, 'handover', 'notes.txt'), 'not a key');
  hr.sweepKeys(new Set(['hopen']), Date.now(), root);
  assert.equal(hr.readKey('hold', root), null);
  assert.ok(hr.readKey('hopen', root));
  assert.ok(hr.readKey('hnew', root));
  assert.ok(fs.existsSync(path.join(root, 'handover', 'notes.txt')), 'only key files');
});

test('round 4: an outage spends no attempt; a crash after finish is the received copy; an orphan is tidied; data in the Kosmos blocks removal; a refused /done does not hold later rows', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  let clock = Date.now();
  // Outage: /read does not answer.
  {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, 'hout');
    let down = false;
    const mac = async (m, route, body) => (down && route === hr.READ_ROUTE ? { ok: false, because: 'Kosmos+ did not answer' } : c.recv(m, route, body));
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: mac, root, base, fetch, now: () => clock };
    await hr.tick(stateNew(), deps);
    await pack(c, agentFolder(t));
    down = true;
    for (let i = 0; i < hr.MAX_ATTEMPTS + 2; i++) { await hr.tick(stateNew(), deps); clock += hr.RETRY_MS + 1; }
    assert.equal(hr.readKey('hout', root).attempts, undefined, 'no attempt spent on an outage');
    assert.equal(c.calls.filter(([x]) => x === hr.DONE_ROUTE).length, 0);
  }
  // A crash after finish, before the received note: restoring + expect name a finished Kosmos.
  {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, 'hcrash');
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
    await hr.tick(stateNew(), deps);
    await pack(c, agentFolder(t));
    assert.equal((await hr.tick(stateNew(), deps)).ok, true);
    const w = worlds.readRegistry(base).worlds.find((x) => /^Handed over/.test(x.name));
    // Rewind the note as if the board died between finish and the received mark.
    const kpBefore = { sk: Buffer.alloc(32, 1), pk: require('./hpke').hpkeKeyPair().pk };
    hr.writeKey('hcrash2', kpBefore, root, { restoring: w.id, expect: ['ledger'] });
    c.rec.id = 'hcrash2'; c.rec.state = 'receiving'; c.rec.seal_pub = kpBefore.pk.toString('base64');
    const mac2 = async (m, route, body) => (route === hr.MINE_ROUTE ? { ok: true, data: { handovers: [{ id: 'hcrash2', side: 'receive', state: 'receiving', seal_pub: c.rec.seal_pub, sender_pubkey: null }] } } : c.recv(m, route, body));
    const r = await hr.tick(stateNew(), Object.assign({}, deps, { macRequest: mac2 }));
    assert.equal(r.ok, true, 'read as received');
    assert.equal(worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name) && !x.hiddenAt).length, 1, 'the finished copy kept, no second');
  }
  // An orphan: a Kosmos made for this hand-over that nothing records, untouched, is taken out before the next try.
  {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, 'horph');
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
    await hr.tick(stateNew(), deps);
    await pack(c, agentFolder(t));
    const orphan = require('./restoreworld').prepareRestoreWorld(base, { member: 'a colleague', memberId: 'horph', kind: 'handover' });
    assert.equal((await hr.tick(stateNew(), deps)).ok, true);
    assert.equal(fs.existsSync(orphan.dir), false, 'the orphan is gone');
    assert.equal(worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name) && !x.hiddenAt).length, 1);
  }
  // Data in the Kosmos's own data folder blocks removal.
  {
    const base = fresh(t, 'base'), root = fresh(t, 'data');
    const p = require('./restoreworld').prepareRestoreWorld(base, { member: 'z', memberId: 'hdata', kind: 'handover' });
    fs.writeFileSync(path.join(p.dir, 'Kosmos', 'chat.json'), '{}');
    hr.writeKey('hdata', require('./hpke').hpkeKeyPair(), root, { restoring: p.world.id, expect: ['ledger'] });
    const kp = hr.readKey('hdata', root);
    await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root, base, fetch, macRequest: async (m, route) => (route === hr.MINE_ROUTE
      ? { ok: true, data: { handovers: [{ id: 'hdata', side: 'receive', state: 'packed', seal_pub: kp.pk.toString('base64'), sender_pubkey: null }] } } : { ok: true, data: {} }) });
    assert.ok(fs.existsSync(path.join(p.dir, 'Kosmos', 'chat.json')), 'a person\'s data is kept');
  }
  // A refused /done does not hold the rows after it.
  {
    const root = fresh(t, 'data');
    hr.writeKey('hstuck', require('./hpke').hpkeKeyPair(), root, { final: 'refused before' });
    const keyed = [];
    const mac = async (m, route, body) => {
      if (route === hr.MINE_ROUTE) return { ok: true, data: { handovers: [{ id: 'hstuck', side: 'receive', state: 'packed' }, { id: 'hlater', side: 'receive', state: 'requested' }] } };
      if (route === hr.DONE_ROUTE) return { ok: false, because: 'refused' };
      if (route === hr.KEY_ROUTE) { keyed.push(body.id); return { ok: true, data: {} }; }
      return { ok: false };
    };
    await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, macRequest: mac, root, base: fresh(t, 'base') });
    assert.deepEqual(keyed, ['hlater']);
  }
});

test('round 5: a listed key stays fresh; an unreadable key waits; a day-long outage ends it; a stopped finish is finished again; a final close takes out a half-made Kosmos', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  let clock = Date.now();
  // Listed keys are touched, so a long packing wait never ages them out.
  {
    const root = fresh(t, 'data');
    hr.writeKey('hwait', require('./hpke').hpkeKeyPair(), root);
    const f = path.join(root, 'handover', 'hwait.key.json');
    const old = (clock - 3 * hr.STALE_KEY_MS) / 1000;
    fs.utimesSync(f, old, old);
    hr.sweepKeys(new Set(['hwait']), clock, root);
    hr.sweepKeys(new Set([]), clock + 1000, root);   // one empty answer right after
    assert.ok(hr.readKey('hwait', root), 'kept: it was listed a moment ago');
  }
  // An unreadable key past requested waits instead of ending the hand-over.
  if (process.getuid && process.getuid() !== 0) {
    const root = fresh(t, 'data');
    hr.writeKey('hunread', require('./hpke').hpkeKeyPair(), root);
    const f = path.join(root, 'handover', 'hunread.key.json');
    fs.chmodSync(f, 0o000);
    t.after(() => { try { fs.chmodSync(f, 0o600); } catch { /* gone */ } });
    let done = 0;
    await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root, base: fresh(t, 'base'), macRequest: async (m, route) => {
      if (route === hr.MINE_ROUTE) return { ok: true, data: { handovers: [{ id: 'hunread', side: 'receive', state: 'packed' }] } };
      if (route === hr.DONE_ROUTE) done++;
      return { ok: true, data: {} };
    } });
    assert.equal(done, 0, 'no done for a key that could not be read');
  }
  // An outage that lasts a day ends the hand-over.
  {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, 'hlong');
    const mac = async (m, route, body) => (route === hr.READ_ROUTE && c.rec.manifest ? { ok: false, because: 'Kosmos+ did not answer' } : c.recv(m, route, body));
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: mac, root, base, fetch, now: () => clock };
    await hr.tick(stateNew(), deps);
    await pack(c, agentFolder(t));
    await hr.tick(stateNew(), deps);
    clock += 24 * 60 * 60 * 1000;
    const r = await hr.tick(stateNew(), deps);
    assert.match(r.because, /could not give this computer the pack for a day/);
    assert.equal(c.rec.state, 'failed');
  }
  // A finish that stopped part way is finished again in the same Kosmos, not received twice.
  {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, 'hrefin');
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
    await hr.tick(stateNew(), deps);
    await pack(c, agentFolder(t));
    const rw = require('./restoreworld');
    const keep = rw.finishRestoreWorld;
    rw.finishRestoreWorld = () => ({ ok: false, because: 'stopped part way' });
    try { assert.equal((await hr.tick(stateNew(), deps)).ok, false); } finally { rw.finishRestoreWorld = keep; }
    assert.ok(hr.readKey('hrefin', root).restoring, 'the unfinished Kosmos is still noted');
    clock += hr.RETRY_MS + 1;
    assert.equal((await hr.tick(stateNew(), deps)).ok, true);
    const live = worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name) && !x.hiddenAt);
    assert.equal(live.length, 1, 'one copy');
    assert.equal(worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name)).length, 1, 'finished in the same Kosmos: no second one made, hidden or not');
    assert.ok(fs.existsSync(path.join(worlds.envOverridesFor(base, live[0]).AGENT_WORKFORCE_WORKERS, 'ledger', 'CLAUDE.md')));
  }
  // A final close takes out a half-made Kosmos noted as restoring.
  {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const half = require('./restoreworld').prepareRestoreWorld(base, { member: 'q', memberId: 'hhalf', kind: 'handover' });
    hr.writeKey('hhalf', require('./hpke').hpkeKeyPair(), root, { restoring: half.world.id, expect: ['ledger'] });
    await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root, base, fetch, macRequest: async (m, route) => (route === hr.MINE_ROUTE
      ? { ok: true, data: { handovers: [{ id: 'hhalf', side: 'receive', state: 'packed', seal_pub: Buffer.alloc(32, 9).toString('base64') }] } } : { ok: true, data: {} }) });
    assert.equal(fs.existsSync(half.dir), false, 'removed before the hand-over ended');
  }
});

test('round 6: an oversize manifest is final; a 4xx spends an attempt; an unreadable key while requested is kept; a finished copy is never tidied away', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  let clock = Date.now();
  {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, 'hbig');
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
    await hr.tick(stateNew(), deps);
    await pack(c, agentFolder(t));
    c.rec.manifest.size -= 1;   // the store serves more than the record says
    const r = await hr.tick(stateNew(), deps);
    assert.match(r.because, /not the one Kosmos\+ recorded/);
    assert.equal(c.rec.state, 'failed');
  }
  {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, 'hforb');
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
    await hr.tick(stateNew(), deps);
    await pack(c, agentFolder(t));
    const real = b.stored.get(c.rec.manifest.key);
    b.stored.delete(c.rec.manifest.key);
    const forbid = async (url, o) => (String(url).includes('/manifest') ? { status: 403, body: null } : fetch(url, o));
    await hr.tick(stateNew(), Object.assign({}, deps, { fetch: forbid }));
    assert.equal(hr.readKey('hforb', root).attempts, 1, 'a 403 is an attempt');
    b.stored.set(c.rec.manifest.key, real);
  }
  if (process.getuid && process.getuid() !== 0) {
    const root = fresh(t, 'data');
    hr.writeKey('hreq', require('./hpke').hpkeKeyPair(), root);
    const f = path.join(root, 'handover', 'hreq.key.json');
    const before = fs.readFileSync(f, 'utf8');
    fs.chmodSync(f, 0o000);
    t.after(() => { try { fs.chmodSync(f, 0o600); } catch { /* gone */ } });
    const sent = [];
    await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root, macRequest: async (m, route, body) => {
      if (route === hr.MINE_ROUTE) return { ok: true, data: { handovers: [{ id: 'hreq', side: 'receive', state: 'requested' }] } };
      if (route === hr.KEY_ROUTE) sent.push(body.pubkey);
      return { ok: true, data: {} };
    } });
    fs.chmodSync(f, 0o600);
    assert.equal(fs.readFileSync(f, 'utf8'), before, 'the key was kept, not replaced');
    assert.deepEqual(sent, []);
  }
  {
    // A finished copy whose received note was lost: the sweep and a final close leave it.
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, 'hfin2');
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
    await hr.tick(stateNew(), deps);
    await pack(c, agentFolder(t));
    assert.equal((await hr.tick(stateNew(), deps)).ok, true);
    const w = worlds.readRegistry(base).worlds.find((x) => /^Handed over/.test(x.name) && !x.hiddenAt);
    hr.writeKey('hgone', require('./hpke').hpkeKeyPair(), root, { restoring: w.id, expect: ['ledger'] });
    const old = (clock - 2 * hr.STALE_KEY_MS) / 1000;
    fs.utimesSync(path.join(root, 'handover', 'hgone.key.json'), old, old);
    hr.sweepKeys(new Set(), clock, root, base);
    assert.equal(worlds.readRegistry(base).worlds.find((x) => x.id === w.id).hiddenAt, undefined, 'the finished copy stays on the list');
    assert.ok(fs.existsSync(path.join(worlds.envOverridesFor(base, w).AGENT_WORKFORCE_WORKERS, 'ledger', 'CLAUDE.md')));
  }
});

test('round 7: finishing again keeps failing but the agents are in place: received, one copy, nothing hidden', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hstuckfin');
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch };
  await hr.tick(stateNew(), deps);
  await pack(c, agentFolder(t));
  assert.equal((await hr.tick(stateNew(), deps)).ok, true);
  const w = worlds.readRegistry(base).worlds.find((x) => /^Handed over/.test(x.name));
  const kp = { sk: Buffer.alloc(32, 2), pk: require('./hpke').hpkeKeyPair().pk };
  hr.writeKey('hstuck2', kp, root, { restoring: w.id, expect: ['ledger'] });
  const rw = require('./restoreworld');
  const keep = rw.finishRestoreWorld;
  rw.finishRestoreWorld = () => ({ ok: false, because: 'this Kosmos already has files where the restore would put them' });
  let done = null;
  try {
    await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root, base, fetch, macRequest: async (m, route, body) => {
      if (route === hr.MINE_ROUTE) return { ok: true, data: { handovers: [{ id: 'hstuck2', side: 'receive', state: 'receiving', seal_pub: kp.pk.toString('base64'), sender_pubkey: null }] } };
      if (route === hr.DONE_ROUTE) { done = body; return { ok: true, data: {} }; }
      return { ok: true, data: {} };
    } });
  } finally { rw.finishRestoreWorld = keep; }
  assert.deepEqual(done, { id: 'hstuck2', ok: true });
  const rows = worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name));
  assert.equal(rows.length, 1, 'no second copy');
  assert.equal(rows[0].hiddenAt, undefined, 'and it is not hidden');
});

test('round 8: a restore that throws is a counted try, bounded by the ceiling; a link with credentials or another port is refused', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  let clock = Date.now();
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hthrow');
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
  await hr.tick(stateNew(), deps);
  await pack(c, agentFolder(t));
  const br = require('./backuprestore');
  const keep = br.restoreSnapshot;
  br.restoreSnapshot = async () => { throw new Error('boom'); };
  try {
    for (let i = 1; i < hr.MAX_ATTEMPTS; i++) { await hr.tick(stateNew(), deps); assert.equal(hr.readKey('hthrow', root).attempts, i, 'try ' + i); clock += hr.RETRY_MS + 1; }
    await hr.tick(stateNew(), deps);
  } finally { br.restoreSnapshot = keep; }
  assert.equal(c.rec.state, 'failed', 'ended at the ceiling');
  // A receive that throws outright is counted too.
  const root2 = fresh(t, 'data');
  hr.writeKey('hthrow2', require('./hpke').hpkeKeyPair(), root2);
  const kp = hr.readKey('hthrow2', root2);
  await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, root: root2, base, fetch, receive: async () => { throw new Error('boom'); }, macRequest: async (m, route) => (route === hr.MINE_ROUTE
    ? { ok: true, data: { handovers: [{ id: 'hthrow2', side: 'receive', state: 'packed', seal_pub: kp.pk.toString('base64') }] } } : { ok: true, data: {} }) });
  assert.equal(hr.readKey('hthrow2', root2).attempts, 1);
  hr.allowHttpForTests(false);
  try {
    const k = 'handover/org1/ho1/c1';
    assert.equal(hr.urlProblem(`https://u:p@bucket.s3.us-east-2.amazonaws.com/${k}`, k), 'a link carrying a name or password');
    assert.equal(hr.urlProblem(`https://bucket.s3.us-east-2.amazonaws.com:8443/${k}`, k), 'a link to another port');
    assert.equal(hr.urlProblem(`https://bucket.s3.us-east-2.amazonaws.com/${k}`, k), null, 'CONTROL: no port (URL drops a written :443, so that spelling tests nothing more)');
  } finally { hr.allowHttpForTests(true); }
});

test('round 9: a try that fails after its finish put the agents in place, at the ceiling, ends received, not failed', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  let clock = Date.now();
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hceil');
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
  await hr.tick(stateNew(), deps);
  await pack(c, agentFolder(t));
  hr.updateKey('hceil', root, { attempts: hr.MAX_ATTEMPTS - 1 });   // this is the last try
  const rw = require('./restoreworld');
  const keep = rw.finishRestoreWorld;
  // The finish moves the agents into place, then fails.
  rw.finishRestoreWorld = (o) => { keep(o); throw new Error('failed after moving'); };
  try { await hr.tick(stateNew(), deps); } finally { rw.finishRestoreWorld = keep; }
  assert.equal(c.rec.state, 'done', 'received, not failed');
  assert.equal(worlds.readRegistry(base).worlds.filter((x) => /^Handed over/.test(x.name) && !x.hiddenAt).length, 1);
});

test('end to end through BOTH halves: the real packer (handoversend.packInput) packs, the receiver receives, and the agent lands with its files', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  const hs = require('./handoversend');
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'hboth');
  const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch };
  await hr.tick(stateNew(), deps);   // the successor's key
  const dir = agentFolder(t);
  // kosmos#8733: the sender's REAL tie check, on the signature this computer's REAL key step made.
  const p = hs.packInput({ id: 'hboth', seal_pub: c.rec.seal_pub, agents: ['Ledger'], seal_sig: c.rec.seal_sig, seal_signer: seal.keyHex(SUCC.publicKey),
    seal_member: 'm-succ', seal_history: signedHistory(ORG, 'm-succ', SUCC.publicKey),
    // kosmos#8764: escrowd's record (an admin approved m-leave -> m-succ for Ledger) and the leaving member's own history.
    record: (() => {
      const r = { org: ORG, id: 'hboth', from: 'm-leave', to: 'm-succ', agents: ['Ledger'], issuedAt: Math.floor(Date.now() / 1000) };
      return Object.assign(r, { signature: crypto.sign(null, seal.encodeRecord(r), ESCROWD.privateKey).toString('base64url') });
    })(),
    own_history: signedHistory(ORG, 'm-leave', c.sender.publicKey) }, ORG, {
    survey: () => ({ ok: true, agents: [{ name: 'ledger', shownAs: 'Ledger', profile: true, removed: false }] }),
    inputsHere: () => ({ protect: [], workersDir: path.dirname(dir), agents: [{ id: 'ledger', dir }], projects: [], sessions: () => [] }),
    workerDir: () => dir,
    deviceKey: () => ({ ok: true, privateKey: c.sender.privateKey }),
  });
  assert.equal(p.ok, true, p.because);
  assert.deepEqual(p.input.roots.map((r) => r.name), ['workers/ledger']);
  const r = await snap.takeSnapshot(p.input, { macRequest: c.send, fetch, sleep: async () => {} });
  assert.equal(r.ok, true, r.because);
  const got = await hr.tick(stateNew(), deps);
  assert.equal(got.ok, true, got.because);
  assert.equal(c.rec.state, 'done');
  const w = worlds.readRegistry(base).worlds.find((x) => /^Handed over/.test(x.name) && !x.hiddenAt);
  const workers = worlds.envOverridesFor(base, w).AGENT_WORKFORCE_WORKERS;
  assert.equal(fs.readFileSync(path.join(workers, 'ledger', 'CLAUDE.md'), 'utf8'), '# You are Ledger\nYou keep the ledger.\n');
  assert.equal(fs.readFileSync(path.join(workers, 'ledger', 'Files', 'q3.txt'), 'utf8'), 'quarter three\n');
});

test('kosmos#8733: the key step signs with this computer\'s device key, or sends nothing; no sender history waits', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  // No device key here: no key is sent at all.
  {
    const c = coordinator(b, 'hnodk');
    const r = await hr.tick(stateNew(), { org: () => ORG, deviceKey: () => ({ ok: false, because: 'no device key here' }), macRequest: c.recv, root: fresh(t, 'data'), base: fresh(t, 'base'), fetch });
    assert.match(r.because, /no device key here/);
    assert.equal(c.calls.filter(([x]) => x === hr.KEY_ROUTE).length, 0, 'nothing sent');
    assert.equal(c.rec.state, 'requested');
  }
  // Signed by a key that is not this computer's: the coordinator (as kosmos-relay's /key) refuses it, so the fake checks.
  {
    const c = coordinator(b, 'hwrongdk');
    const wrong = crypto.generateKeyPairSync('ed25519');
    await hr.tick(stateNew(), { org: () => ORG, deviceKey: () => ({ ok: true, privateKey: wrong.privateKey }), macRequest: c.recv, root: fresh(t, 'data'), base: fresh(t, 'base'), fetch });
    assert.equal(c.rec.state, 'requested', 'refused');
    // CONTROL: this computer's own key is taken.
    await hr.tick(stateNew(), { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root: fresh(t, 'data'), base: fresh(t, 'base'), fetch });
    assert.equal(c.rec.state, 'packing');
  }
  // May pass later (escrowd not reachable, a packing key not listed yet; a backfill entry is FINAL, in the table above):
  // a tieWait with its own clock (waitSince). No attempt spent however many ticks, no /done and nothing restored, until
  // OUTAGE_LIMIT_MS; then final, said once.
  const waits = [
    ['escrowd could not be asked', () => null],
    ['a packing key escrowd does not list yet', () => signedHistory(ORG, 'm-leave', crypto.generateKeyPairSync('ed25519').publicKey)],
  ];
  for (const [label, hist] of waits) {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const id = 'hw' + crypto.randomBytes(4).toString('hex');
    const c = coordinator(b, id);
    let clock = Date.now();
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, fetch, now: () => clock };
    const st = stateNew();
    await hr.tick(st, deps);
    await pack(c, agentFolder(t));
    c.rec.sender_history = hist(c);
    // Past MAX_ATTEMPTS hourly ticks, well inside the outage window: still waiting.
    for (let i = 0; i < hr.MAX_ATTEMPTS + 3; i++) { await hr.tick(st, deps); clock += hr.RETRY_MS + 1; }
    assert.equal(c.calls.filter(([x]) => x === hr.DONE_ROUTE).length, 0, `${label}: no /done after ${hr.MAX_ATTEMPTS + 3} ticks`);
    assert.equal(worlds.readRegistry(base).worlds.some((x) => /^Handed over/.test(x.name) && !x.hiddenAt), false, `${label}: nothing restored`);
    assert.notEqual(hr.readKey(id, root), null, `${label}: the one-time key is kept`);
    // Its own clock, not the store-outage one, so a pass ends it and a later outage starts its own day.
    assert.ok(Number.isSafeInteger(hr.readKey(id, root).waitSince), `${label}: waitSince kept`);
    assert.equal(Number.isSafeInteger(hr.readKey(id, root).outageSince), false, `${label}: the outage clock untouched`);
    if (label === 'escrowd could not be asked') {
      // Review 3: the check passing ends its wait (waitSince cleared), even when the step after it waits for another
      // reason: here the manifest is not in the store yet, which is the missing clock's.
      delete c.rec.sender_history;
      const mkey = c.rec.manifest.key;
      const held = b.stored.get(mkey);
      b.stored.delete(mkey);
      await hr.tick(st, deps);
      assert.equal(Number.isSafeInteger(hr.readKey(id, root).waitSince), false, 'waitSince cleared by the pass');
      assert.ok(Number.isSafeInteger(hr.readKey(id, root).missingSince), 'the missing clock is the one running now');
      b.stored.set(mkey, held);
      clock += hr.MISSING_RECHECK_MS + 1;
      // CONTROL: the history back, the same hand-over is received.
      delete c.rec.sender_history;
      const ok = await hr.tick(st, deps);
      assert.equal(ok.ok, true, ok.because);
    } else {
      // Bounded: past OUTAGE_LIMIT_MS from the first wait, ended once, in the wait's own words.
      clock += 24 * 60 * 60 * 1000;
      await hr.tick(st, deps);
      const done = c.calls.filter(([x, body]) => x === hr.DONE_ROUTE && body.ok === false);
      assert.equal(done.length, 1, `${label}: ended after the outage window`);
    }
  }
});

test('kosmos#8738: the link rules can only be loosened inside a node test process; a thrown tick backs off', async (t) => {
  const { execFileSync } = require('node:child_process');
  // Outside a test process (no NODE_TEST_CONTEXT), allowHttpForTests changes nothing.
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  const mod = JSON.stringify(path.join(__dirname, 'handoverrecv.js'));
  const out = execFileSync(process.execPath, ['-e', `const hr = require(${mod}); hr.allowHttpForTests(true); process.stdout.write(String(hr.urlProblem('http://127.0.0.1:9/x', 'x')))`], { env, encoding: 'utf8' });
  assert.equal(out, 'not https', 'still refused outside a test');
  // CONTROL: inside this test process it does loosen them (so the child's refusal is the gate, not the URL).
  hr.allowHttpForTests(true);
  assert.equal(hr.urlProblem('http://127.0.0.1:9/x', 'x'), null);
  // A tick that throws waits MISSING_RECHECK_MS before the next.
  let clock = 0, calls = 0;
  const st = stateNew();
  const deps = { org: () => { calls++; throw new Error('boom'); }, deviceKey: SUCC_DK, now: () => clock, macRequest: async () => ({ ok: false }), root: fresh(t, 'data') };
  await hr.tick(st, deps);
  await hr.tick(st, deps);
  assert.equal(calls, 1, 'not again within MISSING_RECHECK_MS');
  clock += hr.MISSING_RECHECK_MS + 1;
  await hr.tick(st, deps);
  assert.equal(calls, 2, 'again after MISSING_RECHECK_MS');
});

test('kosmos#8764: the leaving member is escrowd\'s record\'s, and the packing key is checked at the pack\'s own signed time', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  /* One hand-over packed for real, then received once with `tweak` applied to /mine's receive row. */
  async function run(id, tweak, gapMs = 0, packAtMs) {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const c = coordinator(b, id);
    const deps = { org: () => ORG, deviceKey: SUCC_DK, macRequest: c.recv, root, base, member: 'Ann Lee', fetch };
    const st = stateNew();
    await hr.tick(st, deps);
    c.clock.ms = packAtMs || null;
    await pack(c, agentFolder(t), packAtMs);
    c.clock.ms = null;
    if (gapMs) await new Promise((res) => setTimeout(res, gapMs));   // so "after the pack" is a later second than it
    const recv = async (m, route, body) => {
      const r = await c.recv(m, route, body);
      if (route === hr.MINE_ROUTE && r.ok) Object.assign(r.data.handovers[0], tweak(c));
      return r;
    };
    const r = await hr.tick(st, Object.assign({}, deps, { macRequest: recv }));
    return { r, c, root };
  }
  // CONTROL: unchanged, it is received.
  assert.equal((await run('hctl', () => ({}))).r.ok, true);
  // Kosmos+ renaming the sender changes nothing: the record's `from` is what is checked.
  assert.equal((await run('hren', () => ({ sender_member: 'm-someone' }))).r.ok, true);
  // No record yet: a wait, nothing fetched, nothing ended.
  {
    const { r, c } = await run('hnone', () => ({ record: null }));
    assert.equal(r.ok, false);
    assert.equal(r.final, undefined);
    assert.match(r.because, /not been signed/);
    assert.equal(c.calls.filter(([x]) => x === hr.READ_ROUTE).length, 0, 'nothing fetched');
  }
  // A record naming another leaving member: their history does not list this packing key.
  {
    const { r } = await run('hother', (c) => ({ record: signedRecord('hother', c.rec.agents, { from: 'm-someone' }), sender_history: signedHistory(ORG, 'm-someone', c.sender.publicKey) }));
    assert.equal(r.ok, true, 'escrowd lists this key for m-someone too, so the RECORD decides whose it is');
  }
  // A record dated an hour ahead of this clock waits (escrowd's clock or ours may be off), and opens nothing.
  {
    const { r, c } = await run('hahead', (c) => ({ record: signedRecord('hahead', c.rec.agents, { issuedAt: Math.floor(Date.now() / 1000) + 3600 }) }));
    assert.equal(r.ok, false);
    assert.match(r.because, /dated ahead/);
    assert.notEqual(c.rec.state, 'done');
  }
  const nowS = () => Math.floor(Date.now() / 1000);
  // The pack's signed time must be no earlier than the admin's start: a pack dated an hour before it is final.
  {
    const { r, c } = await run('hbefore', (c) => ({ record: signedRecord('hbefore', c.rec.agents, { issuedAt: nowS() - 60 }) }), 0, Date.now() - 3600 * 1000);
    assert.equal(r.ok, false);
    assert.match(r.because, /made before the hand-over was started/);
    assert.equal(c.rec.state, 'failed');
  }
  // ... and no later than this computer's clock.
  {
    // A wait (round 2: either clock may be off); real time reaches it within a day (the case below bounds it).
    const { r, c } = await run('hfuture', () => ({}), 0, Date.now() + 3600 * 1000);
    assert.equal(r.ok, false);
    assert.match(r.because, /later than this computer's clock/);
    assert.notEqual(c.rec.state, 'failed');
    assert.notEqual(c.rec.state, 'done');
  }
  // Review 3: dated more than a day ahead is final (its wait could otherwise never end), once.
  {
    const { r, c } = await run('hfar', () => ({}), 0, Date.now() + 2 * 86400 * 1000);
    assert.equal(r.ok, false);
    assert.match(r.because, /more than a day later/);
    assert.equal(c.rec.state, 'failed');
  }
  // A key already revoked before the hand-over started is final BEFORE anything is fetched (no pack could predate the
  // start). CONTROL: the key revoked after the pack (hrevlate, below) is fetched and opens.
  {
    const { r, c } = await run('hlongrev', (c) => ({ sender_history: signedHistory(ORG, 'm-leave', c.sender.publicKey, undefined, [{ kind: 'revoke', key: seal.keyHex(c.sender.publicKey), at: 1 }]) }));
    assert.equal(r.ok, false);
    assert.match(r.because, /no longer the leaving member's/);
    assert.equal(c.rec.state, 'failed');
    assert.equal(c.calls.filter(([x]) => x === hr.READ_ROUTE).length, 0, 'nothing fetched');
  }
  // A packing key escrowd lists only from AFTER the pack was made: final (a backdated pack would need exactly this).
  {
    const { r, c } = await run('henrolled', (c) => ({ sender_history: signedHistory(ORG, 'm-leave', c.sender.publicKey, { at: nowS() - 60 }),
      record: signedRecord('henrolled', c.rec.agents, { issuedAt: nowS() - 4 * 3600 }) }), 0, Date.now() - 3600 * 1000);
    assert.equal(r.ok, false);
    assert.match(r.because, /was not the leaving member's when the pack was made/);
    assert.equal(c.rec.state, 'failed');
  }
  // The record's age is measured at the PACK's time: started 40 days ago, packed 29 days after, opens today.
  {
    const start = nowS() - 40 * 86400;
    const { r } = await run('hslow', (c) => ({ record: signedRecord('hslow', c.rec.agents, { issuedAt: start }) }), 0, (start + 29 * 86400) * 1000);
    assert.equal(r.ok, true, r.because);
  }
  // CONTROL for it: packed 31 days after the start, it is refused.
  {
    const start = nowS() - 40 * 86400;
    const { r } = await run('hstale', (c) => ({ record: signedRecord('hstale', c.rec.agents, { issuedAt: start }) }), 0, (start + 31 * 86400) * 1000);
    assert.equal(r.ok, false);
    assert.match(r.because, /more than a month after the hand-over was started/);
  }
  // THE FIX FOR "now": the packing key revoked AFTER the pack (an off-boarded computer) still opens it ...
  {
    const { r } = await run('hrevlate', (c) => ({ sender_history: signedHistory(ORG, 'm-leave', c.sender.publicKey, undefined, [{ kind: 'revoke', key: seal.keyHex(c.sender.publicKey), at: Math.floor(Date.now() / 1000) }]) }), 2100);
    assert.equal(r.ok, true, r.because);
  }
  // ... and one revoked BEFORE the pack does not (CONTROL for the arm above: the same revocation, earlier).
  {
    const { r, c } = await run('hrevearly', (c) => ({ sender_history: signedHistory(ORG, 'm-leave', c.sender.publicKey, undefined, [{ kind: 'revoke', key: seal.keyHex(c.sender.publicKey), at: 1 }]) }));
    assert.equal(r.ok, false);
    assert.match(r.because, /no longer the leaving member's/);
    assert.equal(c.rec.state, 'failed', 'final: the hand-over is ended as failed');
  }
});
