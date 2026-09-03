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
/* kosmos#1651: DRY_RUN stops tmux WRITES; the roster is a READ and only
   TMUX_BIN redirects one, so the whole-sandbox guard now requires it. */
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
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

test('#2029: both secret-bearing query params are redacted in the log -- token AND its sibling boot nonce', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // Distinct sentinel values so a leak of EITHER secret is unambiguous. gateLog
  // runs at the top of the handler, before any bootstrap redirect, so the raw
  // query is what reaches the log -- redaction is the only thing keeping it out.
  await fetch(`${base}/?token=TOKENSENTINEL111`, { headers: { 'user-agent': 'redact-token/1' } });
  await fetch(`${base}/?boot=BOOTSENTINEL222`, { headers: { 'user-agent': 'redact-boot/1' } });
  await fetch(`${base}/?token=TOKENSENTINEL333&boot=BOOTSENTINEL444`, { headers: { 'user-agent': 'redact-both/1' } });
  const body = fs.readFileSync(LOG, 'utf8');
  // No secret VALUE may appear anywhere in the log.
  assert.doesNotMatch(body, /TOKENSENTINEL111|TOKENSENTINEL333/, 'the board token leaked into the gate log');
  assert.doesNotMatch(body, /BOOTSENTINEL222|BOOTSENTINEL444/, 'the boot nonce leaked into the gate log (#2029)');
  // And each key survives with a REDACTED value, so the log still says WHAT was called.
  const lines = body.trim().split('\n');
  const tokenLine = lines.find((l) => l.includes('redact-token/1'));
  const bootLine = lines.find((l) => l.includes('redact-boot/1'));
  const bothLine = lines.find((l) => l.includes('redact-both/1'));
  // Guard the finds before matching, so a missing line fails with a clear message
  // rather than a raw TypeError from assert.match(undefined, ...).
  assert.ok(tokenLine && bootLine && bothLine, 'all three tagged requests must have been logged: ' + JSON.stringify(lines));
  assert.match(tokenLine, /[?&]token=REDACTED/, 'token= must be redacted');
  assert.match(bootLine, /[?&]boot=REDACTED/, 'boot= must be redacted (#2029)');
  assert.match(bothLine, /token=REDACTED&boot=REDACTED/, 'both are redacted when they appear together');
});
