'use strict';
/* kosmos#8728: a Mac that had just restarted (load ~150) refused the first remote action six minutes later with
   "cannot vouch ... update Kosmos". The connector's own answer was right; the board's one ask at tunnel start most
   likely did not answer in time, and nothing asked again until a person's request did, which was then refused.
   Pinned here:
   (a) an unanswered ask is asked again BY ITSELF, with no request;
   (b) while the answer is not known yet the refusal says Kosmos+ is still starting, not "update Kosmos", and a
       connector that answered without the capability still gets the update sentence;
   (c) every ask leaves one line in the board's log, and the line says truly what happens next;
   (d) an ask after an unanswered one gets the longer limit;
   and the self-asking stops after its cap. Timings are shortened through a test-only seam; the real ones are 5 s,
   15 s and 30 s. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-capask-8728-'));
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
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
// Stand-in connectors are node scripts named .js, which the board runs through node (kosmos#8378).
const connector = (name, body) => { const f = path.join(SANDBOX, name + '.js'); fs.writeFileSync(f, "'use strict';\n" + body + '\n', { mode: 0o755 }); return f; };
const CONNECTOR = connector('kosmos-tunnel', "if (process.argv[2] === 'capabilities') process.stdout.write('session-headers\\n'); else process.exitCode = 1;");
// Answers yes, but only after `ms`: a computer busy starting up.
const slow = (name, ms) => connector(name, "setTimeout(() => process.stdout.write('session-headers\\n'), " + ms + ');');
const OLD = connector('old-tunnel', 'process.exitCode = 2;');   // an older connector: the verb is unknown
process.env.AGENT_WORKFORCE_TUNNEL_BIN = CONNECTOR;

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, REMOTE_STEP_UP_CONNECTOR, REMOTE_STEP_UP_STARTING } = require('./server');
const remote = require('./engine/remote');

const TEST_PID = 424240;
const STATUS = path.join(require('./engine/store').ROOT, 'remote-status.json');
const listRunning = (pid = TEST_PID) => { fs.mkdirSync(path.dirname(STATUS), { recursive: true }); fs.writeFileSync(STATUS, JSON.stringify({ state: 'up', pid, capabilities: ['session-headers'] })); };
const reset = (timings = null, commandOf = () => null) => { listRunning(); remote.resetConnectorCapabilitiesForTests({ runningPid: TEST_PID, commandOf, timings }); };
const warm = () => new Promise((resolve) => remote.warmConnectorCapabilities(resolve));
const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); return ok(); };
// The board's log lines from the capability ask, caught from stderr.
let lines = [];
const realError = console.error;
const catchLog = () => { lines = []; console.error = (...a) => { const s = a.join(' '); if (s.startsWith('remote: connector capabilities')) lines.push(s); else realError(...a); }; };
const releaseLog = () => { console.error = realError; };
// The KEPT binary answer, read without starting an ask: a request would ask by itself and blur (a).
const kept = () => remote.connectorCapabilities(Date.now() - 60 * 60 * 1000);

let base;
test.before(async () => { await start(0); reset(); await warm(); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  releaseLog();
  reset(); server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const now = () => Math.floor(Date.now() / 1000);
const VIA_PLUS = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-for': '203.0.113.9',
  'x-kosmos-session-iat': String(now() - 30), 'x-kosmos-session-second': '1' };
const post = async (route) => {
  const res = await fetch(base + route, { method: 'POST', headers: { ...VIA_PLUS, 'x-kosmos-session-iat': String(now() - 30) }, body: 'not json' });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('8728 (a)(c)(d): a slow first ask goes unanswered, then the board asks again BY ITSELF with the longer limit, and both asks are logged', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = slow('slow-tunnel', 400);
  catchLog();
  try {
    // The retry's limit is wide (review 1): a cold node start on a loaded machine must not turn a slow answer into a
    // third, unanswered ask. Only the FIRST limit has to be shorter than the stand-in's 400 ms.
    reset({ askMs: 100, retryAskMs: 15000, recheckMs: 150 });
    const first = await warm();
    assert.equal(first.size, 0, 'the first ask did not answer inside its 100 ms');
    assert.equal(remote.connectorCapabilitiesPending(), true, 'not known yet, so pending');
    // No request is made from here on: only the board's own retry can fill it.
    assert.ok(await until(() => kept().has('session-headers'), 30000), 'asked again by itself and answered: ' + JSON.stringify(lines));
    assert.equal(remote.connectorCapabilitiesPending(), false);
    assert.match(lines[0], /not answered in \d+ ms \(limit 100 ms\); asking again in 0 s/);
    assert.match(lines[lines.length - 1], /answered in \d+ ms: session-headers$/);
    assert.equal(lines.length, 2, 'one line per ask: ' + JSON.stringify(lines));
  } finally { releaseLog(); process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('8728 (b): over HTTP, a gated remote request while the answer is not known yet is told Kosmos+ is still starting, never to update', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = slow('slower-tunnel', 5000);
  catchLog();
  try {
    reset({ askMs: 50, retryAskMs: 50, recheckMs: 60 * 60 * 1000 });
    await warm();
    const got = await post('/api/accounts/gemini/apikey');
    assert.equal(got.status, 403, JSON.stringify(got.body));
    assert.equal(got.body.code, 'remote_step_up_unavailable', 'the same code, so pages that read it keep working');
    assert.equal(got.body.error, REMOTE_STEP_UP_STARTING.error);
    assert.doesNotMatch(got.body.error, /update/i);
    assert.match(got.body.error, /still starting/);
  } finally { releaseLog(); process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('8728 (b) control: a connector that ANSWERED without the capability still gets the update sentence', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = OLD;
  catchLog();
  try {
    reset();
    assert.equal((await warm()).size, 0);
    const got = await post('/api/accounts/gemini/apikey');
    assert.equal(got.status, 403, JSON.stringify(got.body));
    assert.equal(got.body.error, REMOTE_STEP_UP_CONNECTOR.error);
    assert.match(got.body.error, /update Kosmos/);
    assert.equal(remote.connectorCapabilitiesPending(), false);
    assert.match(lines[0], /answered in \d+ ms: none$/);
  } finally { releaseLog(); process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('8728: a connector that never answers is asked 1 + 20 times by itself, then left for the next request; the last line and the refusal say so', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = slow('never-tunnel', 60 * 1000);
  catchLog();
  try {
    reset({ askMs: 40, retryAskMs: 40, recheckMs: 10 });
    await warm();
    assert.ok(await until(() => lines.length >= 21, 15000), 'asked 21 times: ' + lines.length);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(lines.length, 21, 'and then stopped asking by itself');
    assert.match(lines[19], /asking again in 0 s/);
    assert.match(lines[20], /asked 21 times; asking again at the next remote request/);
    assert.equal(kept().size, 0);
    // Review 2: once the board has stopped asking by itself, "still starting" would be a promise nothing keeps.
    assert.equal(remote.connectorCapabilitiesPending(), false, 'given up: the update sentence again');
    const got = await post('/api/accounts/gemini/apikey');
    assert.equal(got.body.error, REMOTE_STEP_UP_CONNECTOR.error);
  } finally { releaseLog(); process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('8728: a new tunnel (a new generation) clears the old self-retry, so the old timer never asks', async () => {
  const was = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = slow('gen-tunnel', 60 * 1000);
  catchLog();
  try {
    reset({ askMs: 40, retryAskMs: 40, recheckMs: 300 });
    await warm();
    assert.equal(lines.length, 1, 'the first ask, unanswered: its self-retry is now armed for 300 ms');
    // A tunnel start forgets the answer. ask: false, so nothing else asks: only a surviving old timer could log a line
    // (review 1: with a new ask that answers, that answer's own clear hid whether the forget cleared anything).
    remote.forgetConnectorCapabilities({ always: true, ask: false });
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(lines.length, 1, 'the old timer was cleared with its generation: ' + JSON.stringify(lines));
  } finally { releaseLog(); process.env.AGENT_WORKFORCE_TUNNEL_BIN = was; reset(); await warm(); }
});

test('8728 review 1: while a tunnel from an earlier board is being ended, the refusal says still starting, not update', async () => {
  catchLog();
  try {
    // ps cannot answer (undefined): the foreign pid gets no verdict, so the running half lists nothing meanwhile.
    reset(null, () => undefined);
    assert.ok((await warm()).has('session-headers'), 'the binary said yes');
    assert.ok(remote.connectorCapabilities().has('session-headers'), 'and the running child listed it');
    listRunning(999999);   // an orphan from an earlier board rewrites the status file under its own pid
    const got = await post('/api/accounts/gemini/apikey');
    assert.equal(got.status, 403, JSON.stringify(got.body));
    assert.equal(got.body.error, REMOTE_STEP_UP_STARTING.error);
    // Control: the child's own status again, and the request reaches the route (400 on its unreadable body).
    listRunning();
    const ok = await post('/api/accounts/gemini/apikey');
    assert.equal(ok.status, 400, JSON.stringify(ok.body));
  } finally { releaseLog(); reset(); await warm(); }
});
