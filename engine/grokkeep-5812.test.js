'use strict';

/* #5812 item 3: a Grok agent's file edits record their writer and keep an undo copy. engine/groksettings.js adds a
   PreToolUse hook (search_replace, write) to the hook file Kosmos owns; bin/grok-report-bridge.js turns it into the
   board's keep call. The last test drives the REAL pinned grok against a local fake model, when it is installed. */

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile, execFileSync } = require('node:child_process');

const settings = require('./groksettings');
const BRIDGE = path.join(__dirname, '..', 'bin', 'grok-report-bridge.js');
const bridge = require(BRIDGE);
const dir = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-grokkeep-5812-')));

const pre = (o) => ({ hook_event_name: 'PreToolUse', tool_name: 'search_replace', cwd: '/w/agent', session_id: 's1',
  tool_input: { file_path: 'a.txt', old_string: 'x', new_string: 'y' }, ...o });

test('the bridge makes a keep for search_replace (relative to cwd) and write (absolute), as grok 1.0.41 sends them', () => {
  assert.deepEqual(bridge.keepRequestFor(pre({})), { path: '/w/agent/a.txt', cwd: '/w/agent', session: 's1' });
  assert.deepEqual(bridge.keepRequestFor(pre({ tool_name: 'write', tool_input: { file_path: '/p/proj/b.md', content: 'z' } })),
    { path: '/p/proj/b.md', cwd: '/w/agent', session: 's1' });
});

test('the bridge makes no keep for another event or tool, no path, a relative path with no folder, or a control character', () => {
  assert.equal(bridge.keepRequestFor(pre({ hook_event_name: 'PostToolUse' })), null);
  assert.equal(bridge.keepRequestFor(pre({ tool_name: 'read_file' })), null);
  assert.equal(bridge.keepRequestFor(pre({ tool_name: 'todo_write' })), null);
  assert.equal(bridge.keepRequestFor(pre({ tool_input: {} })), null);
  assert.equal(bridge.keepRequestFor(pre({ tool_input: 'nope' })), null);
  assert.equal(bridge.keepRequestFor(pre({ cwd: '' })), null);
  assert.equal(bridge.keepRequestFor(pre({ cwd: 'rel/dir' })), null);
  assert.equal(bridge.keepRequestFor(pre({ tool_input: { file_path: 'a\u0007b' } })), null);
  assert.equal(bridge.keepRequestFor(null), null);
});

test('on win32 the bridge resolves a Windows path and refuses a UNC path or folder', () => {
  assert.deepEqual(bridge.keepRequestFor(pre({ cwd: 'C:\\Users\\a\\w', tool_input: { file_path: 'x.txt' } }), 'win32'),
    { path: 'C:\\Users\\a\\w\\x.txt', cwd: 'C:\\Users\\a\\w', session: 's1' });
  assert.equal(bridge.keepRequestFor(pre({ cwd: 'C:\\w', tool_input: { file_path: '\\\\srv\\share\\x' } }), 'win32'), null);
  assert.equal(bridge.keepRequestFor(pre({ cwd: '\\\\srv\\share', tool_input: { file_path: 'x' } }), 'win32'), null);
});

test('main posts the keep to the board (and nothing to /api/report), and never throws on a board that is down', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { text: async () => '' }; };
  await bridge.main({ input: JSON.stringify(pre({})), env: { KOSMOS_PORT: '5556' }, readBoardToken: () => '', fetchImpl });
  assert.deepEqual(seen, [{ url: 'http://127.0.0.1:5556/api/undo/keep', body: { path: '/w/agent/a.txt', cwd: '/w/agent', session: 's1' } }]);
  await bridge.main({ input: JSON.stringify(pre({})), env: {}, readBoardToken: () => '', fetchImpl: async () => { throw new Error('down'); } });
  // A lifecycle event still reports, through the same post.
  seen.length = 0;
  await bridge.main({ input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }), env: { KOSMOS_PORT: '5556' }, readBoardToken: () => '', fetchImpl });
  assert.deepEqual(seen.map((x) => x.url), ['http://127.0.0.1:5556/api/report']);
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
function runBridge(port, stdinText, endStdin) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(process.execPath, [BRIDGE], { env: { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '' }, timeout: 9000 },
      (err, stdout) => resolve({ err, stdout, ms: Date.now() - started, killed: child.killed || child.signalCode !== null }));
    if (endStdin) child.stdin.end(stdinText); else child.stdin.write(stdinText);
  });
}

test('run as grok runs it, the bridge posts the keep and prints nothing', async () => {
  const board = await stubBoard(false);
  try {
    const r = await runBridge(board.port, JSON.stringify(pre({})), true);
    assert.equal(r.err, null);
    assert.equal(r.stdout, '', 'grok runs the tool when the hook says nothing');
    assert.deepEqual(board.seen, [{ path: '/w/agent/a.txt', cwd: '/w/agent', session: 's1' }]);
  } finally { board.close(); }
});

test('a stdin never closed, or a board that stalls its answer, still lets the hook go within its bounds', async () => {
  const board = await stubBoard(false);
  try {
    const r = await runBridge(board.port, JSON.stringify(pre({})), false);
    assert.equal(r.killed, false, 'exited on its own');
    assert.ok(r.ms < 8000, `took ${r.ms} ms`);
    assert.equal(board.seen.length, 1);
  } finally { board.close(); }
  const slow = await stubBoard(true);
  try {
    const r = await runBridge(slow.port, JSON.stringify(pre({})), true);
    assert.equal(r.killed, false, 'exited on its own');
    assert.ok(r.ms < 6000, `took ${r.ms} ms`);
  } finally { slow.close(); }
});

