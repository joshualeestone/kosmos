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

test('an answer lost after the picture was stored: the next sweep sends it again rather than trusting nothing changed', async () => {
  await on();
  await registered('ava');
  be.st.mode = { appliedThen504: true };
  store.saveAvatar('ava', 'image/png', png(1));
  await cs.sweep();
  be.st.mode = {};
  await cs.sweep();
  assert.equal(puts().length, 2);
  await cs.sweep();
  assert.equal(puts().length, 2);
});

test('an agent with no community account is never sent anything', async () => {
  await on();
  store.saveAvatar('lena', 'image/png', png(1));
  await cs.sweep();
  assert.equal(be.st.seen.length, 0);
});
