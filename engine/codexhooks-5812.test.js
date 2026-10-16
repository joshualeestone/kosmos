'use strict';

/* #5812 item 2: the Codex file-edit hook. engine/codexhooks.js puts the hook and its trust record into an agent's
   private Codex home; bin/codex-report-bridge.js (hook mode) turns an apply_patch into the board's keep calls. The last
   test drives the REAL installed Codex, when it is the pinned build, against a local fake model server: the trust hash
   is Codex's internal format, and only Codex itself can say whether a record still counts. */

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile, execFileSync } = require('node:child_process');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-codexhooks-5812-data-'));
const hooks = require('./codexhooks');
const BRIDGE = path.join(__dirname, '..', 'bin', 'codex-report-bridge.js');
const bridge = require(BRIDGE);

const home = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-codexhooks-5812-')));

const PINNED_VERSION = require('./runners').MANIFEST.openai.version;

test('the trust hash is the one the real Codex TUI wrote for this hook (codex-cli 0.149.1, 10-16)', () => {
  // Measured: Codex's own "Trust all and continue" wrote this record for exactly this hooks.json (timeout 10 included).
  const command = hooks.commandFor('/Applications/Some Place/bin/codex-report-bridge.js');
  assert.equal(command, "'/Applications/Some Place/bin/codex-report-bridge.js'");
  assert.equal(hooks.trustHash(command), 'sha256:55b913ed3075b80d916e32ce3d1a321f7b03c6d2e2f092c56edf256eec14dd39');
  assert.deepEqual(JSON.parse(hooks.hooksJson(command)),
    { hooks: { PreToolUse: [{ matcher: 'apply_patch', hooks: [{ type: 'command', command, timeout: 10 }] }] } });
});

test('commandFor quotes a single quote in the path for the shell', () => {
  assert.equal(hooks.commandFor("/a/it's/b.js"), "'/a/it'\\''s/b.js'");
});

test('nextConfig appends when absent, and leaves every other table byte-for-byte', () => {
  const heading = hooks.stateHeading('/h/hooks.json');
  const line = `trusted_hash = "sha256:${'a'.repeat(64)}"`;
  const theirs = '[projects."/w"]\ntrust_level = "trusted"\n\n[tui]\nx = 1';
  const r = hooks.nextConfig(theirs, heading, line);
  assert.equal(r.text, `${theirs}\n${heading}\n${line}\n`);
  assert.equal(hooks.nextConfig('', heading, line).text, `${heading}\n${line}\n`);
});

test('nextConfig: the same record is a no-op; a different hash in our form has only that line replaced', () => {
  const heading = hooks.stateHeading('/h/hooks.json');
  const a = `trusted_hash = "sha256:${'a'.repeat(64)}"`;
  const b = `trusted_hash = "sha256:${'b'.repeat(64)}"`;
  const text = `[x]\ny = 1\n${heading}\n${a}\n\n[tui]\nz = 2\n`;
  assert.deepEqual(hooks.nextConfig(text, heading, a), { same: true });
  const r = hooks.nextConfig(text, heading, b);
  assert.equal(r.text, text.replace(a, b));
  assert.equal(r.text.split(heading).length, 2, 'never a second table with the same key (a TOML duplicate)');
  // Our table as the last one, and followed directly by another table, are both our form too.
  assert.equal(hooks.nextConfig(`${heading}\n${a}`, heading, b).text, `${heading}\n${b}`);
  assert.equal(hooks.nextConfig(`${heading}\n${a}\n[tui]\n`, heading, b).text, `${heading}\n${b}\n[tui]\n`);
});

test('nextConfig leaves a hand-edited record alone (enabled = false, a duplicate, a missing hash)', () => {
  const heading = hooks.stateHeading('/h/hooks.json');
  const a = `trusted_hash = "sha256:${'a'.repeat(64)}"`;
  const b = `trusted_hash = "sha256:${'b'.repeat(64)}"`;
  assert.deepEqual(hooks.nextConfig(`${heading}\n${a}\nenabled = false\n`, heading, b), { handEdited: true });
  assert.deepEqual(hooks.nextConfig(`${heading}\nenabled = false\n`, heading, b), { handEdited: true });
  assert.deepEqual(hooks.nextConfig(`${heading}\n${a}\n${heading}\n${a}\n`, heading, b), { handEdited: true });
  // Review 1: the same key written any other way is not appended beside (a duplicate key and Codex would not start).
  assert.deepEqual(hooks.nextConfig(`${heading} # mine\n${a}\n`, heading, b), { handEdited: true });
  assert.deepEqual(hooks.nextConfig(`[hooks.state]\n"/h/hooks.json:pre_tool_use:0:0" = { trusted_hash = "x" }\n`, heading, b), { handEdited: true });
});

