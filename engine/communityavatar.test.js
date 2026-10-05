'use strict';
/**
 * kosmos#4885: an agent's Kosmos picture on its community profile. The send layer's sweepAvatars
 * (PUT /agents/me/avatar with the raw image, DELETE /agents/me/avatar) for each registered agent, against a fake
 * kosmos-community on a loopback port with the v0.4.0 contract (app/routers/home.py, app/avatars.py). Sandboxed data
 * root before the require.
 *
 *   node --test engine/communityavatar.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communityavatar-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const store = require('./store');
const cs = require('./communitysend');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (fill, size = 64) => Buffer.concat([PNG_SIG, Buffer.alloc(size - 8, fill)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(40, 1)]);

function backend() {
  const st = { agents: new Map(), seen: [], mode: {}, n: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const type = req.headers['content-type'] || null;
      const body = type === 'application/json' && raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
      st.seen.push({ method: req.method, url: req.url, type, raw, auth: req.headers.authorization || null });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'k' + id, token: 't' + id, avatar: null, version: 0 };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      if (req.method === 'POST' && req.url === '/agents/login') {
        const x = [...st.agents.values()].find((y) => y.name === body.name && y.key === body.api_key);
        if (!x || st.mode.loginRefused) return send(401, { detail: 'wrong name or key' });
        x.token = 't' + x.id + '_' + (++st.n);
        return send(200, { token: x.token });
      }
      const a = [...st.agents.values()].find((x) => 'Bearer ' + x.token === req.headers.authorization);
      if (req.method === 'POST' && req.url === '/posts') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        return send(201, { id: 'p' + (++st.n), ...body });
      }
      if (req.url === '/agents/me/avatar') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        if (st.mode.status) return send(st.mode.status, st.mode.json || { detail: 'no' });
        if (req.method === 'DELETE') { a.avatar = null; res.writeHead(204); return res.end(); }
        if (req.method === 'PUT') {
          if (st.mode.refuse || raw.length > 60000) return send(422, { detail: { error: 'bad_avatar', reason: 'no' } });
          a.avatar = { type, raw }; a.version += 1;
          if (st.mode.appliedThen504) return send(504, { detail: 'gateway timeout' });   // stored, answer lost
          return send(200, { avatar: a.version });
        }
      }
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = `http://127.0.0.1:${server.address().port}/`;
    resolve({ st, server });
  }));
}

let be;
let SW = { on: false, ok: true };
async function on() { SW = { on: true, ok: true }; await cs.sweep(); }
test.beforeEach(async () => {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  SW = { on: false, ok: true };
  cs.setSwitch(() => SW);
  fs.rmSync(data, { recursive: true, force: true });
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
  be = await backend();
});
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });

// An agent is registered with the service when its first post goes (the send layer's rule).
async function registered(agent) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic: 't', body: 'hello from ' + agent }, { agentId: agent });
  assert.equal(r.status, 'published');
  await cs.sweep();
  assert.ok([...be.st.agents.values()].length > 0, 'the agent was not registered');
}
const avatarCalls = () => be.st.seen.filter((s) => s.url === '/agents/me/avatar');
const puts = () => avatarCalls().filter((s) => s.method === 'PUT');
const deletes = () => avatarCalls().filter((s) => s.method === 'DELETE');
const held = () => [...be.st.agents.values()][0].avatar;

test('sandbox: the keys file and the pictures are inside this test\'s data root', () => {
  assert.ok(cs._paths.keysFile().startsWith(SANDBOX + path.sep), cs._paths.keysFile());
  store.saveAvatar('ava', 'image/png', png(1));
  assert.ok(store.avatarPath('ava').startsWith(SANDBOX + path.sep), store.avatarPath('ava'));
});

test('no picture: nothing is sent', async () => {
  await on();
  await registered('ava');
  await cs.sweep();
  assert.equal(avatarCalls().length, 0);
});

test('a picture is sent once, as its own bytes and type with the agent\'s bearer; a change is sent; a removal is a DELETE once', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  assert.equal(puts().length, 1);
  assert.equal(puts()[0].type, 'image/png');
  assert.ok(puts()[0].raw.equals(png(1)), 'the bytes that arrived are not the picture');
  assert.match(puts()[0].auth, /^Bearer t/);
  await cs.sweep();
  assert.equal(avatarCalls().length, 1, 'sent again with nothing changed');
  store.saveAvatar('ava', 'image/jpeg', JPEG);
  await cs.sweep();
  assert.equal(puts().length, 2);
  assert.equal(puts()[1].type, 'image/jpeg');
  store.removeAvatar('ava');
  await cs.sweep();
  await cs.sweep();
  assert.equal(deletes().length, 1);
  assert.equal(held(), null);
});

test('the type sent is what the bytes are, not the file name', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', JPEG);   // a .png that is a JPEG
  await cs.sweep();
  assert.equal(puts()[0].type, 'image/jpeg');
});

test('switched off: a new picture waits; a removal still goes (taking it back must not wait)', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  assert.equal(puts().length, 1);
  SW = { on: false, ok: true };
  store.saveAvatar('ava', 'image/png', png(2));
  await cs.sweep();
  assert.equal(puts().length, 1, 'a new picture went out while switched off');
  store.removeAvatar('ava');
  await cs.sweep();
  assert.equal(deletes().length, 1, 'the removal waited for the switch');
  SW = { on: true, ok: true };
  store.saveAvatar('ava', 'image/png', png(3));
  await cs.sweep();
  assert.equal(puts().length, 2);
  assert.ok(puts()[1].raw.equals(png(3)));
});

test('a picture the community cannot take is never sent, and one sent before is taken back', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/gif', GIF);
  await cs.sweep();
  assert.equal(avatarCalls().length, 0, 'a GIF was sent');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  assert.equal(puts().length, 1);
  store.saveAvatar('ava', 'image/png', png(2, 60001));
  await cs.sweep();
  await cs.sweep();
  assert.equal(puts().length, 1, 'a picture over 60,000 bytes was sent');
  assert.equal(deletes().length, 1, 'the earlier picture was left showing after it was replaced');
  store.saveAvatar('ava', 'image/png', png(2, 60000));
  await cs.sweep();
  assert.equal(puts().length, 2, 'a picture of exactly 60,000 bytes is within the cap');
});

test('a picture the service refuses (422 bad_avatar) is not sent again until it changes', async () => {
  await on();
  await registered('ava');
  be.st.mode = { refuse: true };
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  await cs.sweep();
  assert.equal(puts().length, 1, 'a refused picture was sent again');
  be.st.mode = {};
  store.saveAvatar('ava', 'image/png', png(2));
  await cs.sweep();
  assert.equal(puts().length, 2);
  assert.ok(held().raw.equals(png(2)));
});

test('no usable answer (503, or a route that is not there): tried again next sweep until it lands', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  for (const status of [503, 404]) {
    be.st.mode = { status };
    await cs.sweep();
  }
  be.st.mode = {};
  await cs.sweep();
  assert.equal(puts().length, 3);
  assert.ok(held().raw.equals(png(1)));
  await cs.sweep();
  assert.equal(puts().length, 3, 'sent again after it landed');
});

test('an answer lost after a picture was stored: going back to the one sent before is sent again, not skipped', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();                                     // A, answered
  be.st.mode = { appliedThen504: true };
  store.saveAvatar('ava', 'image/png', png(2));
  await cs.sweep();                                     // B stored by the service, its answer lost
  be.st.mode = {};
  store.saveAvatar('ava', 'image/png', png(1));         // the person goes back to A
  await cs.sweep();
  assert.equal(puts().length, 3, 'A was skipped as already sent while the community may be showing B');
  assert.ok(held().raw.equals(png(1)));
  await cs.sweep();
  assert.equal(puts().length, 3);
});

test('a refused replacement takes the earlier picture down, once, and retries the take-down until it lands', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  be.st.mode = { refuse: true };
  store.saveAvatar('ava', 'image/png', png(2));
  await cs.sweep();                                     // B refused
  be.st.mode = { status: 503 };
  await cs.sweep();                                     // the take-down gets no answer
  be.st.mode = {};
  await cs.sweep();
  await cs.sweep();
  assert.equal(puts().length, 2, 'the refused picture was sent again');
  assert.equal(held(), null, 'the replaced picture is still showing');
  assert.equal(deletes().length, 2, 'one take-down unanswered, one landed, then nothing');
});

test('a GIF replacing a picture already sent takes the old one down', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  store.saveAvatar('ava', 'image/gif', GIF);
  await cs.sweep();
  assert.equal(deletes().length, 1);
  assert.equal(held(), null);
});

test('an expired token: the picture goes again after logging in, with the same bytes and type', async () => {
  await on();
  await registered('ava');
  [...be.st.agents.values()][0].token = 'stale';        // the board's token no longer works
  store.saveAvatar('ava', 'image/jpeg', JPEG);
  await cs.sweep();
  assert.equal(puts().length, 2, 'not one 401 then one re-send');
  assert.equal(puts()[1].type, 'image/jpeg');
  assert.ok(puts()[1].raw.equals(JPEG));
  assert.ok(held() && held().raw.equals(JPEG));
});

test('a 422 that is not the service refusing the picture is retried, not recorded as refused', async () => {
  await on();
  await registered('ava');
  be.st.mode = { status: 422, json: { detail: [{ msg: 'something in between' }] } };
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  be.st.mode = {};
  await cs.sweep();
  assert.equal(puts().length, 2);
  assert.ok(held().raw.equals(png(1)));
});

test('logs: a picture not sent, and a retry, are each said once per value; a shut-out agent\'s removal is said once', async (t) => {
  const lines = [];
  const real = console.error;
  console.error = (m) => { lines.push(String(m)); };
  t.after(() => { console.error = real; });
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/gif', GIF);
  await cs.sweep(); await cs.sweep();
  assert.equal(lines.filter((l) => /picture for ava: not sent \(not a PNG, JPEG or WebP\)/.test(l)).length, 1);
  store.saveAvatar('ava', 'image/png', png(1));
  be.st.mode = { status: 503 };
  await cs.sweep(); await cs.sweep();
  assert.equal(lines.filter((l) => /picture for ava: no usable answer/.test(l)).length, 1);
  be.st.mode = {};
  await cs.sweep();
  assert.ok(held());
  // The service shuts the agent out; the person then removes the picture.
  const a = [...be.st.agents.values()][0];
  a.token = 'stale';
  be.st.mode = { loginRefused: true };
  store.removeAvatar('ava');
  await cs.sweep(); await cs.sweep(); await cs.sweep();
  assert.equal(lines.filter((l) => /picture for ava: the service refused this agent's key/.test(l)).length, 1);
  assert.ok(held(), 'control: the picture really is still up, so the log line is the only record');
  assert.equal(cs.pictureUnreachable(), 1, 'the page cannot say a picture is stuck up');
  // A replacement it cannot send is on record too, once; and removing it again is said again.
  store.saveAvatar('ava', 'image/png', png(4));
  await cs.sweep(); await cs.sweep();
  assert.equal(lines.filter((l) => /picture for ava: the service refused this agent's key/.test(l)).length, 2);
  store.removeAvatar('ava');
  await cs.sweep(); await cs.sweep();
  assert.equal(lines.filter((l) => /picture for ava: the service refused this agent's key/.test(l)).length, 3);
});

test('pictureUnreachable: 0 while every picture can be taken down', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  assert.equal(cs.pictureUnreachable(), 0);
});

test('an agent with no community account is never sent anything', async () => {
  await on();
  store.saveAvatar('lena', 'image/png', png(1));
  await cs.sweep();
  assert.equal(be.st.seen.length, 0);
});

test('an empty picture file takes nothing down, and is not called "not a picture"', async (t) => {
  const lines = [];
  const real = console.error;
  console.error = (m) => { lines.push(String(m)); };
  t.after(() => { console.error = real; });
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  fs.writeFileSync(store.avatarPath('ava'), Buffer.alloc(0));
  await cs.sweep();
  assert.equal(deletes().length, 0, 'a half-written picture took the good one down');
  assert.equal(lines.filter((l) => /picture for ava: not sent/.test(l)).length, 0);
  store.saveAvatar('ava', 'image/png', png(2));
  await cs.sweep();
  assert.equal(puts().length, 2);
  assert.ok(held().raw.equals(png(2)));
});

test('a pictures folder that cannot be read takes nothing down, and is said once', async (t) => {
  const lines = [];
  const real = console.error;
  console.error = (m) => { lines.push(String(m)); };
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  const dir = path.dirname(store.avatarPath('ava'));
  fs.chmodSync(dir, 0o000);
  t.after(() => { try { fs.chmodSync(dir, 0o755); } catch { /* best effort */ } console.error = real; });
  await cs.sweep();
  await cs.sweep();
  assert.equal(deletes().length, 0, 'a folder that could not be read took the picture down');
  assert.equal(lines.filter((l) => /picture for ava: could not be read/.test(l)).length, 1);
  fs.chmodSync(dir, 0o755);
  await cs.sweep();
  assert.equal(deletes().length, 0);
  assert.ok(held().raw.equals(png(1)));
});

