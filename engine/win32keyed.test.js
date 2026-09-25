'use strict';
/**
 * Gemini and Grok agents on Windows: one headless turn per message, driven by the same
 * per-turn supervisor as codex (engine/win32keyed.js + win32codexsup). Every arm runs on
 * any platform: the spawn, the account modules and the key door are all seams, so nothing
 * here starts a real CLI or reads a real key.
 *
 *   node --test engine/win32keyed.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const keyed = require('./win32keyed');
const { superviseCodexStreaming } = require('./win32codexsup');
const codexlive = require('./win32codexlive');
const win32launch = require('./win32launch');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-win32keyed-'));
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); keyed.setSpawn(null); });

/* ---- the argv ----------------------------------------------------------- */

test('gemini turn argv: the Mac autonomy flags, JSON out, the default model, and a pinned new session', () => {
  const a = keyed.turnArgs('gemini', { message: 'hello', newSessionId: 'aaaa' });
  assert.deepEqual(a, ['--prompt=hello', '-o', 'json', '--approval-mode', 'yolo', '--skip-trust', '-m', 'gemini-2.5-flash', '--session-id', 'aaaa']);
  const b = keyed.turnArgs('gemini', { message: 'again', model: 'gemini-2.5-pro', sessionId: 'aaaa' });
  assert.deepEqual(b.slice(-4), ['-m', 'gemini-2.5-pro', '--resume', 'aaaa'], 'a later turn RESUMES, with the recorded model');
  assert.ok(!b.includes('--session-id'), '--session-id and --resume are never both given');
});

test('grok turn argv: the Mac autonomy flags, JSON out, the default model, and a pinned new session', () => {
  const a = keyed.turnArgs('grok', { message: 'hello', newSessionId: 'bbbb' });
  assert.deepEqual(a, ['--single=hello', '--output-format', 'json', '--permission-mode', 'bypassPermissions',
    '--always-approve', '--trust', '-m', 'grok-4.6', '--session-id', 'bbbb']);
  assert.deepEqual(keyed.turnArgs('grok', { message: 'x', sessionId: 'bbbb' }).slice(-2), ['--resume', 'bbbb']);
});

test('a message that starts with a dash, or carries quotes and shell characters, stays ONE argv element', () => {
  const msg = '-rf "quoted" & | ^ %PATH% $(x)\nsecond line';
  for (const r of ['gemini', 'grok']) {
    const a = keyed.turnArgs(r, { message: msg, newSessionId: 'c' });
    assert.equal(a[0], (r === 'gemini' ? '--prompt=' : '--single=') + msg, r + ': the message is glued to its flag, never read as a flag');
  }
  assert.throws(() => keyed.turnArgs('codex', { message: 'x' }), /not a keyed runner/);
});

/* ---- the parse ---------------------------------------------------------- */

test('parseTurn gemini: the pretty-printed object, its response and its session id; an error object is an error', () => {
  const ok = '{\n  "session_id": "s-1",\n  "response": "done, replied on the board",\n  "stats": {}\n}\n';
  assert.deepEqual(keyed.parseTurn('gemini', ok), { response: 'done, replied on the board', sessionId: 's-1', error: null });
  // Measured on the box with no key: exit 41 and this object.
  const noKey = 'YOLO mode is enabled.\n{\n  "session_id": "s-2",\n  "error": {\n    "type": "Error",\n    "message": "Please set an Auth method",\n    "code": 41\n  }\n}\n';
  const r = keyed.parseTurn('gemini', noKey);
  assert.equal(r.sessionId, 's-2');
  assert.equal(r.error, 'Please set an Auth method');
  assert.deepEqual(keyed.parseTurn('gemini', 'not json at all'), { response: '', sessionId: null, error: null });
  // Measured on the box with a key Google refuses: the object arrives on STDERR, after a stack
  // trace and with more lines after it; nested braces are indented, the object's own are not.
  const refused = 'Error when talking to Gemini API\n    at throwErrorIfNotOK (file:///x.js:1:1)\n{\n  "session_id": "s-3",\n  "error": {\n    "type": "Error",\n    "message": "API key not valid.",\n    "code": 400\n  }\n}\ntrailing noise\n';
  assert.deepEqual(keyed.parseTurn('gemini', '\n' + refused), { response: '', sessionId: 's-3', error: 'API key not valid.' });
});

