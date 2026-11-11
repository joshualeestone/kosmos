'use strict';

/* kosmos#8348: the Codex edit hook on Windows. engine/codexhooks.js writes the win32 form (PowerShell's call operator,
   a TOML literal-string trust key, never over a person's own hooks.json), bin/codex-report-bridge.js resolves a
   Windows cwd with Windows rules, and engine/win32codexsup.js installs the hook into a NAMED Codex home at start.
   The pure arms run on any host (platform and node are injected). The last test drives the REAL Codex for Windows,
   the pinned build, against a local fake model server and a stub board; it runs only on win32 with that Codex found
   (KOSMOS_TEST_CODEX_BIN, or codex on PATH). What it proves was measured by hand first: work notes on card #8348. */

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { answerProof, boardTokens } = require('../test-support/boardproof-stub');
const { execFile, execFileSync } = require('node:child_process');
const stray = require('../test-support/stray-processes');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-codexhooks-8348-data-'));
const hooks = require('./codexhooks');
const BRIDGE = path.join(__dirname, '..', 'bin', 'codex-report-bridge.js');
const bridge = require(BRIDGE);
const { superviseCodexStreaming, installCodexHookFor, codexVersionOf } = require('./win32codexsup');

const home = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-codexhooks-8348-')));
const W = { platform: 'win32', node: 'C:\\Program Files\\Kosmos\\runtime\\node.exe' };
const WBRIDGE = 'C:\\Users\\a b\\AppData\\Local\\Programs\\Kosmos\\app\\bin\\codex-report-bridge.js';
const V = hooks.HASH_VERIFIED_FOR;

test('the win32 command is the call operator on two single-quoted literals; the posix form is unchanged', () => {
  assert.equal(hooks.commandFor(WBRIDGE, W), `& '${W.node}' '${WBRIDGE}'`);
  assert.equal(hooks.commandFor('/k/bin/codex-report-bridge.js', { platform: 'darwin' }), "'/k/bin/codex-report-bridge.js'");
});

test('the win32 trust key is a TOML literal string holding the backslashes as they are', () => {
  assert.equal(hooks.stateHeading('C:\\Users\\a b\\.codex-work1\\hooks.json', 'win32'),
    "[hooks.state.'C:\\Users\\a b\\.codex-work1\\hooks.json:pre_tool_use:0:0']");
  assert.equal(hooks.stateHeading("C:\\Users\\o'neil\\hooks.json", 'win32'), null, 'a literal string cannot hold a quote');
  assert.equal(hooks.stateHeading('C:\\x\ny\\hooks.json', 'win32'), null);
  assert.equal(hooks.stateHeading('/Users/a/h/hooks.json', 'darwin'), '[hooks.state."/Users/a/h/hooks.json:pre_tool_use:0:0"]');
  assert.equal(hooks.stateHeading('C:\\x\\hooks.json', 'darwin'), null, 'posix rules still refuse a backslash');
});

test('nextConfig appends, keeps and replaces under the win32 heading as under the posix one', () => {
  const heading = hooks.stateHeading('C:\\h\\hooks.json', 'win32');
  const line = `trusted_hash = "sha256:${'a'.repeat(64)}"`;
  const add = hooks.nextConfig('model = "x"\n', heading, line);
  assert.equal(add.append, `${heading}\n${line}\n`);
  const text = `model = "x"\n${heading}\n${line}\n`;
  assert.deepEqual(hooks.nextConfig(text, heading, line), { same: true });
  const line2 = `trusted_hash = "sha256:${'b'.repeat(64)}"`;
  assert.equal(hooks.nextConfig(text, heading, line2).text, `model = "x"\n${heading}\n${line2}\n`);
  assert.deepEqual(hooks.nextConfig(`${heading}\nenabled = false\n`, heading, line), { handEdited: true });
});

test('isOurs knows the win32 file and still refuses a lookalike', () => {
  assert.equal(hooks.isOurs(hooks.hooksJson(hooks.commandFor(WBRIDGE, W))), true);
  assert.equal(hooks.isOurs(hooks.hooksJson(`& '${W.node}' 'C:\\other\\thing.js'`)), false);
  assert.equal(hooks.isOurs(hooks.hooksJson(`& '${W.node}' '${WBRIDGE}'; Remove-Item x`)), false);
});

