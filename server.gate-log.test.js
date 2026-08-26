'use strict';
/* #908: with KOSMOS_INSTALL_GATE=1 the board appends one line per request,
   `time method path user-agent`, to a file outside any sandbox, so the next
   time the install gate's page is loaded by something unknown (#891) the
   log names it. Off by default: the control asserts a board started without
   the flag writes nothing. Env is read at require time, so this file sets
   it before requiring the server, and runs in its own process under
   node --test like every other server.*.test.js. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-')), 'nested', 'install-gate-requests.log');
process.env.KOSMOS_INSTALL_GATE = '1';
process.env.KOSMOS_INSTALL_GATE_LOG = LOG;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gatelog-launch-'));

const { start, server } = require('./server');

test('#908: every request lands in the gate log with method, path and user-agent, and the folder is made', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/whats-new`, { headers: { 'user-agent': 'GateProbe/1 (#908 test)' } });
  await fetch(`${base}/`, { headers: { 'user-agent': 'Mozilla/5.0 fake page load' } });
  const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n');
  assert.ok(lines.length >= 2, 'fewer than two lines: ' + JSON.stringify(lines));
  const api = lines.find((l) => l.includes(' GET /api/whats-new '));
  const page = lines.find((l) => l.includes(' GET / '));
  assert.ok(api, 'the API call is not logged: ' + JSON.stringify(lines));
  assert.ok(page, 'the page load is not logged: ' + JSON.stringify(lines));
  assert.match(api, /^\d{4}-\d\d-\d\dT[^ ]+ GET \/api\/whats-new GateProbe\/1 \(#908 test\)$/, 'line shape is time method path user-agent: ' + api);
  assert.match(page, /Mozilla\/5\.0 fake page load$/, 'the user-agent must name the host');
  /* Ordering is the discriminator Shredder reads: the page load came AFTER
     the API call here, and the log must keep that order. */
  assert.ok(lines.indexOf(api) < lines.indexOf(page), 'lines are not in request order');
});
