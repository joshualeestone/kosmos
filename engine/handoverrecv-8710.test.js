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
  const urlOf = (key, signed) => {
    const expMs = Date.now() + 15 * 60 * 1000, at = Math.floor(expMs / 1000) * 1000 - 15 * 60 * 1000;
    return `${b.base}/bucket/${key.split('/').map(encodeURIComponent).join('/')}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDTEST%2F20261119%2Fus-east-2%2Fs3%2Faws4_request&X-Amz-Date=${amzDate(at)}&X-Amz-Expires=900&X-Amz-SignedHeaders=${encodeURIComponent(signed)}&X-Amz-Signature=00`;
  };
  const sender = crypto.generateKeyPairSync('ed25519');
  const senderB64 = sender.publicKey.export({ format: 'jwk' }).x;   // base64url of the raw 32 bytes, as the coordinator stores it
  const recv = async (method, route, body) => {
    calls.push([route, body]);
    if (route === hr.MINE_ROUTE) {
      const row = { id, side: 'receive', state: rec.state, agents: rec.agents, seal_pub: rec.seal_pub, sender_pubkey: 'sender_pubkey' in rec ? rec.sender_pubkey : senderB64 };
      if (rec.manifest && (rec.state === 'packed' || rec.state === 'receiving')) row.manifest = rec.manifest;
      return { ok: true, data: { handovers: [row] } };
    }
    if (route === hr.KEY_ROUTE) {
      if (rec.state !== 'requested') return { ok: false, because: 'refused (HTTP 409 on /v1/mac/org/handover/key, code handover_wrong_state)' };
      rec.seal_pub = body.pubkey; rec.state = 'packing'; return { ok: true, data: { ok: true, state: 'packing' } };
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
      const expMs = Date.now() + 15 * 60 * 1000;
      return { ok: true, data: { expires_at: iso(expMs), uploads: body.chunks.map((c) => { const key = `${prefix}c${++n}`; return { key, url: urlOf(key, 'content-length;content-md5;host;if-none-match'), headers: { 'content-md5': c.md5, 'if-none-match': '*' } }; }) } };
    }
    if (route === up.HANDOVER_MANIFEST_ROUTE) {
      const key = `${prefix}manifest`;
      rec.state = 'packed'; rec.manifest = { key, sha256: body.sha256, size: body.size };
      return { ok: true, data: { expires_at: iso(Date.now() + 15 * 60 * 1000), upload: { key, url: urlOf(key, 'content-length;host;if-none-match;x-amz-checksum-sha256'), headers: { 'x-amz-checksum-sha256': body.sha256, 'if-none-match': '*' } } } };
    }
    return { ok: false, because: 'refused' };
  };
  return { rec, calls, recv, send, sender, prefix };
}