test('in one sweep a removal goes out before a new picture (removals are a take-down; new pictures go last)', async () => {
  await on();
  await registered('ava');
  await registered('bo');
  store.saveAvatar('bo', 'image/png', png(1));
  await cs.sweep();
  // ava comes first in the keys, so a single pass in key order would send ava's PUT before bo's DELETE.
  store.saveAvatar('ava', 'image/png', png(2));
  store.removeAvatar('bo');
  const before = avatarCalls().length;
  await cs.sweep();
  const order = avatarCalls().slice(before).map((c) => c.method);
  assert.deepEqual(order, ['DELETE', 'PUT']);
});

test('a new picture that keeps failing waits after three tries; a different picture tries again at once', async () => {
  await on();
  await registered('ava');
  be.st.mode = { status: 503 };
  store.saveAvatar('ava', 'image/png', png(1));
  for (let i = 0; i < 5; i++) await cs.sweep();
  assert.equal(puts().length, 3, 'a failing upload was sent every sweep');
  be.st.mode = {};
  store.saveAvatar('ava', 'image/png', png(2));
  await cs.sweep();
  assert.equal(puts().length, 4);
  assert.ok(held().raw.equals(png(2)));
});

test('a key revoked on the first upload: nothing counted as stuck, and no "trying again" line', async (t) => {
  const lines = [];
  const real = console.error;
  console.error = (m) => { lines.push(String(m)); };
  t.after(() => { console.error = real; });
  await on();
  await registered('ava');
  [...be.st.agents.values()][0].token = 'stale';
  be.st.mode = { loginRefused: true };
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  assert.equal(held(), null, 'control: nothing reached the community');
  assert.equal(cs.pictureUnreachable(), 0, 'a picture the community never had is counted as stuck');
  assert.equal(lines.filter((l) => /picture for ava: no usable answer/.test(l)).length, 0);
});

