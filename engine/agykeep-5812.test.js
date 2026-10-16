'use strict';

/* #5812 item 4: an Antigravity (agy) agent's file edits record their writer and keep an undo copy. engine/agyhooks.js
   hooks PreToolUse before agy's two file tools; bin/agy-report-bridge.js answers ASK (as for every tool but
   ask_question) and posts the board's keep call. The last test drives the REAL agy (1.2.17 or newer) against a local
   fake Gemini API, with HOME pointed at a scratch folder, when agy is installed. */

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile, execFileSync } = require('node:child_process');

/* #4796: this test's children (the bridge, agy and its hooks) get a data root of their own, so the live board token
   never travels to a stub board. */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agykeep-5812-data-'));
const hooks = require('./agyhooks');
const BRIDGE = path.join(__dirname, '..', 'bin', 'agy-report-bridge.js');
const bridge = require(BRIDGE);
const SUPERVISOR = path.join(__dirname, '..', 'bin', 'agent-supervisor.sh');
const dir = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agykeep-5812-')));

const pre = (o) => ({ conversationId: 'c1', workspacePaths: ['/w/agent'],
  toolCall: { name: 'write_to_file', args: { TargetFile: '/w/agent/a.txt', CodeContent: 'x', Overwrite: true } }, ...o });

test('the keep is made from what agy 1.2.17 sends: TargetFile, workspacePaths[0] as cwd, conversationId as session', () => {
  assert.deepEqual(bridge.keepRequestFor('PreToolUse', pre({})), { path: '/w/agent/a.txt', cwd: '/w/agent', session: 'c1' });
  assert.deepEqual(bridge.keepRequestFor('PreToolUse', pre({ toolCall: { name: 'replace_file_content', args: { TargetFile: '/p/proj/b.md' } } })),
    { path: '/p/proj/b.md', cwd: '/w/agent', session: 'c1' });
});

test('no keep for another event or tool, a relative or missing path, or a control character', () => {
  assert.equal(bridge.keepRequestFor('PostToolUse', pre({})), null);
  assert.equal(bridge.keepRequestFor('PreToolUse', pre({ toolCall: { name: 'ask_question', args: {} } })), null);
  assert.equal(bridge.keepRequestFor('PreToolUse', pre({ toolCall: { name: 'run_command', args: { TargetFile: '/x' } } })), null);
  assert.equal(bridge.keepRequestFor('PreToolUse', pre({ toolCall: { name: 'write_to_file', args: { TargetFile: 'rel.txt' } } })), null);
  assert.equal(bridge.keepRequestFor('PreToolUse', pre({ toolCall: { name: 'write_to_file', args: {} } })), null);
  assert.equal(bridge.keepRequestFor('PreToolUse', pre({ toolCall: { name: 'write_to_file', args: { TargetFile: '/a\u0007b' } } })), null);
  assert.equal(bridge.keepRequestFor('PreToolUse', null), null);
});

test('on win32 a drive path is kept; a UNC path or folder, and a drive-less rooted path, are not', () => {
  assert.deepEqual(bridge.keepRequestFor('PreToolUse', pre({ workspacePaths: ['C:\\w'], toolCall: { name: 'write_to_file', args: { TargetFile: 'C:\\w\\x.txt' } } }), 'win32'),
    { path: 'C:\\w\\x.txt', cwd: 'C:\\w', session: 'c1' });
  assert.equal(bridge.keepRequestFor('PreToolUse', pre({ workspacePaths: ['C:\\w'], toolCall: { name: 'write_to_file', args: { TargetFile: '\\\\srv\\s\\x' } } }), 'win32'), null);
  assert.equal(bridge.keepRequestFor('PreToolUse', pre({ workspacePaths: ['\\\\srv\\s'], toolCall: { name: 'write_to_file', args: { TargetFile: 'C:\\x' } } }), 'win32'), null);
  assert.equal(bridge.keepRequestFor('PreToolUse', pre({ toolCall: { name: 'write_to_file', args: { TargetFile: '\\x' } } }), 'win32'), null);
});

test('the supervisor launches agy with --dangerously-skip-permissions (the measured premise: the hook answer cannot stop an edit then)', () => {
  const src = fs.readFileSync(SUPERVISOR, 'utf8');
  assert.match(src, /_AGY_ARGS=\(--dangerously-skip-permissions\)/);
  assert.match(src, /"\$CLAUDE" "\$\{_AGY_ARGS\[@\]\}"/);
});

