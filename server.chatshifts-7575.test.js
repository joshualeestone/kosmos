'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #7575: the phone chat-shift routes against the real server. Sandboxed as server.undo-5153.test.js is.
 *   node --test server.chatshifts-7575.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-chatshift-route-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude-projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const get = async (headers = {}) => { const r = await fetch(base + '/api/phone/chat-shifts', { headers }); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (body, headers = {}) => {
  const res = await fetch(base + '/api/phone/chat-shift', { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const good = { app: '1.4 (18)', ios: '27.0', model: 'iPhone17,1', shifts: 3, largest: 16, whileDragging: false,
  listWidth: 402, contentWidth: 434, keyboardUp: true, openSeconds: 41.27, rows: { message: 5, reactions: 1, working: 1 } };

test('#7575: none at first; a record is kept with the board\'s time and read back as sent', async () => {
  assert.deepEqual(await get(), { status: 200, body: { records: [], ok: true } });
  assert.deepEqual(await post(good), { status: 200, body: { ok: true } });
  const { body } = await get();
  assert.equal(body.ok, true);
  assert.equal(body.records.length, 1);
  const { at, ...rest } = body.records[0];
  assert.ok(!Number.isNaN(Date.parse(at)), `at is not a time: ${at}`);
  assert.deepEqual(rest, { ...good, openSeconds: 41.3 });
});

test('#7575: text the app did not mean to send is dropped, field by field', async () => {
  const before = (await get()).body.records.length;
  const r = await post({ ...good, text: 'a message', agent: 'renet', address: 'https://x', model: 'my phone',
    rows: { message: 2, secret: 9, reactions: 'many' }, largest: -4, keyboardUp: 'yes' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const kept = (await get()).body.records.at(-1);
  assert.equal(before + 1, (await get()).body.records.length);
  for (const k of ['text', 'agent', 'address', 'model', 'largest', 'keyboardUp']) assert.ok(!(k in kept), `${k} was kept: ${JSON.stringify(kept)}`);
  assert.deepEqual(kept.rows, { message: 2 });
  assert.equal(JSON.stringify(kept).includes('a message'), false);
});

test('#7575: an agent cannot post; a request that is not a record is a 400 and keeps nothing', async () => {
  const before = (await get()).body;
  assert.equal((await post(good, { 'x-kosmos-agent-token': 'any' })).status, 403, 'an agent token posted');
  assert.equal((await post({ ...good, token: 'any' })).status, 403, 'an agent token in the body posted');
  for (const bad of [{ ...good, shifts: 0 }, { ...good, app: 'x'.repeat(40) }, { ...good, ios: 'ios\n27' }, { ...good, shifts: 'two' }, {}, [], 'not json', 'null']) {
    const r = await post(bad);
    assert.equal(r.status, 400, `accepted ${JSON.stringify(bad)}: ${JSON.stringify(r.body)}`);
  }
  assert.deepEqual((await get()).body, before, 'a refused request changed the records');
});

test('#7575: only the last MAX are kept, oldest dropped', async () => {
  const { MAX } = require('./engine/chatshifts');
  for (let i = 0; i < MAX + 3; i++) assert.equal((await post({ ...good, shifts: i + 1 })).status, 200);
  const { records } = (await get()).body;
  assert.equal(records.length, MAX);
  assert.equal(records[0].shifts, 4);
  assert.equal(records.at(-1).shifts, MAX + 3);
});

test('#7575: a file that cannot be read answers ok false, a post is a 500, and the file is kept', async () => {
  const file = require('./engine/chatshifts').file();
  const kept = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{broken');
  try {
    assert.deepEqual(await get(), { status: 200, body: { records: [], ok: false } });
    assert.equal((await post(good)).status, 500);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken', 'the unreadable file was overwritten');
  } finally { fs.writeFileSync(file, kept); }
});
