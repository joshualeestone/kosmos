'use strict';

/**
 * kosmos#4163 gap 4: the board's real send to the coordinator (`phonenotify.defaultSend`),
 * which no other test reaches. Every in-process test injects a sender, and without one
 * `happened()` refuses to dial while NODE_TEST_CONTEXT is set. So each case here runs
 * `happened()` in a child node process WITHOUT NODE_TEST_CONTEXT, enrolled against a
 * sandbox state dir, with the coordinator URL pointed at a local server playing the
 * coordinator. What is guarded:
 *   - the request: POST to <coordinator>/v1/mac/notify (a self-hosted path prefix kept),
 *     the notify token and JSON content type, a content-length that matches the body, and
 *     the coordinator's payload fields with no message words;
 *   - a non-2xx answer is logged with its status, never the token;
 *   - a coordinator that cannot be reached is logged, and the process still exits;
 *   - a coordinator that never answers is given up on, so the board is not held.
 * Only defaultSend's http: branch runs here (a local server); production dials https:, whose
 * TLS path this does not reach.
 *
 *   node --test engine.phonenotify-send-4163.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TOKEN = 'knt1_sendtest0123456789';
const NOTIFY_ID = '11111111-2222-4333-8444-555555555555';

/** A sandbox the child reads as an enrolled Mac with phone notifications on. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-4163pn-'));
  const state = path.join(dir, 'remote');
  fs.mkdirSync(state, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(state, f), 'x');
  fs.writeFileSync(path.join(state, 'phone-notify.json'), JSON.stringify({ on: true, notifyId: NOTIFY_ID, token: TOKEN }));
  return { dir, state };
}

/** Run happened() once in a child with no NODE_TEST_CONTEXT; resolve its stderr and exit code. */
function runChild(coordinator, event) {
  const { dir, state } = sandbox();
  const env = { ...process.env,
    AGENT_WORKFORCE_DATA: path.join(dir, 'data'),
    AGENT_WORKFORCE_TUNNEL_STATE: state,
    AGENT_WORKFORCE_TUNNEL_COORDINATOR: coordinator,
    EVENT: JSON.stringify(event),
    PN: path.join(__dirname, 'engine', 'phonenotify.js') };
  delete env.NODE_TEST_CONTEXT;
  const script = "const pn = require(process.env.PN); pn.setAvailableForTests(true); pn.happened(JSON.parse(process.env.EVENT));";
  return new Promise((resolve) => {
    const started = Date.now();
    let stderr = '';
    let finished = false;
    let child;
    // One way out, whatever happens: a child that never exits (the very timeout under test
    // regressing) is killed and reported as code null instead of hanging the suite.
    const done = (code, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(killer);
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, stderr, ms: Date.now() - started, error });
    };
    const killer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done(null, 'killed after 20 s');
    }, 20000);
    try {
      child = spawn(process.execPath, ['-e', script], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) { done(null, String(e)); return; }
    child.on('error', (e) => done(null, String(e)));
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => done(code));
  });
}

/** A local coordinator: answers `status` (or never, when status is null) and records requests. */
function coordinator(status) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (status !== null) { res.writeHead(status); res.end(); }
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, port: srv.address().port })));
}

const EVENT = { kind: 'needs_you', id: 'report:2026-09-27T11:00:00Z:leo', agent: 'Leo', session: 'leo', project: 'Henderson lease', text: 'the words of the report' };

test('the real send is the request the coordinator expects, under a self-hosted path prefix', async () => {
  const c = await coordinator(204);
  try {
    const r = await runChild(`http://127.0.0.1:${c.port}/kosmos`, EVENT);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(c.seen.length, 1, 'one event, one request');
    const req = c.seen[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/kosmos/v1/mac/notify');
    assert.equal(req.headers['x-kosmos-notify-token'], TOKEN);
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(Number(req.headers['content-length']), Buffer.byteLength(req.body));
    const body = JSON.parse(req.body);
    assert.deepEqual(Object.keys(body).sort(), ['agent', 'at', 'id', 'installId', 'kind', 'project', 'session']);
    assert.equal(body.installId, NOTIFY_ID);
    assert.equal(body.kind, 'needs_you');
    assert.equal(body.agent, 'Leo');
    assert.ok(!req.body.includes('the words of the report'), 'the report\'s words left the Mac');
    assert.doesNotMatch(r.stderr, /phonenotify:/, 'a 2xx is not logged');
  } finally { c.srv.close(); }
});

test('a refused send is logged with its status, never the token', async () => {
  for (const status of [401, 500]) {
    const c = await coordinator(status);
    try {
      const r = await runChild(`http://127.0.0.1:${c.port}`, EVENT);
      assert.equal(c.seen.length, 1, `status ${status}`);
      assert.match(r.stderr, new RegExp(`Kosmos\\+ answered ${status} to a notification`));
      assert.ok(!r.stderr.includes(TOKEN), 'the token reached the log');
    } finally { c.srv.close(); }
  }
});

test('a coordinator that cannot be reached is logged and the process still exits', async () => {
  const port = await new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const r = await runChild(`http://127.0.0.1:${port}`, EVENT);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /could not reach Kosmos\+: ECONNREFUSED/);
});

test('a coordinator that never answers is given up on after the timeout', async () => {
  const c = await coordinator(null);
  try {
    const r = await runChild(`http://127.0.0.1:${c.port}`, EVENT);
    assert.equal(c.seen.length, 1, 'the request was sent');
    assert.equal(r.code, 0, r.error || 'the child did not exit on its own');
    assert.ok(r.ms >= 3500 && r.ms < 15000, `gave up after ${r.ms} ms, not about 4 s`);
    // Giving up destroys the request, which surfaces as a reset, not a refusal.
    assert.match(r.stderr, /could not reach Kosmos\+: ECONNRESET/);
  } finally { c.srv.closeAllConnections(); c.srv.close(); }
});