function agentFolder(t) {
  const base = fresh(t, 'sender');
  const dir = path.join(base, 'ledger');
  fs.mkdirSync(path.join(dir, 'Files'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# You are Ledger\nYou keep the ledger.\n');
  fs.writeFileSync(path.join(dir, 'Files', 'q3.txt'), 'quarter three\n');
  return dir;
}

async function pack(c, dir) {
  const pk = Buffer.from(c.rec.seal_pub, 'base64');
  const nk = crypto.randomBytes(32);
  const r = await snap.takeSnapshot({ roots: [{ name: 'workers/ledger', path: dir }], memberPk: pk, namingKey: nk, namingKeyId: require('./backupkeys').namingKeyId(nk),
    deviceKey: c.sender.privateKey, ctx: snap.handoverContext(ORG, c.rec.id), handover: { id: c.rec.id, prefix: c.prefix } }, { macRequest: c.send, fetch, sleep: async () => {} });
  assert.equal(r.ok, true, r.because);
}

const stateNew = () => hr.newState();

test('end to end: key kept before it is sent, the pack received into a "Handed over" Kosmos, done, key gone', async (t) => {
  hr.allowHttpForTests(true);
  const b = await bucket();
  t.after(() => b.close());
  const root = fresh(t, 'data'), base = fresh(t, 'base');
  const c = coordinator(b, 'ho1');
  const deps = { org: () => ORG, macRequest: c.recv, root, base, member: 'Ann Lee', fetch };
  const st = stateNew();
  // requested: the key is on disk before /key is sent.
  let wroteFirst = null;
  const recvWatch = async (m, route, body) => { if (route === hr.KEY_ROUTE) wroteFirst = !!hr.readKey('ho1', root) && hr.readKey('ho1', root).pk.toString('base64') === body.pubkey; return c.recv(m, route, body); };
  assert.equal((await hr.tick(st, Object.assign({}, deps, { macRequest: recvWatch }))).ok, true);
  assert.equal(wroteFirst, true);
  assert.equal(c.rec.state, 'packing');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, 'handover', 'ho1.key.json')).mode & 0o777, 0o600);
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
  await hr.tick(stateNew(), { org: () => ORG, macRequest: mac, root });
  await hr.tick(stateNew(), { org: () => ORG, macRequest: mac, root });
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1], 'the same key both times');
  // A key that cannot be kept: nothing is sent.
  sent.length = 0;
  const r = await hr.tick(stateNew(), { org: () => ORG, macRequest: mac, root: fresh(t, 'data2'), writeKey: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } });
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
    ['manifest not the recorded one', (c) => { c.rec.manifest.sha256 = sha256b(Buffer.from('other')); }, /not the one Kosmos\+ recorded/],
    ['a chunk that is not what was signed', (c) => { const k = [...b.stored.keys()].find((x) => x.startsWith(c.prefix) && !x.endsWith('manifest')); const v = b.stored.get(k); v.body = Buffer.from(v.body); v.body[v.body.length - 1] ^= 1; }, /not what its sender signed/],
  ];
  for (const [label, spoil, why] of cases) {
    const root = fresh(t, 'data'), base = fresh(t, 'base');
    const id = 'h' + crypto.randomBytes(4).toString('hex');
    const c = coordinator(b, id);
    const deps = { org: () => ORG, macRequest: c.recv, root, base, fetch };
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
  const deps = { org: () => ORG, macRequest: c.recv, root, base, fetch };
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
  const deps = { org: () => ORG, macRequest: c.recv, root, base, fetch, now: () => clock };
  await hr.tick(st, deps);
  await pack(c, agentFolder(t));
  const saved = b.stored.get(c.rec.manifest.key);
  b.stored.delete(c.rec.manifest.key);
  assert.equal((await hr.tick(st, deps)).ok, false);
  clock += hr.MISSING_GRACE_MS - 1000;
  await hr.tick(st, deps);
  assert.equal(c.calls.filter(([x]) => x === hr.DONE_ROUTE).length, 0, 'still within the grace');
  // The sender's upload lands within the grace: received.
  b.stored.set(c.rec.manifest.key, saved);
  // ... but the first /done answer is lost.
  let lose = true;
  const lossy = async (m, route, body) => { const r = await c.recv(m, route, body); if (route === hr.DONE_ROUTE && lose) { lose = false; return { ok: false, because: 'no answer' }; } return r; };
  const d2 = Object.assign({}, deps, { macRequest: lossy });
  assert.equal((await hr.tick(st, d2)).ok, true);
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
  const r = await hr.tick(st2, d3);
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
  const deps = { org: () => ORG, macRequest: c.recv, root, base, fetch, now: () => clock };
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
  const r = await hr.tick(stateNew(), { org: () => ORG, root, macRequest: async (m, route) => { routes.push(route); return { ok: false, notSent: true, because: 'mac-request does not sign that' }; } });
  assert.equal(r.ok, false);
  assert.deepEqual(routes, [hr.MINE_ROUTE]);
  assert.equal(fs.existsSync(path.join(root, 'handover')), false, 'no key was made');
  assert.equal(hr.startHere({}), null);
  // Not in a company that may send: nothing is asked.
  routes.length = 0;
  assert.deepEqual(await hr.tick(stateNew(), { org: () => null, root, macRequest: async (m, route) => { routes.push(route); return { ok: true, data: {} }; } }), { ok: true, none: true });
  assert.deepEqual(routes, []);
});
