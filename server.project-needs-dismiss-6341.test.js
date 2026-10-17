'use strict';
/**
 * #6341 (Josh, 10-16 19:43): POST /api/project/<id>/needs-dismiss keeps a dismissed "needs you" row on the project,
 * per member and reason, over HTTP on a fully sandboxed board; it refuses what the page cannot have shown.
 *
 *   node --test server.project-needs-dismiss-6341.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-needs-dismiss-6341-'));
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
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const stored = (id) => projects.readAll().find((p) => p.id === id);
const dismiss = (id, body, raw) => fetch(`${base}/api/project/${encodeURIComponent(id)}/needs-dismiss`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: raw !== undefined ? raw : JSON.stringify(body),
});

test('#6341: a dismissal is kept on the project, per member and reason, and answered with the project', async () => {
  const p = projects.create({ name: 'Needs Dismiss', agents: ['nd61', 'ne61'] });
  assert.deepEqual(stored(p.id).agents, ['nd61', 'ne61'], 'CONTROL: the fixture project has both members');
  const r = await dismiss(p.id, { agent: 'nd61', reason: 'question' });
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.project && body.project.id, p.id, 'the answer is the project as the page reads it');
  assert.deepEqual(stored(p.id).needsDismissed, { nd61: 'question' });
  assert.equal((await dismiss(p.id, { agent: 'ne61', reason: 'elsewhere' })).status, 200);
  assert.deepEqual(stored(p.id).needsDismissed, { nd61: 'question', ne61: 'elsewhere' }, 'a second dismissal replaced the first');
});

test('#6341: what the page cannot have shown is refused, and nothing is written', async () => {
  const p = projects.create({ name: 'Needs Refuse', agents: ['nr61'] });
  for (const [body, status, why] of [
    [{ agent: 'stranger', reason: 'question' }, 400, 'a name that is not a member'],
    [{ agent: 'nr61', reason: 'made_up' }, 400, 'a reason the page does not show'],
    [{ reason: 'question' }, 400, 'no agent'],
  ]) {
    const r = await dismiss(p.id, body);
    assert.equal(r.status, status, why + ': ' + (await r.text()));
  }
  assert.equal((await dismiss(p.id, null, '{not json')).status, 400, 'a body that is not JSON');
  assert.equal((await dismiss('no-such-project', { agent: 'nr61', reason: 'question' })).status, 404, 'an unknown project');
  assert.equal(stored(p.id).needsDismissed, undefined, 'a refused dismissal wrote something');
});

test('#6341 review 3: a store that cannot be read is our fault, answered 500, not 400', async () => {
  const p = projects.create({ name: 'Needs Damaged', agents: ['nx61'] });
  const file = projects.file();
  const kept = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{ not json');
  try {
    const r = await dismiss(p.id, { agent: 'nx61', reason: 'question' });
    assert.equal(r.status, 500, await r.text());
  } finally { fs.writeFileSync(file, kept); }
  assert.equal((await dismiss(p.id, { agent: 'nx61', reason: 'question' })).status, 200, 'CONTROL: the same request with the store back');
});