test('install on win32 refuses a path with a quote in it, and writes nothing', () => {
  const h = home();
  assert.equal(hooks.install(h, "C:\\o'neil\\codex-report-bridge.js", V, W).ok, false);
  assert.equal(hooks.install(h, WBRIDGE, V, { platform: 'win32', node: 'C:\\n$x\\node.exe' }).ok, false);
  assert.equal(fs.existsSync(path.join(h, 'hooks.json')), false);
});

test('install on win32 never overwrites a hooks.json that is not ours', () => {
  const h = home();
  const theirs = '{"hooks":{"PreToolUse":[{"matcher":"shell","hooks":[{"type":"command","command":"mine.ps1"}]}]}}\n';
  fs.writeFileSync(path.join(h, 'hooks.json'), theirs);
  const r = hooks.install(h, WBRIDGE, V, W);
  assert.equal(r.ok, false);
  assert.match(r.because, /its own hooks\.json/);
  assert.equal(fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), theirs, 'theirs stays, byte for byte');
  assert.equal(fs.existsSync(path.join(h, 'config.toml')), false, 'and no trust record is written for it');
});

test('install on win32 writes the record first, then our hooks.json, and is idempotent', () => {
  const h = home();
  assert.deepEqual(hooks.install(h, WBRIDGE, V, W), { ok: true });
  const cmd = hooks.commandFor(WBRIDGE, W);
  assert.equal(fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), hooks.hooksJson(cmd));
  const heading = hooks.stateHeading(path.join(fs.realpathSync.native(h), 'hooks.json'), 'win32');
  assert.equal(fs.readFileSync(path.join(h, 'config.toml'), 'utf8'), `${heading}\ntrusted_hash = "${hooks.trustHash(cmd)}"\n`);
  assert.deepEqual(hooks.install(h, WBRIDGE, V, W), { ok: true });
  assert.equal(fs.readFileSync(path.join(h, 'config.toml'), 'utf8').split(heading).length, 2, 'one record, not two');
});

test('a refusal on win32 leaves the shared home as it is, so one agent cannot take the hook from another', () => {
  const h = home();
  assert.deepEqual(hooks.install(h, WBRIDGE, V, W), { ok: true });   // agent A
  const before = { hooks: fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), cfg: fs.readFileSync(path.join(h, 'config.toml'), 'utf8') };
  // agent B on the same account: its version probe failed, another Codex, an unsafe node path
  assert.equal(hooks.install(h, WBRIDGE, null, W).ok, false);
  assert.equal(hooks.install(h, WBRIDGE, '0.150.0', W).ok, false);
  assert.equal(hooks.install(h, WBRIDGE, V, { platform: 'win32', node: "C:\\o'k\\node.exe" }).ok, false);
  assert.equal(fs.readFileSync(path.join(h, 'hooks.json'), 'utf8'), before.hooks, "agent A's hook stays");
  assert.equal(fs.readFileSync(path.join(h, 'config.toml'), 'utf8'), before.cfg, 'and its record');
});

test('the win32 key written as a basic string with doubled backslashes counts as written by hand, not appended beside', () => {
  const h = home();
  const file = path.join(fs.realpathSync.native(h), 'hooks.json');
  const escaped = `[hooks.state."${file.replace(/\\/g, '\\\\')}:pre_tool_use:0:0"]\ntrusted_hash = "sha256:${'c'.repeat(64)}"\n`;
  fs.writeFileSync(path.join(h, 'config.toml'), escaped);
  const r = hooks.install(h, WBRIDGE, V, W);
  assert.equal(r.ok, false);
  assert.match(r.because, /changed by hand/);
  assert.equal(fs.readFileSync(path.join(h, 'config.toml'), 'utf8'), escaped, 'no second table for the same key');
});

test('the bridge resolves a Windows cwd with Windows rules; a posix cwd is unchanged', () => {
  const ev = (cwd, patch) => ({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd, session_id: 's', tool_input: { command: patch } });
  assert.deepEqual(bridge.keepRequestsFor(ev('C:\\w\\p', '*** Add File: a.txt\n*** Update File: sub/b.txt\n*** Delete File: D:\\x\\c.txt\n')).map((k) => k.path),
    ['C:\\w\\p\\a.txt', 'C:\\w\\p\\sub\\b.txt', 'D:\\x\\c.txt']);
  assert.deepEqual(bridge.keepRequestsFor(ev('\\\\srv\\share\\p', '*** Add File: a.txt\n')).map((k) => k.path), ['\\\\srv\\share\\p\\a.txt']);
  assert.deepEqual(bridge.keepRequestsFor(ev('/w', '*** Add File: one.txt\n')), [{ path: '/w/one.txt', cwd: '/w', session: 's' }]);
  assert.deepEqual(bridge.keepRequestsFor(ev('w\\rel', '*** Add File: one.txt\n')), [], 'a relative cwd still gets nothing');
});

