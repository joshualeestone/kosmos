'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #7420: the phone chat-open count against the real server. Sandboxed as server.undo-5153.test.js is.
 *   node --test server.chatopens-7420.test.js */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-chatopen-route-'));
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
const get = async () => { const r = await fetch(base + '/api/phone/chat-opens'); return { status: r.status, body: await r.json() }; };
const post = async (body, headers = {}) => {
  const res = await fetch(base + '/api/phone/chat-open', { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const chatopens = require('./engine/chatopens');
const APP = '0.1.0 (53)';

test('#7420: no builds at first; showings add up under their build', async () => {
  assert.deepEqual(await get(), { status: 200, body: { builds: {}, ok: true } });
  assert.equal((await post({ app: APP, rebuilds: 0, closedBlank: false })).status, 200);
  assert.equal((await post({ app: APP, rebuilds: 2, closedBlank: false })).status, 200);
  assert.equal((await post({ app: APP, rebuilds: 1, closedBlank: true })).status, 200);
  assert.equal((await post({ app: APP, rebuilds: 0, closedBlank: true })).status, 200);
  assert.equal((await post({ app: '0.1.0 (54)', rebuilds: 0, closedBlank: false })).status, 200);
  const { body } = await get();
  const { lastAt, ...counts } = body.builds[APP];
  assert.ok(!Number.isNaN(Date.parse(lastAt)), `lastAt is not a time: ${lastAt}`);
  assert.deepEqual(counts, { opens: 4, blankOpens: 3, rebuilds: 3, closedBlank: 2 });
  assert.equal(body.builds['0.1.0 (54)'].opens, 1);
  assert.equal(body.builds['0.1.0 (54)'].blankOpens, 0);
});

test('#7420: anything not a showing is refused and counts nothing', async () => {
  const before = (await get()).body.builds[APP];
  for (const bad of [
    { app: 'Josh iPhone (1)', rebuilds: 0, closedBlank: false },
    { app: '0.1.0', rebuilds: 0, closedBlank: false },
    { app: APP, rebuilds: -1, closedBlank: false },
    { app: APP, rebuilds: 1.5, closedBlank: false },
    { app: APP, rebuilds: 0, closedBlank: 'yes' },
    { app: APP, closedBlank: false },
    [],
  ]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await post('{not json')).status, 400);
  assert.deepEqual((await get()).body.builds[APP], before);
});

test('#7420: only the fields it counts are kept, and a huge rebuild count is capped', async () => {
  assert.equal((await post({ app: '0.1.0 (60)', rebuilds: 1e9, closedBlank: false, note: 'private words', name: 'Dana' })).status, 200);
  const raw = fs.readFileSync(chatopens.file(), 'utf8');
  assert.ok(!raw.includes('private words') && !raw.includes('Dana'), 'text reached the file');
  assert.equal((await get()).body.builds['0.1.0 (60)'].rebuilds, chatopens.MAX_REBUILDS);
});

test('#7420: an agent\'s token is refused, and a build named like a built-in property is refused', async () => {
  const before = (await get()).body.builds[APP];
  const good = { app: APP, rebuilds: 0, closedBlank: false };
  assert.equal((await post(good, { 'x-kosmos-agent-token': 'any' })).status, 403, 'an agent token posted');
  assert.equal((await post({ ...good, token: 'any' })).status, 403, 'an agent token in the body posted');
  assert.deepEqual((await get()).body.builds[APP], before);
  assert.equal((await post({ app: '__proto__', rebuilds: 0, closedBlank: false })).status, 400);
});

test('#7420: only the newest builds are kept, and an unreadable file is never overwritten', async () => {
  for (let i = 0; i < chatopens.MAX_BUILDS + 3; i++) chatopens.add({ app: `9.0 (${i})`, rebuilds: 0, closedBlank: false }, new Date(Date.UTC(2030, 0, 1, 0, i)));
  const { builds } = chatopens.read();
  assert.equal(Object.keys(builds).length, chatopens.MAX_BUILDS);
  assert.ok(!builds['9.0 (0)'] && builds[`9.0 (${chatopens.MAX_BUILDS + 2})`], 'the oldest went, the newest stayed');
  fs.writeFileSync(chatopens.file(), '{broken');
  assert.deepEqual(await get(), { status: 200, body: { builds: {}, ok: false } });
  assert.equal((await post({ app: APP, rebuilds: 0, closedBlank: false })).status, 500);
  assert.equal(fs.readFileSync(chatopens.file(), 'utf8'), '{broken');
});