test('stateHeading refuses a path a TOML basic string would need escapes for', () => {
  assert.equal(hooks.stateHeading('/h/hooks.json'), '[hooks.state."/h/hooks.json:pre_tool_use:0:0"]');
  assert.equal(hooks.stateHeading('/h"q/hooks.json'), null);
  assert.equal(hooks.stateHeading('/h\\q/hooks.json'), null);
  assert.equal(hooks.stateHeading('/h\nq/hooks.json'), null);
});

test('install writes hooks.json and the trust record (0600), is a no-op the second time, and follows a moved bridge', () => {
  const h = home();
  fs.writeFileSync(path.join(h, 'config.toml'), '[projects."/w"]\ntrust_level = "trusted"\n', { mode: 0o600 });
  assert.deepEqual(hooks.install(h, '/k/bin/codex-report-bridge.js', PINNED_VERSION), { ok: true });
  const cmd = hooks.commandFor('/k/bin/codex-report-bridge.js');
  assert.equal(fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), hooks.hooksJson(cmd));
  const cfg = fs.readFileSync(path.join(h, 'config.toml'), 'utf8');
  assert.equal(cfg, `[projects."/w"]\ntrust_level = "trusted"\n${hooks.stateHeading(path.join(h, 'hooks.json'))}\ntrusted_hash = "${hooks.trustHash(cmd)}"\n`);
  assert.equal(fs.statSync(path.join(h, 'hooks.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(h, 'config.toml')).mode & 0o777, 0o600);

  const inode = fs.statSync(path.join(h, 'config.toml')).ino;
  const hinode = fs.statSync(path.join(h, 'hooks.json')).ino;
  assert.deepEqual(hooks.install(h, '/k/bin/codex-report-bridge.js', PINNED_VERSION), { ok: true });
  assert.equal(fs.statSync(path.join(h, 'config.toml')).ino, inode, 'unchanged config is not rewritten');
  assert.equal(fs.statSync(path.join(h, 'hooks.json')).ino, hinode, 'unchanged hooks.json is not rewritten');

  assert.deepEqual(hooks.install(h, '/k2/bin/codex-report-bridge.js', PINNED_VERSION), { ok: true });
  const cmd2 = hooks.commandFor('/k2/bin/codex-report-bridge.js');
  const cfg2 = fs.readFileSync(path.join(h, 'config.toml'), 'utf8');
  assert.equal(cfg2, cfg.replace(hooks.trustHash(cmd), hooks.trustHash(cmd2)));
  assert.equal(fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), hooks.hooksJson(cmd2));
});

test('install creates config.toml when Codex has not written one yet', () => {
  const h = home();
  assert.deepEqual(hooks.install(h, '/k/b-codex-report-bridge.js', PINNED_VERSION), { ok: true });
  assert.match(fs.readFileSync(path.join(h, 'config.toml'), 'utf8'), /^\[hooks\.state\."[^"]+:pre_tool_use:0:0"\]\ntrusted_hash = "sha256:[0-9a-f]{64}"\n$/);
});

test('install refuses a relative path, a missing home, a home that is a link, and a hand-edited record', () => {
  const h = home();
  assert.equal(hooks.install('rel/home', '/k/b.js', PINNED_VERSION).ok, false);
  assert.equal(hooks.install(h, 'rel/b.js', PINNED_VERSION).ok, false);
  assert.equal(hooks.install(path.join(h, 'missing'), '/k/b.js', PINNED_VERSION).ok, false);
  const link = path.join(home(), 'link');
  fs.symlinkSync(h, link);
  assert.equal(hooks.install(link, '/k/b.js', PINNED_VERSION).ok, false);
  assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false, 'nothing written through the link');
  const heading = hooks.stateHeading(path.join(h, 'hooks.json'));
  const mine = `${heading}\ntrusted_hash = "sha256:${'a'.repeat(64)}"\nenabled = false\n`;
  fs.writeFileSync(path.join(h, 'config.toml'), mine);
  fs.writeFileSync(path.join(h, 'hooks.json'), hooks.hooksJson(hooks.commandFor('/k/b-codex-report-bridge.js')));
  const r = hooks.install(h, '/k/b-codex-report-bridge.js', PINNED_VERSION);
  assert.equal(r.ok, false);
  assert.match(r.because, /by hand/);
  assert.equal(fs.readFileSync(path.join(h, 'config.toml'), 'utf8'), mine);
  assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false, 'review 1: no hooks.json left whose record we cannot vouch for');
});

