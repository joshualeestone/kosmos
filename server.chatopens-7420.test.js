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
const post = async (body, headers = {}, route = '/api/phone/chat-open') => {
  const res = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const chatopens = require('./engine/chatopens');
const postUIKit = (body) => post(body, {}, '/api/phone/chat-open-uikit');   // #8221 slice 6: the New chat list's path
const APP = '0.1.0 (53)';

test('#7420: no builds at first; showings add up under their build', async () => {
  assert.deepEqual(await get(), { status: 200, body: { builds: {}, ok: true, note: chatopens.NOTE } });
  assert.match(chatopens.NOTE, /do not quote/);
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
  // #8221 slice 6 review 2: the UIKit path is the same handler, with the same refusals.
  assert.equal((await post(good, { 'x-kosmos-agent-token': 'any' }, '/api/phone/chat-open-uikit')).status, 403, 'an agent token posted to the UIKit path');
  assert.equal((await post('{not json', {}, '/api/phone/chat-open-uikit')).status, 400, 'bad JSON on the UIKit path');
  assert.deepEqual((await get()).body.builds[APP], before);
  assert.equal((await post({ app: '__proto__', rebuilds: 0, closedBlank: false })).status, 400);
});

test('#8221 slice 6: the UIKit list counts apart under its build, the lazy counts unchanged', async () => {
  const B = '0.2.0 (70)';
  assert.equal((await post({ app: B, rebuilds: 0, closedBlank: false })).status, 200);
  assert.equal((await post({ app: B, rebuilds: 1, closedBlank: false })).status, 200);
  assert.equal((await postUIKit({ app: B, rebuilds: 0, closedBlank: true })).status, 200);
  assert.equal((await postUIKit({ app: B, rebuilds: 0, closedBlank: false })).status, 200);
  assert.equal((await postUIKit({ app: B, rebuilds: 0, closedBlank: false })).status, 200);
  const { lastAt, uikit, ...lazy } = (await get()).body.builds[B];
  assert.deepEqual(lazy, { opens: 2, blankOpens: 1, rebuilds: 1, closedBlank: 0 });
  assert.deepEqual(uikit, { opens: 3, blankOpens: 1, rebuilds: 0, closedBlank: 1 });
  // A build with only UIKit showings has lazy counts of zero, and one with none has no uikit block.
  assert.equal((await postUIKit({ app: '0.2.0 (71)', rebuilds: 0, closedBlank: false })).status, 200);
  const only = (await get()).body.builds['0.2.0 (71)'];
  assert.equal(only.opens, 0);
  assert.equal(only.uikit.opens, 1);
  assert.equal((await get()).body.builds[APP].uikit, undefined, 'a build with no UIKit showing grew a uikit block');
});

test('#8221 slice 6: only the path names a list; a body cannot, and the engine refuses a list it does not know', async () => {
  // Round 1 of review: an older board ignores a field it does not know, so a list named in the body would have been counted
  // into the lazy numbers there. The path is the name, and a body's list field is ignored here too, as an older board does.
  const B = '0.2.0 (72)';
  assert.equal((await post({ app: B, rebuilds: 0, closedBlank: false, list: 'uikit' })).status, 200);
  const b = (await get()).body.builds[B];
  assert.equal(b.opens, 1, 'a body list field moved the showing off the lazy numbers');
  assert.equal(b.uikit, undefined, 'a body list field reached the uikit block');
  // A malformed showing on the UIKit path is refused as on the lazy one, and counts nothing.
  assert.equal((await postUIKit({ app: B, rebuilds: -1, closedBlank: false })).status, 400);
  assert.equal((await get()).body.builds[B].uikit, undefined);
  // The engine itself takes only the lists it knows.
  for (const list of ['lazy', 'UIKIT', '', null, '__proto__']) {
    assert.deepEqual(chatopens.add({ app: B, rebuilds: 0, closedBlank: false }, new Date(), list), { refused: 'no such list' }, String(list));
  }
  assert.deepEqual((await get()).body.builds[B], b);
});

test('#8221 slice 6: an older file with no uikit block reads, and a malformed one is dropped, not the build', () => {
  const at = new Date(Date.UTC(2029, 0, 1)).toISOString();
  const good = { opens: 2, blankOpens: 1, rebuilds: 1, closedBlank: 0, lastAt: at };
  fs.writeFileSync(chatopens.file(), JSON.stringify({ builds: {
    '1.0 (1)': good,
    '1.0 (2)': { ...good, uikit: { opens: 1, blankOpens: 0, rebuilds: 0, closedBlank: 0 } },
    '1.0 (3)': { ...good, uikit: { opens: -1, blankOpens: 0, rebuilds: 0, closedBlank: 0 } },
    '1.0 (4)': { ...good, uikit: 'many' },
  } }));
  const { builds, ok } = chatopens.read();
  assert.equal(ok, true);
  assert.deepEqual(builds['1.0 (1)'], good);
  assert.deepEqual(builds['1.0 (2)'].uikit, { opens: 1, blankOpens: 0, rebuilds: 0, closedBlank: 0 });
  for (const app of ['1.0 (3)', '1.0 (4)']) {
    assert.deepEqual(builds[app], good, `${app}: the build was lost or kept its malformed uikit block`);
  }
});

test('#7420: only the newest builds are kept, and an unreadable file is never overwritten', async () => {
  for (let i = 0; i < chatopens.MAX_BUILDS + 3; i++) chatopens.add({ app: `9.0 (${i})`, rebuilds: 0, closedBlank: false }, new Date(Date.UTC(2030, 0, 1, 0, i)));
  const { builds } = chatopens.read();
  assert.equal(Object.keys(builds).length, chatopens.MAX_BUILDS);
  assert.ok(!builds['9.0 (0)'] && builds[`9.0 (${chatopens.MAX_BUILDS + 2})`], 'the oldest went, the newest stayed');
  fs.writeFileSync(chatopens.file(), '{broken');
  assert.deepEqual(await get(), { status: 200, body: { builds: {}, ok: false, note: chatopens.NOTE } });
  assert.equal((await post({ app: APP, rebuilds: 0, closedBlank: false })).status, 500);
  assert.equal(fs.readFileSync(chatopens.file(), 'utf8'), '{broken');
});
