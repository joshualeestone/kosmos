'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#8959 slice D1c1: GET /api/status says the computer's platform and whether it is a cloud computer.
 *
 * The page reads both from its own <meta> tags (kosmos-platform, kosmos-cloud-machine); the iPhone has no page, and its
 * native Updates screen picks the card's arms (the Windows confirm, the slow sentence) and whether the
 * automatic-updates switch shows by them. This boots a real, sandboxed board and reads its status, so the two fields
 * are proven to be served, with this process's own platform and engine/cloudmachine's own answer.
 *   node --test server.status-platform-8959.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-statusplatform-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

require('./test-support/faketmux-win').serveOnWindows();   // kosmos#8378: fake tmux's reads on Windows, where its script cannot run
const { start, server } = require('./server');
const cloudMachine = require('./engine/cloudmachine');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test('#8959 /api/status carries platform and cloudMachine, as the page\'s meta tags do', async () => {
  const res = await fetch(base + '/api/status');
  assert.equal(res.status, 200);
  const st = await res.json();
  assert.equal(st.platform, process.platform, 'the platform is the board process\'s own');
  assert.equal(st.cloudMachine, cloudMachine.isCloudMachine(), 'cloudMachine is engine/cloudmachine\'s answer');
  assert.equal(typeof st.cloudMachine, 'boolean');
  // Beside the update fields the phone reads with them (control: this is the status payload, not some other answer).
  assert.ok('bootedAt' in st && 'updateChannel' in st, Object.keys(st).join());
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
