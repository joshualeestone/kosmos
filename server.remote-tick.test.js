'use strict';
/* The board's ensure tick (Josh's fresh Mac, 2026-08-26 08:50: "The board has
   not started the tunnel" after sign-in, every precondition true, no child).
   engine/remote.js starts the tunnel only when somebody calls ensure(); if
   enrolment or the switch lands by any path that does not, the board rests
   there forever. This boots the real server with the engine's fake tunnel,
   lands enrolment WITHOUT an ensure() call, reads the resting sentence from
   the route, and watches the tick clear it. The tick's interval is shortened
   through its test seam; the default is fifteen seconds. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remote-tick-'));
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
process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
process.env.AGENT_WORKFORCE_TUNNEL_ENSURE_MS = '200';
const FAKE_BIN = path.join(SANDBOX, 'fake-kosmos-tunnel');
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_BIN;
/* The run verb only: it writes the status file the way the real binary does
   and stays alive until SIGTERM. Nothing else is reached by this test. */
fs.writeFileSync(FAKE_BIN, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
if (args[0] === 'run') {
  const address = fs.readFileSync(path.join(flag('--state-dir'), 'address'), 'utf8').trim();
  fs.writeFileSync(flag('--status-file'), JSON.stringify({ state: 'up', address, because: null, pid: process.pid }) + '\\n');
  setInterval(() => {}, 1000);
  process.on('SIGTERM', () => process.exit(0));
} else { process.exit(0); }
`, { mode: 0o755 });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const remote = require('./engine/remote');
let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  remote.setOn(false); remote.ensure();
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const status = async () => (await (await fetch(base + '/api/remote')).json()).status;

test('enrolment landing with no ensure() call rests at "has not started"; the board\'s tick starts the tunnel by itself', async () => {
  remote.setOn(true);                                   // through the engine, not the route: the route would call ensure()
  const dir = path.join(process.env.AGENT_WORKFORCE_DATA, 'remote');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(dir, f), f === 'address' ? 'hers.kosmos.invalid\n' : 'x\n');
  const resting = await status();
  /* The tick fires every 200ms here; a read inside that window sees the
     resting state. If it does not (the tick beat the read), the resting
     half is unproven for this run and says so rather than passing blind. */
  if (resting.because === 'the board has not started the tunnel') {
    assert.equal(resting.state, 'off');
  } else {
    console.log('note: the tick fired before the first read; the resting half is covered by engine/remote.test.js');
  }
  const deadline = Date.now() + 3000;
  let s = resting;
  while (Date.now() < deadline && s.because === 'the board has not started the tunnel') {
    await new Promise((r) => setTimeout(r, 50)); s = await status();
  }
  assert.notEqual(s.because, 'the board has not started the tunnel', JSON.stringify(s));
  assert.ok(['connecting', 'up'].includes(s.state), JSON.stringify(s));
});