/* A stub board recording keeps; `stall` sends headers and never finishes the body. */
function stubBoard(stall) {
  const seen = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (req.url === '/api/undo/keep') { try { seen.push(JSON.parse(b)); } catch { seen.push(null); } }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (stall) res.write('{"kept":'); else res.end('{"kept":false,"because":"off"}');
    });
  });
  server.on('connection', (s) => sockets.add(s));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    seen, port: server.address().port, close: () => { for (const s of sockets) s.destroy(); server.close(); },
  })));
}
function runBridge(port, eventName, payload) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(process.execPath, [BRIDGE, eventName], {
      env: { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_AGENT_TOKEN: '' }, timeout: 9000,
    }, (err, stdout) => resolve({ err, stdout, ms: Date.now() - started, killed: child.killed || child.signalCode !== null }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('run as agy runs it: PreToolUse for a file tool answers ASK and posts the keep', async () => {
  const board = await stubBoard(false);
  try {
    const r = await runBridge(board.port, 'PreToolUse', pre({}));
    assert.equal(r.err, null);
    assert.equal(r.stdout.trim(), bridge.ASK, 'the same answer as for every tool but ask_question');
    assert.deepEqual(board.seen, [{ path: '/w/agent/a.txt', cwd: '/w/agent', session: 'c1' }]);
  } finally { board.close(); }
});

test('ask_question is unchanged: ALLOW, and no keep', async () => {
  const board = await stubBoard(false);
  try {
    const r = await runBridge(board.port, 'PreToolUse', pre({ toolCall: { name: 'ask_question', args: { questions: [{ question: 'Which one?' }] } } }));
    assert.equal(r.stdout.trim(), bridge.ALLOW);
    assert.deepEqual(board.seen, []);
  } finally { board.close(); }
});

test('a board that stalls its answer does not hold the hook past the keep bound, and the answer is already out', async () => {
  const slow = await stubBoard(true);
  try {
    const r = await runBridge(slow.port, 'PreToolUse', pre({}));
    assert.equal(r.killed, false, 'exited on its own');
    assert.ok(r.ms < 5000, `took ${r.ms} ms (agy's handler timeout is 5 s)`);
    assert.equal(r.stdout.trim(), bridge.ASK);
  } finally { slow.close(); }
});

/* ---- the real agy: only agy can say whether the hook runs before the write ---- */
const installed = (() => {
  try { return execFileSync('agy', ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'none'; }
})();
const atLeast = (v, min) => {
  const a = String(v).split('.').map(Number); const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; }
  return true;
};
const realAgy = process.platform !== 'win32' && /^\d+\.\d+\.\d+$/.test(installed) && atLeast(installed, '1.2.17');

/* A fake Gemini API: the first call answers with `call`, every later one in words. */
function fakeGemini(call) {
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(b); } catch { body = {}; }
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"models":[]}'); return; }
      const answered = JSON.stringify(body.contents || []).includes('functionResponse');
      const parts = answered ? [{ text: 'done' }] : [{ functionCall: { name: call.name, args: call.args } }];
      const cand = { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
      if (req.url.includes('stream')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${JSON.stringify(cand)}\n\n`); }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(cand)); }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}
function runAgy(home, work, port, env) {
  return new Promise((resolve) => {
    const child = execFile('agy', ['--dangerously-skip-permissions', '-p', 'edit the file'], {
      cwd: work, timeout: 90000,
      env: { ...process.env, ...env, HOME: home, GEMINI_API_KEY: 'x', GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${port}` },
    }, (err, stdout, stderr) => resolve({ err, stderr, killed: child.killed || child.signalCode !== null }));
    child.stdin.end();
  });
}

test(`the REAL agy (${installed}) runs the hook before the write, and the bridge reaches the board`, { skip: realAgy ? false : `needs agy 1.2.17 or newer on PATH (this computer: ${installed})` }, async () => {
  const home = dir();
  const work = dir();
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity-cli'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'antigravity-cli', 'settings.json'), '{"modelProvider":"gemini"}');
  const target = path.join(work, 'made.txt');
  const board = await stubBoard(false);
  const model = await fakeGemini({ name: 'write_to_file', args: { TargetFile: target, Overwrite: true, CodeContent: 'made\n', Description: 'test', toolSummary: 'test', toolAction: 'test' } });
  try {
    assert.equal(hooks.ensureHooks(work, process.execPath, BRIDGE, true).ok, true);
    const r = await runAgy(home, work, model.port, { KOSMOS_PORT: String(board.port), TMUX_PANE: '' });
    assert.equal(r.killed, false, `agy did not finish: ${r.stderr}`);
    assert.equal(fs.readFileSync(target, 'utf8'), 'made\n', 'the edit ran (the ASK answer did not stop it)');
    assert.equal(board.seen.length, 1, 'one keep');
    assert.equal(board.seen[0].path, target);
    assert.equal(board.seen[0].cwd, work);
    assert.ok(board.seen[0].session, 'the conversation id came through');

    // Control: the same run with the hook entry carrying no tool hooks sends no keep.
    board.seen.length = 0;
    fs.rmSync(target);
    assert.equal(hooks.ensureHooks(work, process.execPath, BRIDGE, false).ok, true);
    const r2 = await runAgy(home, work, model.port, { KOSMOS_PORT: String(board.port), TMUX_PANE: '' });
    assert.equal(r2.killed, false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'made\n');
    assert.deepEqual(board.seen, []);
  } finally { board.close(); model.server.close(); }
});
