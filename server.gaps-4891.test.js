'use strict';
/**
 * kosmos#4891, the board's half, over HTTP on a fully sandboxed board:
 *   N8  GET /api/project/:id/room?as=text&n=N shows the last N rows (1 to 200). Without n, or with a value out of
 *       range, it is the last 40, as it always was, so an older CLI and a bad value both get what they got before.
 *   N6  GET /api/tasks?project=<unknown> is a 404 "there is no project by that name" on the list form the CLIs
 *       read, where it was an empty list. A real project with no tasks is still an empty list.
 *
 *   node --test server.gaps-4891.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gaps-4891-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const messages = require('./engine/messages');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* The numbered notes the room text shows, in order. */
async function shown(id, query) {
  const r = await fetch(`${base}/api/project/${id}/room?as=text${query}`);
  assert.equal(r.status, 200);
  return (await r.text()).split('\n').map((l) => (/note (\d\d)\b/.exec(l) || [])[1]).filter(Boolean).map(Number);
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('#4891 N8: n chooses how many of the last rows the room text shows; without it, 40', async () => {
  const p = projects.create({ name: 'Gaps Room' });
  for (let i = 1; i <= 50; i++) messages.roomNote(p.id, 'note ' + String(i).padStart(2, '0'));
  assert.deepEqual(await shown(p.id, '&n=5'), range(46, 50));
  assert.deepEqual(await shown(p.id, '&n=1'), [50]);
  assert.deepEqual(await shown(p.id, '&n=200'), range(1, 50));
  // CONTROL: no n, and every out-of-range or malformed n, is the old 40.
  for (const q of ['', '&n=0', '&n=201', '&n=abc', '&n=05', '&n=']) {
    assert.deepEqual(await shown(p.id, q), range(11, 50), 'n given as ' + JSON.stringify(q));
  }
});

test('#4891 N6: tasks for an unknown project is a 404 that says so; a real empty project is an empty list', async () => {
  const missing = await fetch(`${base}/api/tasks?project=nosuch-4891`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'there is no project by that name');
  const p = projects.create({ name: 'Gaps Tasks' });
  const empty = await fetch(`${base}/api/tasks?project=${p.id}`);
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).tasks, []);
  // CONTROL: the global list (no project) is untouched.
  const all = await fetch(`${base}/api/tasks`);
  assert.equal(all.status, 200);
});
