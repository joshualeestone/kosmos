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
  const named = keyed.turnEnv('gemini', base, acct, { geminiAccounts: mod, doorDir: door, keyHome: null });
  assert.equal(named.GEMINI_API_KEY, 'ACCOUNT-KEY');
  assert.equal('CLAUDE_CONFIG_DIR' in named, false);
  assert.equal(named.GEMINI_CLI_HOME, acct, 'the account home stays');
  assert.equal(named.KOSMOS_AGENT_TOKEN, 't');
  assert.equal(base.GEMINI_API_KEY, undefined, 'the input is not mutated');
  // The default account with no key file of its own: the door.
  assert.equal(keyed.turnEnv('gemini', {}, null, { geminiAccounts: mod, doorDir: door, keyHome: null }).GEMINI_API_KEY, 'DOOR-KEY');
  // Neither: whatever the environment already had is left alone.
  assert.equal(keyed.turnEnv('gemini', { GEMINI_API_KEY: 'AMBIENT' }, null, { geminiAccounts: mod, doorDir: null, keyHome: null }).GEMINI_API_KEY, 'AMBIENT');
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

/* #4003: a person's own gemini settings that choose a Google login made every headless turn
   stop at gemini's "[Y/n]" consent prompt forever even with a key (measured). A keyed turn must
   use the key; the person's own file is never edited; an agent with NO key is left alone, so
   the person's own Google login in the gemini CLI still works for it. */
test('#4003 turnEnv gemini: an agent WITH a key never waits on a browser login, and a home that chose Google login is swapped for one that pins the key', () => {
  const root = path.join(SANDBOX, 'gauth');
  const acct = path.join(root, 'default');
  const personal = path.join(root, 'person');       // stands in for the person's home
  fs.mkdirSync(acct, { recursive: true });
  fs.mkdirSync(path.join(personal, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(acct, '.key'), 'ACCOUNT-KEY\n');
  const mod = fakeAccounts(root, {});
  const theirs = path.join(personal, '.gemini', 'settings.json');
  const keyHome = path.join(root, 'kosmos', 'gemini-key-home', 'default');
  // bridge: null keeps this test on the auth pin alone; #4012's test below covers the hooks.
  const deps = { geminiAccounts: mod, doorDir: null, homeDir: personal, keyHome, bridge: null };

  // No settings of their own: their home is used as before, but a login can never be waited on.
  let env = keyed.turnEnv('gemini', {}, null, deps);
  assert.equal(env.NO_BROWSER, 'true', 'a turn that would need a login exits instead of waiting');
  assert.equal('GEMINI_CLI_HOME' in env, false, 'nothing chose a login, so the home is untouched');

  // Their settings already choose the key: still their home.
  fs.writeFileSync(theirs, JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } }));
  assert.equal('GEMINI_CLI_HOME' in keyed.turnEnv('gemini', {}, null, deps), false);

  // Their settings choose Google login: the turn runs in a Kosmos home that pins the key.
  const mine = JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } }, ui: { theme: 'x' } });
  fs.writeFileSync(theirs, mine);
  env = keyed.turnEnv('gemini', {}, null, deps);
  assert.equal(env.GEMINI_CLI_HOME, keyHome);
  assert.equal(env.GEMINI_API_KEY, 'ACCOUNT-KEY');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(keyHome, '.gemini', 'settings.json'), 'utf8')),
    { security: { auth: { selectedType: 'gemini-api-key' } } });
  assert.equal(fs.readFileSync(theirs, 'utf8'), mine, 'the person\'s own settings are never edited');

  // A named account whose home (GEMINI_CLI_HOME) chose a login is swapped the same way.
  const named = path.join(root, '.gemini-work');
  fs.mkdirSync(path.join(named, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(named, '.gemini', 'settings.json'), mine);
  fs.writeFileSync(path.join(named, '.key'), 'WORK-KEY');
  env = keyed.turnEnv('gemini', { GEMINI_CLI_HOME: named }, named, Object.assign({}, deps, { keyHome: path.join(root, 'k2') }));
  assert.equal(env.GEMINI_CLI_HOME, path.join(root, 'k2'));

  // No Kosmos home can be made: the turn keeps the account's home and fails loudly (NO_BROWSER).
  env = keyed.turnEnv('gemini', {}, null, Object.assign({}, deps, { keyHome: path.join(acct, '.key', 'x') }));
  assert.equal('GEMINI_CLI_HOME' in env, false);
  assert.equal(env.NO_BROWSER, 'true');

  // NO key: exactly as before. Their Google login is theirs to use; nothing is swapped or set.
  const bare = fakeAccounts(path.join(root, 'nokey'), {});
  env = keyed.turnEnv('gemini', {}, null, Object.assign({}, deps, { geminiAccounts: bare }));
  assert.equal('GEMINI_API_KEY' in env, false);
  assert.equal('NO_BROWSER' in env, false, 'no key: a browser login is not blocked');
  assert.equal('GEMINI_CLI_HOME' in env, false, 'no key: their own home and login stay');

  // Grok is not gemini.
  assert.equal('NO_BROWSER' in keyed.turnEnv('grok', {}, null, { grokAccounts: fakeAccounts(root, {}), doorDir: null }), false);
});

