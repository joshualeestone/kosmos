'use strict';
/**
 * #8631 (the board's half of #8625): the room read says how many of its messages a block hides (hiddenBlocked), so the
 * board can say so in one line. On the whole room and on a page; never sent as 0; gone again after Unblock.
 * Real rows through the real routes.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roomblock-8631-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const store = require('./engine/store');

let base;
let pid;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const made = projects.create({ name: 'Shared Room' });
  projects.writeAll(projects.readAll().map((q) => (q.id === made.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  pid = made.id;
  const at = (i) => new Date(Date.parse('2024-01-01T00:00:00.000Z') + i * 1000).toISOString();
  const ext = (id, member, from, i) => ({ kind: 'external', id, project: pid, from, fromKind: 'person', external: true,
    text: 'words from ' + from, at: at(i), member });
  const lines = [ext('x-a1', 'acctA', 'Ana', 1), ext('x-a2', 'acctA:mac1', 'Ana', 2), ext('x-b1', 'acctB', 'Bea', 3)];
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.appendFileSync(path.join(store.ROOT, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body || {}) });
const read = async (q) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room${q || ''}`);
  assert.equal(res.status, 200);
  return res.json();
};

test('#8631: with nobody blocked, the room read carries no hiddenBlocked (the precondition)', async () => {
  for (const q of ['', '?n=50&archive=0']) {
    const room = await read(q);
    assert.equal(Object.prototype.hasOwnProperty.call(room, 'hiddenBlocked'), false, 'never sent as 0: ' + (q || 'whole room'));
    assert.equal(room.rows.filter((r) => r.kind === 'external').length, 3);
  }
});

test('#8631: after a block, both arms say how many messages it hides here', async () => {
  assert.equal((await post(`/api/project/${encodeURIComponent(pid)}/room/x-a1/block`)).status, 200);
  for (const q of ['', '?n=50&archive=0']) {
    const room = await read(q);
    assert.equal(room.hiddenBlocked, 2, 'Ana from both computers: ' + (q || 'whole room'));
    assert.deepEqual(room.rows.filter((r) => r.kind === 'external').map((r) => r.id), ['x-b1'], 'CONTROL: the hidden rows really left');
  }
  const text = await (await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room?as=text`)).text();
  assert.equal(text.includes('hiddenBlocked'), false, 'the text view an agent reads is unchanged');
});

test('#8631: after Unblock the count goes', async () => {
  assert.equal((await post('/api/blocked/unblock', { account: 'acctA' })).status, 200);
  const room = await read('');
  assert.equal(Object.prototype.hasOwnProperty.call(room, 'hiddenBlocked'), false);
  assert.equal(room.rows.filter((r) => r.kind === 'external').length, 3);
});
