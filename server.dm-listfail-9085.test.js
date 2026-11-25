'use strict';

/**
 * kosmos#9085: on Windows `claude agents --json` crashed about once a minute for five hours, the roster refused once
 * win32roster's hold ran out, and POST /api/agent/<name>/thread answered every message to a running agent 404 "no
 * agent by that name". A roster that cannot be READ is now answered as unknown: 409, `because: 'unreadable'`, `retry`,
 * nothing sent. A roster that reads and does not list the name is still a 404.
 *
 * The roster is fed through status.setPaneSource, the seam the Windows board uses. A source that answers null is
 * what a refused read hands the roster ("we could not look"), on every platform. Runs on every platform.
 *
 *   node --test server.dm-listfail-9085.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-listfail-9085-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
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
const app = require('./server');
const { start, server } = app;
const status = require('./engine/status');
const create = require('./engine/create');
const fleet = require('./test-support/fleet');

let source = () => null;
let base;
let logged = [];
const realError = console.error;
test.before(async () => {
  status.setPaneSource(() => source());
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  source = () => null;
  logged = [];
  console.error = (...a) => { logged.push(a.join(' ')); };
  app._setStartWaitForTest({ maxMs: 0 });
  fs.mkdirSync(create.workerDir('raph'), { recursive: true });
});
test.afterEach(() => { console.error = realError; });
test.after(() => {
  console.error = realError;
  app._setStartWaitForTest(null);
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function send(name, text) {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/thread`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('#9085 a roster that cannot be read answers 409 unreadable, never 404 "no agent", and says so in the log', async () => {
  assert.throws(() => status.paneRoster(), 'CONTROL: the roster really refuses, as it does on Windows when the read fails');
  const r = await send('raph', 'hello');
  assert.notEqual(r.status, 404, 'a message to an agent nobody could look for was refused as missing: ' + JSON.stringify(r.json));
  assert.equal(r.status, 409, 'a 4xx: the page and the iPhone read a 5xx on a send as "it may have gone": ' + JSON.stringify(r.json));
  assert.equal(r.json.because, 'unreadable');
  assert.equal(r.json.retry, true, 'the body says plainly to try again');
  assert.match(r.json.error, /could not check which agents are running, so nothing was sent/);
  assert.ok(logged.some((l) => /kosmos#9085/.test(l) && /"raph" was not sent/.test(l) && /answered 409 unreadable, not 404/.test(l)),
    'the board log names the agent and why: ' + JSON.stringify(logged));
});

test('#9085 CONTROL: a roster that READS and does not list the name is still a 404 "no agent by that name"', async () => {
  source = () => '';   // a good, empty answer
  const r = await send('raph', 'hello');
  assert.equal(r.status, 404, JSON.stringify(r.json));
  assert.equal(r.json.error, 'no agent by that name');
  assert.equal(r.json.retry, undefined, 'a missing name is not something to retry');
  assert.equal(logged.filter((l) => /kosmos#9085/.test(l)).length, 0, 'nothing is logged for an ordinary missing name');
});

test('#9085 CONTROL: a name the board cannot key, on a roster that reads, is a 404, never "unreadable"', async () => {
  source = () => '';
  const r = await send('!!!', 'hello');
  assert.notEqual(r.json && r.json.because, 'unreadable', JSON.stringify(r.json));
  assert.ok(r.status === 400 || r.status === 404, 'refused as a bad or missing name: ' + JSON.stringify(r.json));
  assert.equal(logged.filter((l) => /kosmos#9085/.test(l)).length, 0);
});

test('#9085 on Windows a failing Claude read behind a readable roster (a codex agent up) makes an absent name unknown, with the reason logged', async () => {
  source = () => fleet.line({ session: 'cody', claim: 'cody' }) + '\n';   // the roster reads: only the codex agent is listed
  app._setClaudeReadProblemForTest(() => 'the status read exited with code 3');
  try {
    const r = await send('raph', 'hello');
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.because, 'unreadable');
    assert.ok(logged.some((l) => /"raph" was not sent/.test(l) && /\(the status read exited with code 3\)/.test(l)), JSON.stringify(logged));
    app._setClaudeReadProblemForTest(() => null);
    const ok = await send('raph', 'hello');
    assert.equal(ok.status, 404, 'CONTROL: with the Claude read healthy, an absent name is missing: ' + JSON.stringify(ok.json));
  } finally { app._setClaudeReadProblemForTest(null); }
});

test('#9085 CONTROL: a roster that reads and lists the agent is not refused at the gate', async () => {
  source = () => fleet.line({ session: 'raph', claim: 'raph' }) + '\n';
  const r = await send('raph', 'hello');
  assert.equal(r.status, 200, 'not refused at the gate: ' + JSON.stringify(r.json));
});