/* #4012: a keyed turn sent to the Kosmos key home read a settings file that held only the auth
   pin, so the report hooks create.js wrote into the account's own home never fired and the agent
   never reported. The key home now carries the same five hooks, a home pinned before the fix heals
   on the next turn, and the person's own file is still never edited. */
test('#4012 turnEnv gemini: the key home a keyed turn is sent to carries the report hooks, and an older pinned home heals', () => {
  const geminisettings = require('./geminisettings');
  const root = path.join(SANDBOX, 'g4012');
  const acct = path.join(root, 'default');
  const personal = path.join(root, 'person');
  fs.mkdirSync(acct, { recursive: true });
  fs.mkdirSync(path.join(personal, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(acct, '.key'), 'ACCOUNT-KEY\n');
  const theirs = path.join(personal, '.gemini', 'settings.json');
  const mine = JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } });
  fs.writeFileSync(theirs, mine);
  const keyHome = path.join(root, 'kosmos', 'gemini-key-home', 'default');
  const kh = path.join(keyHome, '.gemini', 'settings.json');
  const bridge = path.join(root, 'kosmos', 'bin', 'gemini-report-bridge.js');
  const deps = { geminiAccounts: fakeAccounts(root, {}), doorDir: null, homeDir: personal, keyHome, bridge };
  const hooked = () => {
    const s = JSON.parse(fs.readFileSync(kh, 'utf8'));
    return geminisettings.HOOK_EVENTS.every((ev) => Array.isArray(s.hooks && s.hooks[ev])
      && s.hooks[ev].some((d) => d.hooks.some((h) => h.command === geminisettings.commandFor(bridge))));
  };

  // A home pinned before this fix: the auth alone, no hooks.
  fs.mkdirSync(path.dirname(kh), { recursive: true });
  fs.writeFileSync(kh, JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } }));
  let env = keyed.turnEnv('gemini', {}, null, deps);
  assert.equal(env.GEMINI_CLI_HOME, keyHome, 'the keyed turn runs in the key home');
  assert.ok(hooked(), 'the older pinned home now carries all five report hooks');
  assert.equal(JSON.parse(fs.readFileSync(kh, 'utf8')).security.auth.selectedType, 'gemini-api-key');

  // A fresh key home: pinned AND hooked in one turn; a second turn changes nothing.
  fs.rmSync(keyHome, { recursive: true, force: true });
  env = keyed.turnEnv('gemini', {}, null, deps);
  assert.equal(env.GEMINI_CLI_HOME, keyHome);
  assert.ok(hooked(), 'a fresh key home is hooked on its first turn');
  const before = fs.readFileSync(kh, 'utf8');
  keyed.turnEnv('gemini', {}, null, deps);
  assert.equal(fs.readFileSync(kh, 'utf8'), before, 'idempotent: an unchanged home is not rewritten');
  assert.equal(fs.readFileSync(theirs, 'utf8'), mine, 'the person\'s own settings are never edited');
});

/* #4012: each Windows gemini/grok turn is a whole headless session, so the bridges must be told
   that its SessionStart/SessionEnd are turn edges (measured: every turn otherwise ended on
   `stopped`, which the board reads as a contradiction and drops). */
test('#4012 turnEnv: gemini and grok turns are marked per-turn for the report bridges', () => {
  const root = path.join(SANDBOX, 'pt4012');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(keyed.turnEnv('gemini', {}, null, { geminiAccounts: fakeAccounts(root, {}), doorDir: null, keyHome: null }).KOSMOS_PER_TURN, '1');
  assert.equal(keyed.turnEnv('grok', {}, null, { grokAccounts: fakeAccounts(root, {}), doorDir: null }).KOSMOS_PER_TURN, '1');
});
