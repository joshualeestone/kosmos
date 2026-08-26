'use strict';
/* #908's control: with neither KOSMOS_INSTALL_GATE=1 nor a
   KOSMOS_INSTALL_GATE_LOG path the board writes NO request log. The instrument is for the install
   gate; a product board must never grow a request log by accident. Own
   file because the flag is read at require time. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

/* Neither switch: no flag, no path. HOME is pointed at a temp dir so the
   default path can be asserted absent without reading the operator's real
   ~/.claude/logs. */
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-off-'));
const LOG = path.join(FAKE_HOME, '.claude', 'logs', 'install-gate-requests.log');
delete process.env.KOSMOS_INSTALL_GATE;
delete process.env.KOSMOS_INSTALL_GATE_LOG;
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-off-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-off-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-off-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-off-launch-'));

const { start, server } = require('./server');

test('#908 control: without the flag, no request log is written', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/whats-new`);
  await fetch(`${base}/`);
  assert.ok(!fs.existsSync(LOG), 'a board without KOSMOS_INSTALL_GATE=1 wrote a request log');
});