test('review 1: any Codex but the pinned version gets no hook, and an earlier hooks.json of ours is removed', () => {
  const h = home();
  assert.deepEqual(hooks.install(h, '/k/codex-report-bridge.js', PINNED_VERSION), { ok: true });
  assert.ok(fs.existsSync(path.join(h, 'hooks.json')));
  for (const v of ['0.150.0', '', undefined, `${PINNED_VERSION} `]) {
    const r = hooks.install(h, '/k/codex-report-bridge.js', v);
    assert.equal(r.ok, false, String(v));
    assert.match(r.because, new RegExp(`known only for ${PINNED_VERSION.replace(/\./g, '\\.')}`));
    assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false);
  }
});

test('review 1: the trust record lands before hooks.json; a failed record write leaves no hooks.json', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'config.toml'));   // a folder where the config should be: the record cannot be written
  const r = hooks.install(h, '/k/codex-report-bridge.js', PINNED_VERSION);
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false);
});

test('removeOurs leaves a hooks.json that is not ours, and a link', () => {
  const h = home();
  fs.writeFileSync(path.join(h, 'hooks.json'), '{"hooks":{}}');
  assert.equal(hooks.removeOurs(h), false);
  assert.ok(fs.existsSync(path.join(h, 'hooks.json')));
  const other = path.join(home(), 'x-codex-report-bridge.js.json');
  fs.writeFileSync(other, 'codex-report-bridge.js');
  fs.rmSync(path.join(h, 'hooks.json'));
  fs.symlinkSync(other, path.join(h, 'hooks.json'));
  assert.equal(hooks.removeOurs(h), false);
  assert.ok(fs.existsSync(other));
});

test('the bridge reads the files a patch names, once each, in order', () => {
  const patch = '*** Begin Patch\n*** Add File: a.txt\n+x\n*** Update File: dir/b.txt\n*** Move to: dir/c.txt\n@@\n-1\n+2\n'
    + '*** Delete File: /abs/d.txt\n*** Update File: a.txt\n*** End Patch\n';
  assert.deepEqual(bridge.patchPaths(patch), ['a.txt', 'dir/b.txt', 'dir/c.txt', '/abs/d.txt']);
  assert.deepEqual(bridge.patchPaths('*** Add File: a\u0007b\n'), [], 'a control character in a path names a different file');
  assert.deepEqual(bridge.patchPaths('*** Add File: crlf.txt\r\n'), ['crlf.txt']);
  assert.deepEqual(bridge.patchPaths('+*** Add File: inside-content.txt\n'), [], 'a line of file content is not a heading');
  assert.deepEqual(bridge.patchPaths(undefined), []);
});

test('the bridge makes one keep per file for a PreToolUse apply_patch, and none for anything else', () => {
  const ev = (o) => ({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd: '/w/agent', session_id: 's1',
    tool_input: { command: '*** Begin Patch\n*** Add File: a.txt\n*** Update File: /abs/b.txt\n*** End Patch\n' }, ...o });
  assert.deepEqual(bridge.keepRequestsFor(ev({})), [
    { path: '/w/agent/a.txt', cwd: '/w/agent', session: 's1' },
    { path: '/abs/b.txt', cwd: '/w/agent', session: 's1' },
  ]);
  assert.deepEqual(bridge.keepRequestsFor(ev({ hook_event_name: 'PostToolUse' })), []);
  assert.deepEqual(bridge.keepRequestsFor(ev({ tool_name: 'exec_command' })), []);
  assert.deepEqual(bridge.keepRequestsFor(ev({ cwd: '' })), [{ path: '/abs/b.txt', cwd: '', session: 's1' }], 'a relative path needs a folder');
  assert.deepEqual(bridge.keepRequestsFor(ev({ cwd: '/w/a\u0000b' })), []);
  assert.deepEqual(bridge.keepRequestsFor(ev({ tool_input: 'not an object' })), []);
  assert.deepEqual(bridge.keepRequestsFor(null), []);
  const many = Array.from({ length: 30 }, (_, i) => `*** Add File: f${i}.txt`).join('\n');
  assert.equal(bridge.keepRequestsFor(ev({ tool_input: { command: many } })).length, bridge.KEEP_MAX);
});

