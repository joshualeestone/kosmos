'use strict';
/**
 * kosmos#8724 item 1: POST /api/agent/<name>/restart for a window the person linked to Kosmos by hand, which has no
 * launch job. The plain restart is refused for want of a job, as before, and now says Kosmos can set the agent up and
 * restart it (canWriteJob); { writeJob: true } writes the job (register.repair with linked) and then restarts.
 * Driven through the real board. The roster is status.setPaneSource; removal.restart, register.survey and
 * register.repair are stubbed so nothing is written or started.
 *
 *   node --test server.restart-linkjob-8724.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-linkjob-8724-'));
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
const register = require('./engine/register');
const status = require('./engine/status');
const fleet = require('./test-support/fleet');

const REAL = { restart: removal.restart, survey: register.survey, repair: register.repair };
let hasJob = false;          // what the stubbed restart sees
let repairs = [];
let repairAnswer = null;     // null: a repair that writes the job
let restarts = [];           // every call into removal.restart
let acted = [];              // the ones that got past its checks and beforeSteps, and so acted
let row = null;              // the survey's row for zara
let gate = null;             // a refusal the restart's own checks give (quiet hours, cap, busy), before beforeSteps
let afterJob = null;         // what the restart answers once it acts (null: restarted)
/* The real removal.restart's order: its own checks, then opts.beforeSteps, then the steps. */
removal.restart = (n, cause, opts) => {
  restarts.push(n);
  if (gate) return gate;
  if (opts && typeof opts.beforeSteps === 'function') { const stop = opts.beforeSteps(); if (stop) return stop; }
  acted.push(n);
  if (afterJob) return afterJob;
  if (!hasJob) {
    return { outcome: removal.OUTCOME.REFUSED, steps: [], cannotStart: true, noJob: true,
      because: `${n} was not started by Kosmos, so we cannot start it again. Whatever launched it is what can restart it.` };
  }
  return { outcome: removal.OUTCOME.RESTARTED, because: `${n} is starting again.`, steps: [] };
};
register.survey = () => ({ ok: true, agents: row ? [row] : [], missing: [], unknown: [], hidden: [] });
register.repair = (o) => {
  repairs.push(o);
  if (repairAnswer) return repairAnswer;
  hasJob = true;
  return { ok: true, results: [{ name: o.only, ok: true }], installed: 1, started: 1 };
};

const { start, server } = require('./server');
let lines = [];
let base;
test.before(async () => {
  status.setPaneSource(() => lines.map((l) => fleet.line(l)).join('\n') + (lines.length ? '\n' : ''));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  hasJob = false; repairs = []; repairAnswer = null; restarts = []; acted = []; gate = null; afterJob = null;
  row = { name: 'zara', shownAs: 'zara', profile: true, folder: true, removed: false, job: false };
  lines = [{ session: 'zara', claim: 'zara' }];   // linked: Kosmos's mark names its own session
});
test.after(() => {
  Object.assign(removal, { restart: REAL.restart });
  Object.assign(register, { survey: REAL.survey, repair: REAL.repair });
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const post = async (name, body) => {
  const r = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/restart`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { code: r.status, j: await r.json() };
};

test('#8724 a linked window with no job: the refusal offers to set it up, and says what that means', async () => {
  const r = await post('zara');
  assert.equal(r.code, 400, JSON.stringify(r.j));
  assert.equal(r.j.canWriteJob, true, JSON.stringify(r.j));
  assert.match(r.j.because, /Nothing is set up to start zara again/);
  assert.match(r.j.because, /set zara up to start on its own, then restart it/);
  assert.match(r.j.because, /different account/);
  /* It says nothing about who started the window: an agent Kosmos once started whose job went missing qualifies too. */
  assert.doesNotMatch(r.j.because, /by hand/);
  assert.doesNotMatch(r.j.because, /—/);
  assert.deepEqual(repairs, [], 'a plain Restart wrote a job without being asked');
});

test('#8724 no offer for a window that is not linked, one linked under another session name, or a job state we cannot prove', async () => {
  for (const [label, setup] of [
    ['not linked', () => { lines = [{ session: 'zara', claim: '' }]; }],
    ['linked as zara-discord', () => { lines = [{ session: 'zara-discord', claim: 'zara-discord' }]; }],
    ['job unknown', () => { row.job = null; }],
    ['no profile', () => { row.profile = false; }],
    ['removed', () => { row.removed = true; }],
  ]) {
    row = { name: 'zara', shownAs: 'zara', profile: true, folder: true, removed: false, job: false };
    lines = [{ session: 'zara', claim: 'zara' }];
    setup();
    const r = await post('zara');
    assert.equal(r.code, 400, label);
    assert.notEqual(r.j.canWriteJob, true, label + ': offered: ' + JSON.stringify(r.j));
    assert.match(r.j.because, /was not started by Kosmos/, label + ': the engine sentence was replaced');
  }
});

test('#8724 Set up and restart writes the job for that one agent, then restarts it', async () => {
  const r = await post('zara', { writeJob: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.outcome, removal.OUTCOME.RESTARTED);
  assert.equal(r.j.jobWritten, true);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].only, 'zara');
  assert.equal(repairs[0].linked, true);
  assert.deepEqual(acted, ['zara']);
});

test('#8724 writeJob for an agent that does not qualify changes nothing; CONTROL: the qualifying case (above) does', async () => {
  lines = [{ session: 'zara', claim: '' }];   // not linked
  const r = await post('zara', { writeJob: true });
  assert.equal(r.code, 400, JSON.stringify(r.j));
  assert.match(r.j.because, /does not need setting up, so nothing was changed\.$/);
  assert.deepEqual(repairs, []);
  assert.deepEqual(restarts, [], 'it was restarted anyway');
});

test('#8724 a restart its own checks refuse (quiet hours, cap, busy) writes no job; CONTROL: an allowed one does (above)', async () => {
  gate = { outcome: removal.OUTCOME.REFUSED, steps: [], because: 'it was not started: it is quiet hours', quiet: true };
  const r = await post('zara', { writeJob: true });
  assert.equal(r.code, 400, JSON.stringify(r.j));
  assert.match(r.j.because, /quiet hours/);
  assert.deepEqual(repairs, [], 'a job was written for a restart that was then refused');
  assert.notEqual(r.j.jobWritten, true);
});

test('#8724 set up but the restart did not take: the answer says the job is there and starts it at the next login', async () => {
  afterJob = { outcome: removal.OUTCOME.PARTIAL, steps: [{ label: 'close its window', ok: false }], because: 'We could not close its window.' };
  const r = await post('zara', { writeJob: true });
  assert.equal(r.j.jobWritten, true, JSON.stringify(r.j));
  assert.match(r.j.because, /^We could not close its window\. Kosmos did set zara up to start on its own, so it starts again at the next login\.$/);
});

test('#8724 a job that could not be written stops before the restart, with the reason', async () => {
  repairAnswer = { ok: true, results: [{ name: 'zara', ok: false, because: 'launchd said no' }] };
  const r = await post('zara', { writeJob: true });
  assert.equal(r.code, 400, JSON.stringify(r.j));
  assert.match(r.j.because, /could not set zara up to start on its own \(launchd said no\), so it was not restarted/);
  assert.deepEqual(acted, [], 'restarted after the job failed');
});