test('a same-size replacement given the old timestamp is still read as new', async () => {
  await on();
  await registered('ava');
  const T = 1700000000;   // whole seconds, so both files carry exactly the same mtime
  store.saveAvatar('ava', 'image/png', png(1));
  fs.utimesSync(store.avatarPath('ava'), T, T);
  await cs.sweep();
  const was = fs.statSync(store.avatarPath('ava'));
  store.saveAvatar('ava', 'image/png', png(9));
  fs.utimesSync(store.avatarPath('ava'), T, T);
  const now = fs.statSync(store.avatarPath('ava'));
  assert.equal(now.size, was.size, 'control: the two pictures are the same size');
  assert.equal(now.mtimeMs, was.mtimeMs, 'control: the two pictures carry the same mtime');
  await cs.sweep();
  assert.equal(puts().length, 2, 'the cached old picture was used');
  assert.ok(held().raw.equals(png(9)));
});

test('saving a picture never leaves a moment with no picture, and a stray file is not the picture', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  const dir = path.dirname(store.avatarPath('ava'));
  // A replacement of another type: the new file is in place before the old one goes.
  // Look for a picture at the moment the new bytes are written: an unlink-then-write save has none then.
  const realWrite = fs.writeFileSync;
  let seenAtWrite;
  fs.writeFileSync = (f, ...rest) => {
    if (String(f).startsWith(dir + path.sep) && seenAtWrite === undefined) seenAtWrite = store.avatarLookup('ava').file;
    return realWrite(f, ...rest);
  };
  try { store.saveAvatar('ava', 'image/jpeg', JPEG); } finally { fs.writeFileSync = realWrite; }
  assert.ok(seenAtWrite, 'there was a moment with no picture');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'a temporary file was left behind');
  await cs.sweep();
  assert.equal(deletes().length, 0);
  // A stray sibling is never the picture.
  fs.writeFileSync(path.join(dir, 'ava.jpg.bak'), 'old');
  fs.writeFileSync(path.join(dir, 'ava.txt'), 'notes');
  assert.equal(path.basename(store.avatarLookup('ava').file), 'ava.jpg');
  store.removeAvatar('ava');
  assert.equal(store.avatarLookup('ava').file, null, 'a stray file was read as the picture');
  // A picture saved elsewhere with another spelling of an image extension is still the picture.
  for (const name of ['ava.JPG', 'ava.jpeg']) {
    fs.writeFileSync(path.join(dir, name), JPEG);
    assert.equal(path.basename(store.avatarLookup('ava').file), name);
    assert.equal(path.basename(store.avatarPath('ava')), name, 'the page and the sender disagree');
    fs.unlinkSync(path.join(dir, name));
  }
});

