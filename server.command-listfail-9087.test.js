'use strict';

/**
 * kosmos#9087 Part A: compact, clear, handoff-restart/ask and handoff-restart/pickup answered a bare 404 from
 * knownAgent while the roster could not be read. They share #9085's gate now (server.js sendGate, commandGate): 409,
 * `because: 'unreadable'`, `retry`, a log line. A roster that reads and does not list the name is still a 404, and so
 * is a name with no agent folder here. The roster is fed through status.setPaneSource. Runs on every platform.
 *
 *   node --test server.command-listfail-9087.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cmd-listfail-9087-'));
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
  app._setClaudeReadProblemForTest(() => null);   // a healthy Claude read unless a test says otherwise, on every platform
  fs.mkdirSync(create.workerDir('raph'), { recursive: true });
});
test.afterEach(() => { console.error = realError; });
test.after(() => {
  console.error = realError;
  app._setClaudeReadProblemForTest(null);
  app._setStartWaitForTest(null);
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* kosmos#9087: the three routes that type one command into an agent's window answered a bare 404 from knownAgent while
   the roster could not be read. They share #9085's gate now (sendGate). */
const ROUTES = [
  { path: 'compact', what: 'a /compact' },
  { path: 'clear', what: 'a /clear' },
  { path: 'handoff-restart/ask', what: 'a handoff request' },
  { path: 'handoff-restart/pickup', what: 'a handoff pickup' },
];

async function post(name, route) {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

for (const { path: route, what } of ROUTES) {
  test(`#9087 ${route}: a roster that cannot be read answers 409 unreadable with retry, never 404, and logs it`, async () => {
    assert.throws(() => status.paneRoster(), 'CONTROL: the roster really refuses');
    const r = await post('raph', route);
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.because, 'unreadable');
    assert.equal(r.json.retry, true);
    assert.match(r.json.error, /could not check which agents are running, so nothing was sent/);
    const escaped = what.replace(/[/]/g, '\\/');
    assert.ok(logged.some((l) => /kosmos#9085/.test(l) && new RegExp(escaped + ' to "raph" was not sent').test(l)),
      'the board log names what and who: ' + JSON.stringify(logged));
  });

  test(`#9087 ${route} CONTROL: unreadable roster, a name with no agent folder here is a 404, never retried`, async () => {
    const r = await post('nobody', route);
    assert.equal(r.status, 404, JSON.stringify(r.json));
    assert.equal(r.json.error, 'no agent by that name');
    assert.equal(r.json.retry, undefined);
    assert.equal(logged.filter((l) => /kosmos#9085/.test(l)).length, 0);
  });

  test(`#9087 ${route} CONTROL: a roster that READS and does not list the name is still a 404`, async () => {
    source = () => '';
    const r = await post('raph', route);
    assert.equal(r.status, 404, JSON.stringify(r.json));
    assert.equal(r.json.error, 'no agent by that name');
    assert.equal(logged.filter((l) => /kosmos#9085/.test(l)).length, 0);
  });

  test(`#9087 ${route} on Windows: a failing Claude read behind a readable roster makes an absent name unknown`, async () => {
    source = () => fleet.line({ session: 'cody', claim: 'cody' }) + '\n';
    app._setClaudeReadProblemForTest(() => 'the status read exited with code 3');
    const r = await post('raph', route);
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.because, 'unreadable');
    app._setClaudeReadProblemForTest(() => null);
    const ok = await post('raph', route);
    assert.equal(ok.status, 404, 'CONTROL: with the Claude read healthy, an absent name is missing: ' + JSON.stringify(ok.json));
  });

  test(`#9087 ${route} CONTROL: a roster that reads and lists the agent passes the gate`, async () => {
    source = () => fleet.line({ session: 'raph', claim: 'raph' }) + '\n';
    const r = await post('raph', route);
    assert.notEqual(r.status, 404, JSON.stringify(r.json));
    assert.notEqual(r.json && r.json.because, 'unreadable', JSON.stringify(r.json));
  });
}
