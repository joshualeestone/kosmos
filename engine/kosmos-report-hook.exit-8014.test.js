'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#8014: the report hook as Claude Code runs it, a real child process, against a fake board on loopback that
 * answers the board proof, /api/report and /api/file-notices/take. On the Windows box (node 24), two requests to the
 * board followed by process.exit died on a libuv assertion (exit 127); the entry now lets the process end on its own.
 * Checks the exit code, that the hook JSON is printed whole, that the run ends well before the 2 s backstop, and that
 * a stdin that never closes still ends shortly after the 5 s stdin backstop.
 * kosmos#8968: no upper bound here is a total wall-clock time, which a loaded Mac doubled (10.4 s against a 7 s ceiling, the
 * same file passing alone). The 2 s backstop is armed only after the hook's last request is answered, so a run that
 * waits for it ends 2 s or more after the board saw that request: the bound is on that tail. The 5 s stdin backstop
 * is timed from when node starts the hook (a preload's mark), so a slow start is not counted against it.
 *   node --test engine/kosmos-report-hook.exit-8014.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const boardproof = require('./boardproof');

const HOOK = path.join(__dirname, 'kosmos-report-hook.js');
const AGENT = 'c3c3c3c3c3c3c3c3';
const HOOK_JSON = '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Kosmos: a file note."}}';

function fakeBoard(stall) {
  const seen = [];
  const at = [];   // kosmos#8968: when each request arrived (ms), in the order of `seen`
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    seen.push(u.pathname); at.push(Date.now());
    req.resume();
    req.on('end', () => {
      if (u.pathname === boardproof.PROOF_PATH) {
        const a = boardproof.answer(Object.fromEntries(u.searchParams), () => [AGENT], req.socket.localPort, req.socket.localAddress);
        res.writeHead(a.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(a.body)); return;
      }
      // A route in `stall` sends its headers and the start of a body, then never finishes it.
      if (stall && stall.includes(u.pathname)) { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"kept":'); return; }
      if (u.pathname === '/api/file-notices/take') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ack:a1\n' + HOOK_JSON); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"recorded":true}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen, at })));
}

function runHook(port, evt, { closeStdin = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rhk8014x-'));
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1', TEMP: tmp, TMP: tmp, TMPDIR: tmp };
  // kosmos#8968: the preload runs just before the hook's own code, so its mark is when the hook's timers start.
  const preload = path.join(tmp, 'mark.js');
  fs.writeFileSync(preload, "process.stderr.write('KOSMOS-8968-START ' + Date.now() + '\\n');\n");
  const t0 = Date.now();
  const child = spawn(process.execPath, ['-r', preload, HOOK], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.stdin.write(JSON.stringify(evt));
  if (closeStdin) child.stdin.end();
  return new Promise((resolve) => child.on('close', (code) => {
    if (!closeStdin) { try { child.stdin.destroy(); } catch { /* gone */ } }
    const closedAt = Date.now();
    const m = /KOSMOS-8968-START (\d+)/.exec(err);
    resolve({ code, out, err, ms: closedAt - t0, closedAt, startedAt: m ? Number(m[1]) : null });
  }));
}

// kosmos#8968: how long the hook ran on after the board saw its last request. A run held open until the 2 s exit
// backstop cannot be under 2000 here, because that timer is set only after the last answer; a loaded machine adds
// far less than the 2 s to a run that ends on its own.
const TAIL_MS = 1950;
function tail(b, r) {
  assert.ok(b.at.length > 0, 'the hook never reached the board');
  return r.closedAt - b.at[b.at.length - 1];
}
// kosmos#8968: how long the hook took between the board seeing `route` and its next request (or its close). A hook
// that waited on an answer's body would sit here until that call's abort timer, a stall the tail cannot see.
function after(b, r, route) {
  const i = b.seen.indexOf(route);
  assert.ok(i >= 0, 'the hook never asked for ' + route + ': ' + b.seen.join(' '));
  return (i + 1 < b.at.length ? b.at[i + 1] : r.closedAt) - b.at[i];
}

test('a UserPromptSubmit that reports and takes its notices exits 0 on its own, printing the hook JSON whole', async () => {
  const b = await fakeBoard();
  try {
    const r = await runHook(b.port, { hook_event_name: 'UserPromptSubmit', prompt: 'go', session_id: 's' });
    assert.equal(r.code, 0, 'exit ' + r.code + ': ' + r.err);
    assert.equal(r.out, HOOK_JSON + '\n');
    assert.ok(b.seen.includes('/api/report') && b.seen.includes('/api/file-notices/take'), 'both requests reached the board: ' + b.seen.join(' '));
    assert.ok(tail(b, r) < TAIL_MS, 'the run waited for the 2 s backstop (' + tail(b, r) + ' ms after the last request, ' + r.ms + ' ms in all)');
  } finally { b.server.close(); }
});

test('a stdin that never closes still ends shortly after the 5 s stdin backstop, exit 0, without waiting 2 s more', async () => {
  const b = await fakeBoard();
  try {
    const r = await runHook(b.port, { hook_event_name: 'Stop', session_id: 's' }, { closeStdin: false });
    assert.equal(r.code, 0, 'exit ' + r.code + ': ' + r.err);
    assert.ok(r.ms >= 4500, 'ended before the stdin backstop, at ' + r.ms + ' ms');
    assert.ok(r.startedAt, 'the start mark is missing: ' + r.err);
    const fired = b.at[0] - r.startedAt;   // the first request goes out once the stdin backstop has run the hook
    assert.ok(fired >= 4500 && fired < 8000, 'the stdin backstop ran the hook ' + fired + ' ms after it started (5 s expected)');
    assert.ok(tail(b, r) < TAIL_MS, 'the run waited 2 s more after the backstop (' + tail(b, r) + ' ms after the last request, ' + r.ms + ' ms in all)');
  } finally { b.server.close(); }
});

test('an answer whose body never finishes (keep-copy on an edit) does not hold the run for the 2 s backstop', async () => {
  const b = await fakeBoard(['/api/undo/keep']);
  try {
    const r = await runHook(b.port, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(os.tmpdir(), 'x8014.md'), old_string: 'a', new_string: 'b' }, cwd: os.tmpdir(), session_id: 's' });
    assert.equal(r.code, 0, 'exit ' + r.code + ': ' + r.err);
    assert.ok(b.seen.includes('/api/undo/keep'), 'the edit never asked for a copy: ' + b.seen.join(' '));
    assert.ok(after(b, r, '/api/undo/keep') < TAIL_MS, 'the hook waited on the unfinished body (' + after(b, r, '/api/undo/keep') + ' ms before it went on, ' + r.ms + ' ms in all)');
    assert.ok(tail(b, r) < TAIL_MS, 'the unfinished body held the run (' + tail(b, r) + ' ms after the last request, ' + r.ms + ' ms in all)');
  } finally { b.server.closeAllConnections(); b.server.close(); }
});