test('parseTurn grok: the object a real turn prints (measured with a real key, 2026-09-25)', () => {
  const real = '{\n  "text": "noted",\n  "stopReason": "end_turn",\n  "sessionId": "22222222-3333-4444-8555-666666666666",\n'
    + '  "requestId": "r-1",\n  "usage": {\n    "input_tokens": 14747,\n    "output_tokens": 29\n  },\n  "num_turns": 1,\n'
    + '  "modelUsage": {\n    "grok-4.6": {\n      "inputTokens": 14747\n    }\n  }\n}\n';
  assert.deepEqual(keyed.parseTurn('grok', real), { response: 'noted', sessionId: '22222222-3333-4444-8555-666666666666', error: null });
});

test('parseTurn grok: the result line (claude-shaped), and an error line', () => {
  const ok = '{"type":"result","subtype":"success","is_error":false,"result":"hi there","session_id":"g-1"}\n';
  assert.deepEqual(keyed.parseTurn('grok', ok), { response: 'hi there', sessionId: 'g-1', error: null });
  // Measured on the box with no key.
  const noKey = '{"type":"error","message":"Not signed in. To authenticate without a browser, run: grok login --device-code"}\n';
  assert.match(keyed.parseTurn('grok', noKey).error, /Not signed in/);
  const failed = '{"type":"result","is_error":true,"result":"rate limited","session_id":"g-2"}\n';
  assert.equal(keyed.parseTurn('grok', failed).error, 'rate limited');
});

/* ---- one turn, through a fake spawn -------------------------------------- */

function fakeChild(stdout, code, stderr) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}

