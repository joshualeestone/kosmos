'use strict';
/* kosmos#7598: GET /api/remote names the account-only sign-up on the coordinator this board signs in to, so the code
   step's "Create an account" goes there and not to the pricing page (a company member's seat is already paid for by
   the company, so buying there pays for nothing). Against the real server; the page's half is
   web.signup-link-7598.test.js and the browser check render-plus-signin-3478.js. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-signup-link-7598-'));
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
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';
delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const remote = require('./engine/remote');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const read = async () => (await fetch(base + '/api/remote')).json();

test('#7598: the sign-up address is /signup on the coordinator this board signs in to', async () => {
  const dflt = await read();
  assert.equal(dflt.signupUrl, String(remote.coordinator()).replace(/\/+$/, '') + '/signup',
    'the default board does not point at its own coordinator\'s sign-up');
  assert.match(dflt.signupUrl, /^https:\/\/[^/]+\/signup$/, 'the default sign-up address is not an https /signup');
  // A board set to another coordinator (a test one) sends its people to THAT sign-up, trailing slash or not.
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coordinator.kosmos.invalid/';
  assert.equal((await read()).signupUrl, 'https://coordinator.kosmos.invalid/signup');
  // Control: the env really reaches the read, so the first assertion was about the default and not a constant.
  assert.notEqual((await read()).signupUrl, dflt.signupUrl);
  delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
});
