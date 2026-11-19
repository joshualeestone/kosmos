'use strict';
/* kosmos#8728: /api/connect/start tells the sign-in whether the request came from a remote session, so a remote-started
   Claude sign-in opens no browser on this computer (engine/connect.js, remoteStarted -> BROWSER=/usr/bin/true; that
   half is pinned in engine/connect.test.js). This file pins the server half: what the route hands connect.start.
   connect.start is replaced by a recorder, so nothing is launched; the remote arm reaches the route the only way a
   real one can, through the step-up gate (a vouching connector and fresh session headers, as in
   server.remotestepup-6595.test.js). */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remoteopener-8728-'));
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
// A connector that vouches for the session headers (node script, run through node: kosmos#8378).
const CONNECTOR = path.join(SANDBOX, 'kosmos-tunnel.js');
fs.writeFileSync(CONNECTOR, "'use strict';\nif (process.argv[2] === 'capabilities') process.stdout.write('session-headers\\n'); else process.exitCode = 1;\n", { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = CONNECTOR;

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const remote = require('./engine/remote');
const connect = require('./engine/connect');

const TEST_PID = 424240;
const STATUS = path.join(require('./engine/store').ROOT, 'remote-status.json');
fs.mkdirSync(path.dirname(STATUS), { recursive: true });
fs.writeFileSync(STATUS, JSON.stringify({ state: 'up', pid: TEST_PID, capabilities: ['session-headers'] }));

let base;
const calls = [];
const realStart = connect.start;
test.before(async () => {
  await start(0);
  remote.resetConnectorCapabilitiesForTests({ runningPid: TEST_PID, commandOf: () => null });
  await new Promise((resolve) => remote.warmConnectorCapabilities(resolve));
  remote.connectorCapabilities();
  connect.start = async (opts) => { calls.push(opts); return { phase: 'idle' }; };
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  connect.start = realStart;
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const now = () => Math.floor(Date.now() / 1000);
const PAGE = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const VIA_PLUS = () => ({ ...PAGE, 'x-forwarded-host': 'hers.kosmos.invalid', 'x-forwarded-for': '203.0.113.9',
  'x-kosmos-session-iat': String(now() - 30), 'x-kosmos-session-second': '1' });
const post = async (headers, body) => {
  const res = await fetch(base + '/api/connect/start', { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

for (const [label, body] of [['the default account re-auth', { reauth: true }], ['a second account', { another: true }]]) {
  test('#8728: ' + label + ' started through Kosmos+ is handed remoteStarted: true', async () => {
    calls.length = 0;
    const got = await post(VIA_PLUS(), body);
    assert.equal(got.status, 200, JSON.stringify(got.body));
    assert.equal(calls.length, 1, 'connect.start was called once');
    assert.equal(calls[0].remoteStarted, true, JSON.stringify(calls[0]));
  });
  test('#8728 CONTROL: ' + label + ' started at the computer is handed remoteStarted: false', async () => {
    calls.length = 0;
    const got = await post(PAGE, body);
    assert.equal(got.status, 200, JSON.stringify(got.body));
    assert.equal(calls.length, 1, 'connect.start was called once');
    assert.equal(calls[0].remoteStarted, false, JSON.stringify(calls[0]));
  });
}