test('runKeyedTurn: spawns grok.exe directly with no shell, the given env, and returns the id to resume', async () => {
  const calls = [];
  keyed.setSpawn((file, args, opts) => {
    calls.push({ file, args, opts });
    return fakeChild('{"type":"result","is_error":false,"result":"ok","session_id":"' + args[args.length - 1] + '"}\n', 0);
  });
  const env = { XAI_API_KEY: 'k' };
  const r = await keyed.runKeyedTurn({ runner: 'grok', bin: 'C:\\r\\grok\\pkg\\bin\\grok.exe', message: 'hi', cwd: 'C:\\w', env, newSessionId: 'new-1', platform: 'win32' });
  assert.equal(r.ok, true);
  assert.equal(r.sessionId, 'new-1', 'the next turn resumes the session this one made');
  assert.equal(calls[0].file, 'C:\\r\\grok\\pkg\\bin\\grok.exe');
  assert.equal(calls[0].opts.env, env);
  assert.equal(calls[0].opts.shell, undefined, 'no shell anywhere');
  assert.deepEqual(calls[0].opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(calls[0].opts.windowsHide, true);
  keyed.setSpawn(null);
});

test('runKeyedTurn: Gemini runs as node on its bundle, never through its .cmd launcher', async () => {
  const runners = require('./runners');
  const dir = path.join(SANDBOX, 'gem');
  fs.mkdirSync(dir, { recursive: true });
  const cmd = path.join(dir, 'gemini.cmd');
  fs.writeFileSync(cmd, runners.winNodeLauncher(process.execPath, 'bundle/gemini.js'));
  const calls = [];
  keyed.setSpawn((file, args) => { calls.push({ file, args }); return fakeChild('{\n "session_id": "x",\n "response": "fine"\n}\n', 0); });
  const r = await keyed.runKeyedTurn({ runner: 'gemini', bin: cmd, message: 'hi', platform: 'win32', newSessionId: 'x' });
  assert.equal(r.ok, true);
  assert.equal(calls[0].file, process.execPath);
  assert.equal(calls[0].args[0], path.win32.join(dir, 'pkg', 'bundle', 'gemini.js'));
  assert.equal(calls[0].args[1], '--prompt=hi');
  keyed.setSpawn(null);
});

test('runKeyedTurn: a failed FIRST turn keeps no id; a failed resume keeps it unless the CLI says it is gone', async () => {
  keyed.setSpawn(() => fakeChild('{"type":"error","message":"Not signed in."}\n', 1));
  const first = await keyed.runKeyedTurn({ runner: 'grok', bin: 'grok.exe', message: 'hi', newSessionId: 'n' });
  assert.equal(first.ok, false);
  assert.equal(first.sessionId, null);
  assert.equal(first.resetSession, true, 'a half-made session is never resumed');
  assert.match(first.error, /exit 1; Not signed in/);

  keyed.setSpawn(() => fakeChild('{"type":"error","message":"network is unreachable"}\n', 1));
  const blip = await keyed.runKeyedTurn({ runner: 'grok', bin: 'grok.exe', message: 'hi', sessionId: 'keep-me' });
  assert.equal(blip.sessionId, 'keep-me', 'a transient failure keeps the conversation');
  assert.equal(blip.resetSession, false);

  // Measured on the box: gemini exits 42 with this on stderr for a resume it cannot find.
  keyed.setSpawn(() => fakeChild('', 42, 'Error resuming session: No previous sessions found for this project.\n'));
  const gone = await keyed.runKeyedTurn({ runner: 'gemini', bin: 'gemini.cmd', message: 'hi', sessionId: 'lost' });
  assert.equal(gone.sessionId, null);
  assert.equal(gone.resetSession, true, 'a conversation the CLI cannot find starts fresh next turn');
  keyed.setSpawn(null);
});

test('runKeyedTurn: a spawn that throws resolves with a reason, never rejects', async () => {
  keyed.setSpawn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
  const r = await keyed.runKeyedTurn({ runner: 'gemini', bin: 'C:\\missing\\gemini.cmd', message: 'hi' });
  assert.equal(r.ok, false);
  assert.match(r.error, /^spawn: ENOENT/);
  keyed.setSpawn(null);
});

/* ---- the environment ----------------------------------------------------- */

function fakeAccounts(root, kindByDir) {
  return {
    defaultDir: () => path.join(root, 'default'),
    keyFile: (dir) => path.join(dir, '.key'),
    identityOf: (dir) => (kindByDir[dir] ? { authMode: kindByDir[dir] } : null),
  };
}

test('turnEnv gemini: the account key file first, then the machine door; CLAUDE_CONFIG_DIR is dropped', () => {
  const root = path.join(SANDBOX, 'genv');
  const acct = path.join(root, 'work1');
  const door = path.join(root, 'door');
  fs.mkdirSync(acct, { recursive: true });
  fs.mkdirSync(door, { recursive: true });
  fs.writeFileSync(path.join(acct, '.key'), 'ACCOUNT-KEY\n');
  fs.writeFileSync(path.join(door, 'GEMINI_API_KEY'), 'DOOR-KEY\n');
  const mod = fakeAccounts(root, {});
  const base = { CLAUDE_CONFIG_DIR: acct, GEMINI_CLI_HOME: acct, KOSMOS_AGENT_TOKEN: 't' };
  const named = keyed.turnEnv('gemini', base, acct, { geminiAccounts: mod, doorDir: door });
  assert.equal(named.GEMINI_API_KEY, 'ACCOUNT-KEY');
  assert.equal('CLAUDE_CONFIG_DIR' in named, false);
  assert.equal(named.GEMINI_CLI_HOME, acct, 'the account home stays');
  assert.equal(named.KOSMOS_AGENT_TOKEN, 't');
  assert.equal(base.GEMINI_API_KEY, undefined, 'the input is not mutated');
  // The default account with no key file of its own: the door.
  assert.equal(keyed.turnEnv('gemini', {}, null, { geminiAccounts: mod, doorDir: door }).GEMINI_API_KEY, 'DOOR-KEY');
  // Neither: whatever the environment already had is left alone.
  assert.equal(keyed.turnEnv('gemini', { GEMINI_API_KEY: 'AMBIENT' }, null, { geminiAccounts: mod, doorDir: null }).GEMINI_API_KEY, 'AMBIENT');
});

test('turnEnv grok: GROK_HOME always named, claude hooks off, a key account gets XAI_API_KEY, a SUBSCRIPTION gets none', () => {
  const root = path.join(SANDBOX, 'xenv');
  const keyAcct = path.join(root, 'key1');
  const subAcct = path.join(root, 'sub1');
  fs.mkdirSync(keyAcct, { recursive: true });
  fs.mkdirSync(subAcct, { recursive: true });
  fs.writeFileSync(path.join(keyAcct, '.key'), 'XAI-ACCOUNT\n');
  const mod = fakeAccounts(root, { [keyAcct]: 'apikey', [subAcct]: 'subscription' });
  const k = keyed.turnEnv('grok', { XAI_API_KEY: 'AMBIENT' }, keyAcct, { grokAccounts: mod, doorDir: null });
  assert.equal(k.XAI_API_KEY, 'XAI-ACCOUNT');
  assert.equal(k.GROK_HOME, keyAcct);
  assert.equal(k.GROK_CLAUDE_HOOKS_ENABLED, '0');
  const s = keyed.turnEnv('grok', { XAI_API_KEY: 'AMBIENT' }, subAcct, { grokAccounts: mod, doorDir: null });
  assert.equal('XAI_API_KEY' in s, false, 'removed, not blanked: an empty value still counts to grok');
  assert.equal(s.GROK_HOME, subAcct);
  const d = keyed.turnEnv('grok', {}, null, { grokAccounts: mod, doorDir: null });
  assert.equal(d.GROK_HOME, path.join(root, 'default'), 'the default account is exported as GROK_HOME, as on the Mac');
});

test('childEnv lets a gemini or grok agent load the kosmos.ps1 shim, as it does codex', () => {
  for (const r of ['gemini', 'grok']) {
    assert.equal(win32launch.childEnv({}, 't', null, null, r).PSExecutionPolicyPreference, 'Bypass', r);
  }
  assert.equal('PSExecutionPolicyPreference' in win32launch.childEnv({}, 't', null, null, 'claude'), false, 'claude unchanged');
});

test('binFor falls back to the runner\'s own bare name, never claude, for gemini and grok', () => {
  assert.equal(win32launch.binFor({ runner: 'gemini' }), 'gemini');
  assert.equal(win32launch.binFor({ runner: 'grok' }), 'grok');
  assert.equal(win32launch.binFor({ runner: 'codex' }), 'codex');
  assert.equal(win32launch.binFor({}), 'claude');
});

/* ---- the supervisor ------------------------------------------------------ */

function fakeStream() {
  const calls = [];
  return {
    calls,
    started(pid, sessionId) { calls.push(['started', pid, sessionId]); },
    event(e) { calls.push(['event', e && e.type]); },
    wrote() { calls.push(['wrote']); },
    stopped() { calls.push(['stopped']); },
    rekey() {},
  };
}
function supOpts(over) {
  return Object.assign({
    stream: fakeStream(),
    retireRun: () => ({ ok: true }),
    sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
    supervisorPid: 4242,
    env: { GEMINI_API_KEY: 'k' },
    onEvent: () => {},
  }, over || {});
}
const settle = () => new Promise((r) => setImmediate(r));

test('the per-turn supervisor records a gemini agent AS gemini and hands every turn to the gemini runner', async () => {
  let preparedAs = null;
  const seen = [];
  keyed.setSpawn((file, args) => { seen.push(args); return fakeChild('{\n "session_id": "' + args[args.length - 1] + '",\n "response": "ok"\n}\n', 0); });
  const h = superviseCodexStreaming({ name: 'gem', cwd: 'C:\\w', runner: 'gemini', claudeBin: 'C:\\r\\gemini\\gemini.cmd' }, supOpts({
    bin: 'C:\\r\\gemini\\gemini.cmd',
    prepare: (meta) => { preparedAs = meta; return { ok: true, sessionId: 'kosmos-1', name: 'gem', token: 't', instance: 'i' }; },
  }));
  assert.deepEqual(preparedAs, { name: 'gem', runner: 'gemini' }, 'the ownership record says gemini, so the card and liveness say gemini');
  await new Promise((res) => h.send('first', res));
  for (let i = 0; i < 5; i++) await settle();
  await new Promise((res) => h.send('second', res));
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(seen.length, 2);
  assert.ok(seen[0].includes('--prompt=first') && seen[0].includes('--session-id'), 'the first turn names a new session');
  const firstId = seen[0][seen[0].indexOf('--session-id') + 1];
  assert.deepEqual(seen[1].slice(-2), ['--resume', firstId], 'the second RESUMES it');
  h.stop();
  keyed.setSpawn(null);
});

test('the per-turn supervisor starts fresh after a gemini/grok turn that could not keep its conversation', async () => {
  const sessions = [];
  let n = 0;
  const runTurn = async (o) => {
    sessions.push(o.sessionId || null);
    n += 1;
    if (n === 1) return { ok: true, sessionId: 'conv-1' };
    if (n === 2) return { ok: false, sessionId: null, resetSession: true, error: 'gone' };
    return { ok: true, sessionId: 'conv-2' };
  };
  const h = superviseCodexStreaming({ name: 'grk', cwd: 'C:\\w', runner: 'grok' }, supOpts({
    runTurn, prepare: () => ({ ok: true, sessionId: 'kosmos-2', name: 'grk', token: 't', instance: 'i' }),
  }));
  for (const m of ['a', 'b', 'c']) { await new Promise((res) => h.send(m, res)); for (let i = 0; i < 4; i++) await settle(); }
  assert.deepEqual(sessions, [null, 'conv-1', null]);
  h.stop();
});

test('a codex spec still takes the codex turn and records codex (unchanged)', () => {
  let preparedAs = null;
  const h = superviseCodexStreaming({ name: 'cdx', cwd: 'C:\\w' }, supOpts({
    runTurn: async () => ({ ok: true }),
    prepare: (meta) => { preparedAs = meta; return { ok: true, sessionId: 'k3', name: 'cdx', token: 't', instance: 'i' }; },
  }));
  assert.deepEqual(preparedAs, { name: 'cdx', runner: 'codex' });
  h.stop();
});

/* ---- liveness ------------------------------------------------------------ */

test('a gemini or grok agent whose supervisor is up is live, with its OWN runner on the row', () => {
  const G = '55555555-5555-4555-8555-555555555555';
  const X = '66666666-6666-4666-8666-666666666666';
  const C = '77777777-7777-4777-8777-777777777777';
  const rows = codexlive.liveSessions({
    record: { read: () => ({ [G]: { name: 'gem', runner: 'gemini' }, [X]: { name: 'grk', runner: 'grok' }, [C]: { name: 'cl', runner: 'claude' } }) },
    identity: (name) => ({ gem: { pid: 10, sessionId: G }, grk: { pid: 11, sessionId: X }, cl: { pid: 12, sessionId: C } })[name] || null,
    pidAlive: () => true,
  });
  assert.deepEqual(rows.map((r) => [r.name, r.runner]).sort(), [['gem', 'gemini'], ['grk', 'grok']], 'claude rows still come only from claude agents --json');
});