/* The supervisor: the hook goes into the named Codex home at start, and only for a codex agent. */
function supOpts(over) {
  return Object.assign({
    stream: { started() {}, event() {}, wrote() {}, stopped() {}, rekey() {} },
    prepare: () => ({ ok: true, sessionId: 'sess-1', name: 'coder', token: 'tok', instance: 'inst', tokenBecause: null, launchArgs: [] }),
    retireRun: () => ({ ok: true }),
    sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
    supervisorPid: 1,
    env: { CODEX_HOME: 'C:\\acct' },
    runTurn: async () => ({ ok: true }),
  }, over || {});
}

test('the supervisor installs the hook into the named home of a codex agent, and says why when it could not', () => {
  const homes = [];
  const events = [];
  superviseCodexStreaming({ name: 'coder', cwd: 'C:/w', runner: 'codex', configDir: 'C:\\Users\\a\\.codex-work1' },
    supOpts({ installCodexHook: (h) => { homes.push(h); return { ok: false, because: 'the reason' }; }, onEvent: (e) => events.push(e) }));
  assert.deepEqual(homes, ['C:\\Users\\a\\.codex-work1']);
  assert.ok(events.some((e) => e.action === 'codex-hook-skipped' && e.because === 'the reason'));
  const none = [];
  superviseCodexStreaming({ name: 'g', cwd: 'C:/w', runner: 'gemini', configDir: 'C:\\g' },
    supOpts({ installCodexHook: (h) => { none.push(h); return { ok: true }; }, onEvent: () => {} }));
  assert.deepEqual(none, [], 'a gemini agent is not given a Codex hook');
});

test('codexVersionOf reads the version from a `codex --version` line, and nothing else', () => {
  assert.equal(codexVersionOf('codex-cli 0.149.1\r\n'), '0.149.1');
  assert.equal(codexVersionOf('codex-cli 0.149.1 extra'), null);
  assert.equal(codexVersionOf('WARNING: something\ncodex-cli 0.149.1'), null);
  assert.equal(codexVersionOf(''), null);
  assert.equal(codexVersionOf(undefined), null);
});

test('installCodexHookFor probes the codex it will run, with the turn env, and hands the version and the shipped bridge to install', () => {
  const calls = [];
  const installs = [];
  const env = { PATH: 'C:\\turn' };
  const r = installCodexHookFor('C:\\Users\\a\\.codex-work1', 'C:\\bin\\codex.exe', env, {
    execFileSync: (bin, args, opts) => { calls.push({ bin, args, env: opts.env, timeout: opts.timeout }); return 'codex-cli 0.149.1\n'; },
    install: (home, bridge, version) => { installs.push({ home, bridge, version }); return { ok: true }; },
  });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, [{ bin: 'C:\\bin\\codex.exe', args: ['--version'], env, timeout: 15000 }]);
  assert.deepEqual(installs, [{ home: 'C:\\Users\\a\\.codex-work1', bridge: path.join(__dirname, '..', 'bin', 'codex-report-bridge.js'), version: '0.149.1' }]);
  assert.ok(fs.existsSync(installs[0].bridge), 'the bridge it names ships beside this engine');
});

test('installCodexHookFor: a failed probe installs with no version (refused there); no home asks nothing', () => {
  const installs = [];
  installCodexHookFor('C:\\h', 'codex', {}, {
    execFileSync: () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); },
    install: (home, bridge, version) => { installs.push(version); return { ok: false, because: 'x' }; },
  });
  assert.deepEqual(installs, [null]);
  let asked = 0;
  const r = installCodexHookFor(null, 'codex', {}, { execFileSync: () => { asked += 1; return ''; }, install: () => { asked += 1; return { ok: true }; } });
  assert.deepEqual(r, { ok: false, because: null });
  assert.equal(asked, 0, 'the default ~/.codex: no probe, no install');
});

/* ---- the real Codex for Windows ---- */
const realCodex = (() => {
  if (process.platform !== 'win32') return null;
  const bin = process.env.KOSMOS_TEST_CODEX_BIN || 'codex';
  try {
    const v = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return v === `codex-cli ${V}` ? bin : null;
  } catch { return null; }
})();

