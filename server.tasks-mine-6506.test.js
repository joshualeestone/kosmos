'use strict';

/**
 * kosmos#6506 (ruling 3): GET /api/tasks/mine returns the CALLING agent's own OPEN tasks across
 * every project it is on, keyed on its agent token. This holds the route to the security the card
 * requires: a missing/unknown/ambiguous token is refused, one agent's token never returns another
 * agent's tasks, and only open-group tasks appear (built/held/closed are left out).
 *
 * Same sandbox-then-enforce harness as server.agent-reads-4491.test.js: the board boots fully
 * sandboxed, enforcement is flipped on in memory, and projects.readAll is monkey-patched, so no
 * real store is touched.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasksmine-6506-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState } = require('./server');
const sendertoken = require('./engine/sendertoken');
const projectsEngine = require('./engine/projects');

const BOARD = 'BOARDTOKEN_test_6506_tasksmine_0123456789';
const GATE_REFUSAL = /this board belongs to the account that started it/;
let base;
let readerToken;
let otherToken;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  const r = sendertoken.mint('reader-agent');
  const o = sendertoken.mint('other-agent');
  assert.ok(r.ok && o.ok, 'could not mint the agent tokens for the test');
  readerToken = r.token;
  otherToken = o.token;
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function call(method, p, { headers = {} } = {}) {
  const res = await fetch(base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...headers } });
  const text = await res.text().catch(() => '');
  return { code: res.status, text };
}
const asAgent = (t) => ({ headers: { 'x-kosmos-agent-token': t } });
const refusedAtGate = (r) => r.code === 403 && GATE_REFUSAL.test(r.text);

/* projA is SHARED (both agents are members) and carries one open task for each of them, plus a BUILT
   reader task; projB is reader-only; projC is other-only; projD is reader-only but its tasks are HELD
   and (by a closed part) DONE. A correct route gives reader exactly {projA#1, projB#1} and other
   exactly {projA#2, projC#1}, and never a built/held/closed task. */
function withProjects(t) {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'projA', name: 'projA', agents: ['reader-agent', 'other-agent'], tasks: [
      { number: 1, sentence: 'reader open A', who: 'reader-agent' },
      { number: 2, sentence: 'other open A', who: 'other-agent' },
      { number: 3, sentence: 'reader built A', who: 'reader-agent', builtAt: '2026-10-18T00:00:00.000Z' },
    ] },
    { id: 'projB', name: 'projB', agents: ['reader-agent'], tasks: [
      { number: 1, sentence: 'reader open B', who: 'reader-agent' },
    ] },
    { id: 'projC', name: 'projC', agents: ['other-agent'], tasks: [
      { number: 1, sentence: 'other open C', who: 'other-agent' },
    ] },
    { id: 'projD', name: 'projD', agents: ['reader-agent'], tasks: [
      { number: 1, sentence: 'reader held D', who: 'reader-agent', onHold: true },
      { number: 2, sentence: 'reader done D', parts: [{ id: 1, who: 'reader-agent', closedAt: '2026-10-18T00:00:00.000Z' }] },
    ] },
  ];
  t.after(() => { projectsEngine.readAll = realAll; });
}

test('CONTROL: /api/tasks/mine is refused at the gate with no credential and with a token nobody issued', async () => {
  assert.ok(refusedAtGate(await call('GET', '/api/tasks/mine')), 'the gate did not refuse a bare GET');
  assert.ok(refusedAtGate(await call('GET', '/api/tasks/mine', asAgent('c'.repeat(64)))), 'a token nobody issued passed the gate');
});

test('an agent reads its OWN open tasks across every project it is on, and no others', async (t) => {
  withProjects(t);
  const r = await call('GET', '/api/tasks/mine', asAgent(readerToken));
  assert.equal(r.code, 200, r.text.slice(0, 200));
  const j = JSON.parse(r.text);
  const titles = (j.tasks || []).map((x) => x.title).sort();
  assert.deepEqual(titles, ['reader open A', 'reader open B'], 'reader got the wrong set: ' + r.text.slice(0, 240));
  assert.equal(j.count, 2);
  // not another agent's, not a built or held or done one
  assert.doesNotMatch(r.text, /other open A|other open C/, 'reader saw another agent\'s tasks');
  assert.doesNotMatch(r.text, /reader built A|reader held D|reader done D/, 'reader saw a non-open task');
});

test('isolation: a second agent\'s token returns ITS tasks, never the first agent\'s', async (t) => {
  withProjects(t);
  const r = await call('GET', '/api/tasks/mine', asAgent(otherToken));
  assert.equal(r.code, 200, r.text.slice(0, 200));
  const titles = (JSON.parse(r.text).tasks || []).map((x) => x.title).sort();
  assert.deepEqual(titles, ['other open A', 'other open C'], 'other got the wrong set: ' + r.text.slice(0, 240));
  assert.doesNotMatch(r.text, /reader open A|reader open B|reader built A|reader held D|reader done D/, 'one agent\'s token returned another agent\'s tasks');
});

test('an agent on NO project gets an empty list, not an error and not someone else\'s tasks', async (t) => {
  const realAll = projectsEngine.readAll;
  projectsEngine.readAll = () => [
    { id: 'projX', name: 'projX', agents: ['someone-else'], tasks: [{ number: 1, sentence: 'not yours', who: 'someone-else' }] },
  ];
  t.after(() => { projectsEngine.readAll = realAll; });
  const r = await call('GET', '/api/tasks/mine', asAgent(readerToken));
  assert.equal(r.code, 200, r.text.slice(0, 200));
  assert.deepEqual(JSON.parse(r.text).tasks, []);
  assert.equal(JSON.parse(r.text).count, 0);
  assert.doesNotMatch(r.text, /not yours/);
});

test('an ambiguous (twins, key-only) token is refused, never widened to a guess', async (t) => {
  withProjects(t);
  const realResolveName = sendertoken.resolveName;
  // A token that resolves ok with a key but no name and twins:true (an old key-only token whose key a
  // second name now also holds). The gate admits it (ok:true); the handler must refuse rather than guess.
  sendertoken.resolveName = (tok) => (tok === readerToken ? { ok: true, key: 'ambi6506', name: null, twins: true, instance: null } : realResolveName(tok));
  t.after(() => { sendertoken.resolveName = realResolveName; });
  const r = await call('GET', '/api/tasks/mine', asAgent(readerToken));
  assert.equal(r.code, 403, r.text.slice(0, 200));
  assert.match(JSON.parse(r.text).error, /could not tell which agent/);
});
