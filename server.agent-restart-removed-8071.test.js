'use strict';
/**
 * kosmos#8071 review 1: POST /api/agent/<name>/restart does not start a removed agent again. The route passes
 * startIfDead, and on Linux a removed agent's kept job could be started; the page offers no Restart for one, and the
 * new `kosmos agent restart` verb accepts any name, so the route itself refuses. Driven through the real board, with
 * removal's isRemoved and restart stubbed so nothing is started.
 *
 *   node --test server.agent-restart-removed-8071.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-rsremoved-'));
for (const d of ['home', 'bin', 'data', 'workers', 'launch', 'projects']) fs.mkdirSync(nodePath.join(SANDBOX, d), { recursive: true });
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.TMUX;
delete process.env.TMUX_PANE;
for (const b of ['claude', 'tmux']) fs.writeFileSync(nodePath.join(SANDBOX, 'bin', b), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = nodePath.join(SANDBOX, 'bin', 'claude');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(SANDBOX, 'bin', 'tmux');

const removal = require('./engine/remove');
const REAL = { isRemoved: removal.isRemoved, restart: removal.restart, removedNames: removal.removedNames };
const restarted = [];
removal.isRemoved = (n) => n === 'gone';
removal.removedNames = () => ['gone'];
removal.restart = (n) => { restarted.push(n); return { outcome: removal.OUTCOME.RESTARTED, because: `${n} is starting again.`, steps: [] }; };

const { start, server } = require('./server');
let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { Object.assign(removal, REAL); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const post = async (name) => { const r = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/restart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return { code: r.status, j: await r.json() }; };

test('kosmos#8071: a removed agent is refused and never restarted; an agent that is not removed still is', async () => {
  const gone = await post('gone');
  assert.equal(gone.code, 400, JSON.stringify(gone.j));
  assert.equal(gone.j.outcome, 'refused');
  assert.match(gone.j.because, /gone was removed, so it is not restarted/);
  assert.deepEqual(restarted, [], 'a removed agent reached removal.restart');
  const cased = await post('Gone');
  assert.equal(cased.code, 400, 'a removed agent named in other case was restarted: ' + JSON.stringify(cased.j));
  assert.deepEqual(restarted, []);
  const here = await post('here');
  assert.equal(here.code, 200, JSON.stringify(here.j));
  assert.deepEqual(restarted, ['here'], 'CONTROL: an agent that is not removed was not restarted');
});