test('hookMain posts each keep to the board and never throws on a board that is down', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, body: JSON.parse(init.body), method: init.method }); return { ok: true }; };
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd: '/w', session_id: 's',
    tool_input: { command: '*** Add File: a\n*** Add File: b\n' } });
  await bridge.hookMain({ input, env: { KOSMOS_PORT: '5555' }, headers: {}, fetchImpl });
  assert.deepEqual(seen.map((x) => [x.method, x.url, x.body.path]).sort(), [
    ['POST', 'http://127.0.0.1:5555/api/undo/keep', '/w/a'], ['POST', 'http://127.0.0.1:5555/api/undo/keep', '/w/b']]);
  await bridge.hookMain({ input, env: {}, headers: {}, fetchImpl: async () => { throw new Error('down'); } });
  await bridge.hookMain({ input: 'not json', env: {}, headers: {}, fetchImpl: () => assert.fail('nothing to send') });
});

/* A stub board that records keep calls. */
function stubBoard() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (req.url === '/api/undo/keep') { try { seen.push(JSON.parse(b)); } catch { seen.push(null); } }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"kept":false,"because":"off"}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

test('run as Codex runs it (stdin, no argument), the bridge posts the keeps and prints nothing', async () => {
  const board = await stubBoard();
  try {
    const event = { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd: '/w', session_id: 's',
      tool_input: { command: '*** Add File: one.txt\n' } };
    const out = await new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [BRIDGE], {
        env: { ...process.env, KOSMOS_PORT: String(board.port), TMUX_PANE: '' }, timeout: 15000,
      }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
      child.stdin.end(JSON.stringify(event));
    });
    assert.equal(out, '', 'Codex runs the tool when the hook says nothing');
    assert.deepEqual(board.seen, [{ path: '/w/one.txt', cwd: '/w', session: 's' }]);
  } finally { board.server.close(); }
});

test('review 1: a stdin that is never closed still ends the hook (after the 2 s read bound), with the keep sent', async () => {
  const board = await stubBoard();
  try {
    const event = { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd: '/w', session_id: 's',
      tool_input: { command: '*** Add File: open.txt\n' } };
    const started = Date.now();
    const r = await new Promise((resolve) => {
      const child = execFile(process.execPath, [BRIDGE], {
        env: { ...process.env, KOSMOS_PORT: String(board.port), TMUX_PANE: '' }, timeout: 9000,
      }, (err) => resolve({ err, killed: child.killed || child.signalCode !== null }));
      child.stdin.write(JSON.stringify(event));   // and never end()
    });
    assert.equal(r.killed, false, 'the hook exited on its own, not on the test timeout');
    assert.equal(r.err, null);
    assert.ok(Date.now() - started < 8000);
    assert.deepEqual(board.seen, [{ path: '/w/open.txt', cwd: '/w', session: 's' }]);
  } finally { board.server.close(); }
});

/* ---- the real Codex: only Codex can say whether the trust record counts ---- */
const PINNED = (() => {
  try { return /codex-([0-9]+\.[0-9]+\.[0-9]+)-darwin-arm64\.tgz/.exec(fs.readFileSync(path.join(__dirname, 'runners.js'), 'utf8'))[1]; }
  catch { return null; }
})();
const realCodex = (() => {
  if (process.platform === 'win32') return null;
  try {
    const v = execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return PINNED && v === `codex-cli ${PINNED}` ? v : null;
  } catch { return null; }
})();