test('a picture that vanishes between the lookup and the read is looked at again, not taken down', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  store.saveAvatar('ava', 'image/png', png(2));        // a change, so the cache does not answer
  const file = store.avatarPath('ava');
  const realStat = fs.statSync;
  let failed = 0;
  fs.statSync = (f, ...rest) => {
    if (String(f) === file && failed < 2) { failed += 1; const e = new Error('gone'); e.code = 'ENOENT'; throw e; }
    return realStat(f, ...rest);
  };
  try { await cs.sweep(); } finally { fs.statSync = realStat; }
  assert.ok(failed > 0, 'control: the stat really failed');
  assert.equal(deletes().length, 0, 'a vanished-then-back picture was taken down');
  await cs.sweep();
  assert.ok(held().raw.equals(png(2)));
});

test('saving over a picture whose name differs only in case keeps the new picture (macOS and Windows ignore case)', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  const dir = path.dirname(store.avatarPath('ava'));
  fs.renameSync(store.avatarPath('ava'), path.join(dir, 'ava.JPG'));   // a JPEG saved elsewhere with a capital extension
  fs.writeFileSync(path.join(dir, 'ava.JPG'), JPEG);
  const ignoresCase = fs.existsSync(path.join(dir, 'ava.jpg'));
  store.saveAvatar('ava', 'image/jpeg', Buffer.concat([JPEG, Buffer.from([1])]));
  const left = fs.readdirSync(dir).filter((f) => f.toLowerCase().startsWith('ava.'));
  assert.equal(left.length, 1, 'expected one picture, found ' + JSON.stringify(left) + (ignoresCase ? ' (this disk ignores case)' : ''));
  assert.ok(fs.readFileSync(path.join(dir, left[0])).equals(Buffer.concat([JPEG, Buffer.from([1])])), 'the new picture is not what is on disk');
  assert.ok(store.avatarPath('ava'), 'the save left no picture at all');
});

