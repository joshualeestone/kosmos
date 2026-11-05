'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#8014: the report hook as Claude Code runs it, a real child process, against a fake board on loopback that
 * answers the board proof, /api/report and /api/file-notices/take. On the Windows box (node 24), two requests to the
 * board followed by process.exit died on a libuv assertion (exit 127); the entry now lets the process end on its own.
 * Checks the exit code, that the hook JSON is printed whole, that the run ends well before the 2 s backstop, and that
 * a stdin that never closes still ends shortly after the 5 s stdin backstop.
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

function fakeBoard() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    seen.push(u.pathname);
    req.resume();
    req.on('end', () => {
      if (u.pathname === boardproof.PROOF_PATH) {
        const a = boardproof.answer(Object.fromEntries(u.searchParams), () => [AGENT], req.socket.localPort, req.socket.localAddress);
        res.writeHead(a.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(a.body)); return;
      }
      if (u.pathname === '/api/file-notices/take') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ack:a1\n' + HOOK_JSON); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"recorded":true}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen })));
}

function runHook(port, evt, { closeStdin = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rhk8014x-'));
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1', TEMP: tmp, TMP: tmp, TMPDIR: tmp };
  const t0 = Date.now();
  const child = spawn(process.execPath, [HOOK], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.stdin.write(JSON.stringify(evt));
  if (closeStdin) child.stdin.end();
  return new Promise((resolve) => child.on('close', (code) => {
    if (!closeStdin) { try { child.stdin.destroy(); } catch { /* gone */ } }
    resolve({ code, out, err, ms: Date.now() - t0 });
  }));
}

test('a UserPromptSubmit that reports and takes its notices exits 0 on its own, printing the hook JSON whole', async () => {
  const b = await fakeBoard();
  try {
    const r = await runHook(b.port, { hook_event_name: 'UserPromptSubmit', prompt: 'go', session_id: 's' });
    assert.equal(r.code, 0, 'exit ' + r.code + ': ' + r.err);
    assert.equal(r.out, HOOK_JSON + '\n');
    assert.ok(b.seen.includes('/api/report') && b.seen.includes('/api/file-notices/take'), 'both requests reached the board: ' + b.seen.join(' '));
    assert.ok(r.ms < 2000, 'the run waited for the 2 s backstop (' + r.ms + ' ms)');
  } finally { b.server.close(); }
});

test('a stdin that never closes still ends shortly after the 5 s stdin backstop, exit 0, without waiting 2 s more', async () => {
  const b = await fakeBoard();
  try {
    const r = await runHook(b.port, { hook_event_name: 'Stop', session_id: 's' }, { closeStdin: false });
    assert.equal(r.code, 0, 'exit ' + r.code + ': ' + r.err);
    assert.ok(r.ms >= 4500 && r.ms < 6900, 'ended at ' + r.ms + ' ms');
  } finally { b.server.close(); }
});