test('the hook file Kosmos owns wires PreToolUse to the bridge with the anchored matcher, beside the lifecycle events', () => {
  const want = settings.desiredContent('/s/bin/grok-report-bridge.js', { platform: 'darwin' });
  assert.deepEqual(want.hooks.PreToolUse, [{ matcher: '^(search_replace|write)$', hooks: [{ type: 'command', command: 'node "/s/bin/grok-report-bridge.js"' }] }]);
  for (const e of settings.HOOK_EVENTS) assert.equal(want.hooks[e][0].matcher, undefined, `${e} keeps no matcher`);
  assert.equal(settings.HOOK_EVENTS.includes('PreToolUse'), false, 'the report-state events stay as they were');
  const re = new RegExp(settings.TOOL_MATCHER);
  assert.ok(re.test('search_replace') && re.test('write'));
  assert.ok(!re.test('todo_write') && !re.test('read_file') && !re.test('write_file'));
});

test('ensurePrepared brings an older file of ours up to date with the tool hook, and leaves a file not ours alone', () => {
  const d = dir();
  const file = path.join(d, 'hooks', 'kosmos-report-bridge.json');
  fs.mkdirSync(path.dirname(file));
  const old = { hooks: {} };
  for (const e of settings.HOOK_EVENTS) old.hooks[e] = [settings.definitionFor('/s/bin/grok-report-bridge.js', { platform: 'darwin' })];
  fs.writeFileSync(file, JSON.stringify(old, null, 2) + '\n');
  assert.deepEqual(settings.ensurePrepared(file, '/s/bin/grok-report-bridge.js', { platform: 'darwin' }), { prepared: true, changed: true });
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse);
  assert.deepEqual(settings.ensurePrepared(file, '/s/bin/grok-report-bridge.js', { platform: 'darwin' }), { prepared: true, changed: false });
  const theirs = path.join(d, 'hooks', 'theirs.json');
  fs.writeFileSync(theirs, '{"hooks":{"PreToolUse":[]}}');
  assert.equal(settings.ensurePrepared(theirs, '/s/bin/grok-report-bridge.js', { platform: 'darwin' }).prepared, false);
  assert.equal(fs.readFileSync(theirs, 'utf8'), '{"hooks":{"PreToolUse":[]}}');
});

/* ---- the real grok: only grok can say whether the hook fires with this payload ---- */
const PINNED = (() => {
  try { return /grok-darwin-arm64-([0-9]+\.[0-9]+\.[0-9]+)\.tgz/.exec(fs.readFileSync(path.join(__dirname, 'runners.js'), 'utf8'))[1]; }
  catch { return null; }
})();
const installed = (() => {
  try { return execFileSync('grok', ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'none'; }
})();
const realGrok = process.platform !== 'win32' && PINNED && installed.startsWith(`grok ${PINNED} `);

/* A fake OpenAI Chat Completions server: the first turn calls `call`, every later one answers in words. */
function fakeModel(call) {
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(b); } catch { body = {}; }
      const after = (body.messages || []).some((m) => m.role === 'tool');
      const delta = after || !req.url.includes('/chat/completions') ? { role: 'assistant', content: 'done' }
        : { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] };
      const fin = delta.tool_calls ? 'tool_calls' : 'stop';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: fin }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}
function runGrok(home, work, env) {
  return new Promise((resolve) => {
    const child = execFile('grok', ['--cwd', work, '-m', 'fake', '--always-approve', '-p', 'edit the file'],
      { env: { ...process.env, ...env, GROK_HOME: home, XAI_API_KEY: 'x' }, timeout: 90000 },
      (err, stdout, stderr) => resolve({ err, stderr, killed: child.killed || child.signalCode !== null }));
    child.stdin.end();
  });
}

test(`the REAL grok (${PINNED || 'pin unreadable'}) runs the hook, and the bridge reaches the board`, { skip: realGrok ? false : `needs grok ${PINNED} on PATH (this computer: ${installed})` }, async () => {
  const home = dir();
  const work = dir();
  fs.writeFileSync(path.join(work, 'existing.txt'), 'old line\n');
  const board = await stubBoard(false);
  const model = await fakeModel({ name: 'search_replace', args: { file_path: 'existing.txt', old_string: 'old line', new_string: 'new line' } });
  try {
    fs.writeFileSync(path.join(home, 'config.toml'), `[model.fake]\nmodel = "fake-model"\nbase_url = "http://127.0.0.1:${model.port}/v1"\nname = "Fake"\napi_key = "x"\n`);
    const hookFile = path.join(home, 'hooks', 'kosmos-report-bridge.json');
    assert.deepEqual(settings.ensurePrepared(hookFile, BRIDGE), { prepared: true, changed: true });
    const r = await runGrok(home, work, { KOSMOS_PORT: String(board.port), TMUX_PANE: '' });
    assert.equal(r.killed, false, `grok did not finish: ${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(work, 'existing.txt'), 'utf8'), 'new line\n', 'the edit ran');
    assert.deepEqual(board.seen, [{ path: path.join(work, 'existing.txt'), cwd: work, session: board.seen[0] && board.seen[0].session }]);
    assert.ok(board.seen[0].session, 'the session id came through');

    // Control: the same run with our hook file gone sends nothing, so the hook (not something else) made the keep.
    board.seen.length = 0;
    fs.rmSync(hookFile);
    fs.writeFileSync(path.join(work, 'existing.txt'), 'old line\n');
    const r2 = await runGrok(home, work, { KOSMOS_PORT: String(board.port), TMUX_PANE: '' });
    assert.equal(r2.killed, false);
    assert.equal(fs.readFileSync(path.join(work, 'existing.txt'), 'utf8'), 'new line\n', 'the edit still ran');
    assert.deepEqual(board.seen, []);
  } finally { board.close(); model.server.close(); }
});