const readKeys = () => JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
const writeKeys = (k) => fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(k));
const keyOf = (keys) => Object.keys(keys).find((a) => keys[a] && keys[a].apiKey);

test('backoff: once the wait is over the picture is tried again; the wait never exceeds six hours', async () => {
  await on();
  await registered('ava');
  be.st.mode = { status: 503 };
  store.saveAvatar('ava', 'image/png', png(1));
  for (let i = 0; i < 4; i++) await cs.sweep();
  assert.equal(puts().length, 3);
  let keys = readKeys();
  const a = keyOf(keys);
  assert.ok(keys[a].avatarNextTry > Date.now(), 'no wait was set');
  keys[a].avatarNextTry = Date.now() - 1;           // the wait is over
  keys[a].avatarFails = 30;                         // and it has failed many times
  writeKeys(keys);
  await cs.sweep();
  assert.equal(puts().length, 4, 'not tried again after the wait');
  keys = readKeys();
  const wait = keys[a].avatarNextTry - Date.now();
  assert.ok(wait > 5.9 * 3600e3 && wait <= 6 * 3600e3 + 1000, 'the wait is not capped at six hours: ' + wait);
  be.st.mode = {};
  keys[a].avatarNextTry = Date.now() - 1; writeKeys(keys);
  await cs.sweep();
  assert.ok(held().raw.equals(png(1)));
  assert.equal(readKeys()[a].avatarFails, undefined, 'a landed picture left its failure count');
});

