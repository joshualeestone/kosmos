'use strict';
/**
 * kosmos#8191: a board a test boots writes "[slow request] ..." to its stdout once a request takes KOSMOS_SLOW_REQUEST_MS
 * (#6721, 5 s by default). Many tests read a board child's whole stdout as one JSON answer, so on a busy runner that line
 * landed in front of the JSON and the parse failed (run 42362867313: forget-claude-1659 and forget-openai-1372).
 * tools/run-tests.sh now sets the limit to one day for every test. This file proves both halves: with a small limit the
 * line does break such a parse (the control), and with the runner's value the same slow request leaves stdout as JSON.
 *
 *   node --test server.slowrequest-runner-8191.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

function runnerLimit() {
  const src = fs.readFileSync(nodePath.join(REPO, 'tools', 'run-tests.sh'), 'utf8');
  const m = src.match(/^export KOSMOS_SLOW_REQUEST_MS=(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

/* Boots the real server in a child, sends one request whose body arrives 60 ms late (so the server's own clock sees a
   request of at least that long), and returns the child's whole stdout, the shape the affected tests read. */
function boardStdout(limit) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-slowrunner-8191-'));
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      const body = JSON.stringify({ dir: ${JSON.stringify(nodePath.join(sb, 'home', '.claude-neverexisted'))} });
      const req = http.request({
        host: '127.0.0.1', port: srv.address().port,
        path: '/api/accounts/claude', method: 'DELETE',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
          setTimeout(() => {
            process.stdout.write(JSON.stringify({ code: res.statusCode }));
            srv.close(); process.exit(0);
          }, 20);
        });
      });
      req.on('error', (e) => { process.stdout.write(JSON.stringify({ code: null, error: String(e.message) })); process.exit(0); });
      req.flushHeaders();
      setTimeout(() => req.end(body), 60);
    });
  `;
  try {
    return execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        KOSMOS_SLOW_REQUEST_MS: String(limit),
        PATH: `${bin}:${process.env.PATH}`,
        AGENT_WORKFORCE_DRY_RUN: '1',
        AGENT_WORKFORCE_HOME: nodePath.join(sb, 'home'),
        AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
        AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
        AGENT_WORKFORCE_LAUNCH: nodePath.join(sb, 'launch'),
        AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'),
        AGENT_WORKFORCE_TMUX_BIN: nodePath.join(bin, 'tmux'),
      },
    });
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
}

test('#8191: tools/run-tests.sh sets KOSMOS_SLOW_REQUEST_MS to at least an hour', () => {
  const limit = runnerLimit();
  assert.ok(limit !== null, 'tools/run-tests.sh no longer exports KOSMOS_SLOW_REQUEST_MS');
  assert.ok(limit >= 3600000, `the runner's limit is ${limit} ms, short enough for a slow test request to log`);
});

test('#8191 control: with a small limit, the slow-request line lands in front of the JSON and breaks the parse', () => {
  const out = boardStdout(10);
  assert.match(out, /^\[slow request\] DELETE \/api\/accounts\/claude took /, 'the control wrote no slow-request line');
  assert.throws(() => JSON.parse(out), SyntaxError);
});

test("#8191: with the runner's limit, the same slow request leaves the child's stdout as one JSON answer", () => {
  const out = boardStdout(runnerLimit() || 86400000);
  assert.doesNotMatch(out, /slow request/);
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.code, 'number', 'the request got no answer: ' + out);
});