/* A fake OpenAI Responses server: the first turn answers with an apply_patch call, every later one with a message. */
function fakeModel(patch) {
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(b); } catch { body = {}; }
      const after = JSON.stringify(body.input || []).includes('_call_output');
      const item = after
        ? { type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'done', annotations: [] }] }
        : { type: 'custom_tool_call', id: 'c', call_id: 'call_1', name: 'apply_patch', input: patch, status: 'completed' };
      const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
      const events = [
        { type: 'response.created', response: { id: 'r', object: 'response', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'r', object: 'response', status: 'completed', output: [item], usage } },
      ];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/* stdin is closed at once: `codex exec` reads more prompt from an open stdin and would wait there until the timeout
   (measured: it then exits 0 on the kill, so a timed-out run reads as a clean one; hence `killed` is returned too). */
function runCodex(codexHome, workdir, modelPort, env) {
  return new Promise((resolve) => {
    const child = execFile('codex', ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', workdir,
      '-c', 'model_provider=fake', '-c', 'model_providers.fake.name="fake"',
      '-c', `model_providers.fake.base_url="http://127.0.0.1:${modelPort}/v1"`,
      '-c', 'model_providers.fake.wire_api="responses"', '-c', 'model_providers.fake.env_key="FAKE_KEY"',
      '-m', 'gpt-5.5', 'edit the files'],
    { env: { ...process.env, ...env, CODEX_HOME: codexHome, FAKE_KEY: 'x' }, timeout: 120000 },
    (err, stdout, stderr) => resolve({ err, stdout, stderr, killed: child.killed || child.signalCode !== null }));
    child.stdin.end();
  });
}

test(`the REAL Codex (${PINNED || 'pin unreadable'}) runs the installed hook, and the bridge reaches the board`, { skip: realCodex ? false : `needs codex-cli ${PINNED} on PATH (this computer: ${(() => { try { return execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'none'; } })()})` }, async () => {
  const h = home();
  const work = home();
  fs.writeFileSync(path.join(work, 'existing.txt'), 'old line\n');
  const board = await stubBoard();
  const model = await fakeModel('*** Begin Patch\n*** Add File: hello.txt\n+hi\n*** Update File: existing.txt\n@@\n-old line\n+new line\n*** End Patch\n');
  try {
    assert.deepEqual(hooks.install(h, BRIDGE, PINNED_VERSION), { ok: true });
    const r = await runCodex(h, work, model.port, { KOSMOS_PORT: String(board.port), TMUX_PANE: '' });
    assert.equal(r.err, null, `codex exec failed: ${r.stderr}`);
    assert.equal(r.killed, false, 'codex exec finished on its own, not on the timeout');
    assert.equal(fs.readFileSync(path.join(work, 'existing.txt'), 'utf8'), 'new line\n', 'the patch ran');
    const wd = fs.realpathSync.native(work);
    assert.deepEqual(board.seen.map((x) => x && x.path).sort(), [path.join(wd, 'existing.txt'), path.join(wd, 'hello.txt')].sort());

    // Control: the same install with one hex digit of the trust record changed. `codex exec` then runs NO hook (the TUI
    // would stop on its review screen instead, measured by hand: card #5812), which proves the record is what made it
    // run above. features.hooks is not passed: hooks are on by default in this Codex.
    board.seen.length = 0;
    fs.writeFileSync(path.join(work, 'existing.txt'), 'old line\n');
    fs.rmSync(path.join(work, 'hello.txt'), { force: true });
    const cfg = path.join(h, 'config.toml');
    const text = fs.readFileSync(cfg, 'utf8');
    const broken = text.replace(/(trusted_hash = "sha256:[0-9a-f]{63})([0-9a-f])"/, (_, a, d) => `${a}${d === '0' ? '1' : '0'}"`);
    assert.notEqual(broken, text);
    fs.writeFileSync(cfg, broken);
    const r2 = await runCodex(h, work, model.port, { KOSMOS_PORT: String(board.port), TMUX_PANE: '' });
    assert.equal(r2.err, null, `codex exec failed: ${r2.stderr}`);
    assert.equal(r2.killed, false, 'codex exec finished on its own, not on the timeout');
    assert.equal(fs.readFileSync(path.join(work, 'existing.txt'), 'utf8'), 'new line\n', 'the patch still ran');
    assert.deepEqual(board.seen, [], 'an untrusted hook does not run');
  } finally { board.server.close(); model.server.close(); }
});