test('a 404 for the picture route says it was not taken: the write-ahead mark is put back', async () => {
  await on();
  await registered('ava');
  be.st.mode = { status: 404 };
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  const keys = readKeys();
  assert.equal(keys[keyOf(keys)].avatarUnsure, undefined, 'a 404 left the picture counted as maybe sent');
  be.st.mode = { status: 503 };
  store.saveAvatar('ava', 'image/png', png(2));
  await cs.sweep();
  const k2 = readKeys();
  assert.equal(k2[keyOf(k2)].avatarUnsure, true, 'control: a 503 may have landed, so the mark stays');
});

test('a picture that changes while it is read is left for the next sweep, neither sent nor taken down', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  store.saveAvatar('ava', 'image/png', png(2));
  const file = store.avatarPath('ava');
  const realStat = fs.statSync;
  let calls = 0;
  fs.statSync = (f, ...rest) => {
    const st = realStat(f, ...rest);
    if (String(f) !== file) return st;
    calls += 1;
    return calls % 2 === 0 ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ctimeMs: st.ctimeMs + 1 }) : st;
  };
  try { await cs.sweep(); } finally { fs.statSync = realStat; }
  assert.ok(calls >= 2, 'control: the file was stat\'d twice');
  assert.equal(puts().length, 1, 'a picture that changed while it was read was sent');
  assert.equal(deletes().length, 0);
  await cs.sweep();
  assert.ok(held().raw.equals(png(2)));
});

test('pictureUnsendable counts pictures that cannot go as they are, and stops counting once one can', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/gif', GIF);
  await cs.sweep();
  assert.equal(cs.pictureUnsendable(), 1);
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  assert.equal(cs.pictureUnsendable(), 0);
  be.st.mode = { refuse: true };
  store.saveAvatar('ava', 'image/png', png(2));
  await cs.sweep();
  assert.equal(cs.pictureUnsendable(), 1, 'a picture the community refused is not counted');
});

test('#5302 pictureToFit names the agents whose picture is too big or the wrong type, judged on the file as it is now', async () => {
  await on();
  await registered('ava');
  store.saveAvatar('ava', 'image/gif', GIF);
  await cs.sweep();
  const key = keyOf(readKeys());
  assert.deepEqual(cs.pictureToFit(), [key]);
  assert.equal(cs.pictureUnsendable(), 1);
  // The page fits it and saves a PNG; before any sweep re-marks it, it no longer counts.
  store.saveAvatar('ava', 'image/png', png(3));
  assert.deepEqual(cs.pictureToFit(), [], 'a picture already fitted still listed until the next sweep');
  assert.equal(cs.pictureUnsendable(), 0);
  // CONTROL: the mark is still there (only the live read cleared it).
  assert.match(readKeys()[key].avatarSkipLogged, /^type:/);
});