function stubBoard() {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (answerProof(req, res, () => boardTokens(process.env.AGENT_WORKFORCE_DATA, String(process.env.KOSMOS_AGENT_TOKEN || '').trim()))) return;
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

function runCodex(codexHome, workdir, modelPort, env) {
  return new Promise((resolve) => {
    const child = execFile(realCodex, ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', workdir,
      '-c', 'model_provider=fake', '-c', 'model_providers.fake.name="fake"',
      '-c', `model_providers.fake.base_url="http://127.0.0.1:${modelPort}/v1"`,
      '-c', 'model_providers.fake.wire_api="responses"', '-c', 'model_providers.fake.env_key="FAKE_KEY"',
      '-m', 'gpt-5.5', 'edit the files'],
    { env: { ...process.env, ...env, CODEX_HOME: codexHome, FAKE_KEY: 'x' }, timeout: 120000, windowsHide: true },
    (err, stdout, stderr) => {
      const killed = child.killed || child.signalCode !== null;
      stray.killUnderScope();
      resolve({ err, stdout, stderr, killed });
    });
    child.stdin.end();
  });
}

test(`the REAL Codex for Windows (${V}) runs the installed hook, and the bridge reaches the board`, { skip: realCodex ? false : `needs win32 and codex-cli ${V} (KOSMOS_TEST_CODEX_BIN or PATH)` }, async () => {
  const h = home();
  const work = home();
  fs.writeFileSync(path.join(work, 'existing.txt'), 'old line\n');
  const board = await stubBoard();
  const model = await fakeModel('*** Begin Patch\n*** Add File: hello.txt\n+hi\n*** Update File: existing.txt\n@@\n-old line\n+new line\n*** End Patch\n');
  try {
    assert.deepEqual(hooks.install(h, BRIDGE, V), { ok: true });
    const r = await runCodex(h, work, model.port, { KOSMOS_PORT: String(board.port) });
    assert.equal(r.err, null, `codex exec failed: ${r.stderr}`);
    assert.equal(r.killed, false, 'codex exec finished on its own, not on the timeout');
    assert.equal(fs.readFileSync(path.join(work, 'existing.txt'), 'utf8'), 'new line\n', 'the patch ran');
    const wd = fs.realpathSync.native(work);
    assert.deepEqual(board.seen.map((x) => x && x.path).sort(), [path.join(wd, 'existing.txt'), path.join(wd, 'hello.txt')].sort());

    // Control: one hex digit of the trust record changed. `codex exec` then runs no hook, which proves the record is
    // what made it run above.
    board.seen.length = 0;
    fs.writeFileSync(path.join(work, 'existing.txt'), 'old line\n');
    fs.rmSync(path.join(work, 'hello.txt'), { force: true });
    const cfg = path.join(h, 'config.toml');
    const text = fs.readFileSync(cfg, 'utf8');
    const broken = text.replace(/(trusted_hash = "sha256:[0-9a-f]{63})([0-9a-f])"/, (_, a, d) => `${a}${d === '0' ? '1' : '0'}"`);
    assert.notEqual(broken, text);
    fs.writeFileSync(cfg, broken);
    const r2 = await runCodex(h, work, model.port, { KOSMOS_PORT: String(board.port) });
    assert.equal(r2.err, null, `codex exec failed: ${r2.stderr}`);
    assert.equal(fs.readFileSync(path.join(work, 'existing.txt'), 'utf8'), 'new line\n', 'the patch still ran');
    assert.deepEqual(board.seen, [], 'an untrusted hook does not run');

    // The home given in another letter case: Codex canonicalizes it, and the record is keyed on the on-disk spelling.
    board.seen.length = 0;
    fs.writeFileSync(path.join(work, 'existing.txt'), 'old line\n');
    fs.rmSync(path.join(work, 'hello.txt'), { force: true });
    assert.deepEqual(hooks.install(h.toLowerCase(), BRIDGE, V), { ok: true });
    const r3 = await runCodex(h.toLowerCase(), work, model.port, { KOSMOS_PORT: String(board.port) });
    assert.equal(r3.err, null, `codex exec failed: ${r3.stderr}`);
    assert.equal(board.seen.length, 2, 'the hook ran for a home given in another case');
  } finally { board.server.close(); model.server.close(); }
});
