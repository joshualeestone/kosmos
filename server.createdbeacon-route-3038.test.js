'use strict';
/**
 * kosmos#3038, driven through the REAL POST /api/agents route.
 *
 * The unit test (createdbeacon-3038.test.js) pins the transmit seam and the
 * source wiring by regex; this exercises the route end-to-end so a RUNTIME bug
 * in the count computation or the checkbox gate is caught (a source-regex match
 * cannot see runtime behaviour). It asserts: a create fires exactly one
 * agent-created beacon carrying a real (>=1) count, and `notifyCreated:false`
 * suppresses the beacon entirely.
 *
 * Sandboxes every root the create route writes to (fixture-discipline), with
 * DRY_RUN + fake bins so no launchd job or tmux write escapes -- the same
 * harness shape as server.create-live-1903.test.js. The install ping fired at
 * board start is a no-op under the test runner (createdbeacon's underTest guard
 * blocks a real send when no sender is injected), and we inject the sender only
 * inside each test body, so the capture holds only that test's created pings.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-createdbeacon-3038-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-cb3038-claude-' + process.pid + '.json');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const create = require('./engine/create');
const createdbeacon = require('./engine/createdbeacon');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  create.setClaudeProbe(null);
  createdbeacon.setSender(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function post(body) {
  const res = await fetch(base + '/api/agents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

function captureBeacons() {
  const calls = [];
  createdbeacon.setSender((url, init) => {
    let b = null; try { b = JSON.parse(init && init.body); } catch { b = null; }
    calls.push({ url, body: b });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  });
  return calls;
}

test('#3038: a create fires exactly one agent-created beacon with a real (>=1) count', async () => {
  const calls = captureBeacons();
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok' }));
  try {
    const r = await post({ name: 'beaconborn', role: 'pm' });
    assert.equal(r.json && r.json.outcome, 'created', 'the create did not report created: ' + JSON.stringify(r.json));
    // Fire-and-forget: let the enqueued beacon run.
    await new Promise((res) => setImmediate(res));
    assert.equal(calls.length, 1, 'expected exactly one agent-created beacon, got ' + JSON.stringify(calls));
    assert.match(calls[0].url, /\/api\/created$/);
    // A REAL agent count, never 0 (0 is the install ping's payload -- the create
    // ping must carry the live count including the agent just made).
    assert.ok(Number.isInteger(calls[0].body.count) && calls[0].body.count >= 1,
      'the agent-created beacon carried a bad count: ' + JSON.stringify(calls[0].body));
    assert.equal(typeof calls[0].body.installId, 'string');
    assert.ok(calls[0].body.installId.length > 0);
  } finally { create.setClaudeProbe(null); createdbeacon.setSender(null); }
});

test('#3038: notifyCreated:false suppresses the agent-created beacon', async () => {
  const calls = captureBeacons();
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok' }));
  try {
    const r = await post({ name: 'quietborn', role: 'pm', notifyCreated: false });
    assert.equal(r.json && r.json.outcome, 'created', 'the create did not report created: ' + JSON.stringify(r.json));
    await new Promise((res) => setImmediate(res));
    assert.equal(calls.length, 0, 'notifyCreated:false still sent a beacon: ' + JSON.stringify(calls));
  } finally { create.setClaudeProbe(null); createdbeacon.setSender(null); }
});
