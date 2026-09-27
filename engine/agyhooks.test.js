'use strict';

/**
 * #4043: Antigravity status through agy's own hooks. engine/agyhooks.js writes Kosmos's one hook
 * into an agent's `.agents/hooks.json`; bin/agy-report-bridge.js is what that hook runs.
 *
 *   node --test engine/agyhooks.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'agyhooks-'));
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const hooks = require('./agyhooks');
const bridge = require('../bin/agy-report-bridge');
const BRIDGE_FILE = path.join(__dirname, '..', 'bin', 'agy-report-bridge.js');

let n = 0;
const workdir = () => { n += 1; const d = path.join(SB, 'work ' + n); fs.mkdirSync(d, { recursive: true }); return d; };
const readHooks = (d) => JSON.parse(fs.readFileSync(path.join(d, '.agents', 'hooks.json'), 'utf8'));

test('#4043: a fresh workdir gets the kosmos-report hook: working before each model call, idle at stop', () => {
  const d = workdir();
  const r = hooks.ensureHooks(d, '/opt/node', '/support/bin/agy-report-bridge.js');
  assert.deepEqual(r, { ok: true, changed: true, why: null });
  const h = readHooks(d)[hooks.HOOK_NAME];
  assert.deepEqual(Object.keys(h).sort(), ['PostToolUse', 'PreInvocation', 'PreToolUse', 'Stop']);
  assert.match(h.PreInvocation[0].command, / PreInvocation$/);
  assert.match(h.Stop[0].command, / Stop$/);
  for (const ev of ['PreToolUse', 'PostToolUse']) {
    assert.equal(h[ev][0].matcher, '^ask_question$', ev + ' must be hooked for ask_question ONLY (a hook per tool slows agy\'s loop)');
    assert.match(h[ev][0].hooks[0].command, new RegExp(' ' + ev + '$'));
  }
});

test('#4043: the person\'s own hooks are kept, and a second run changes nothing', () => {
  const d = workdir();
  fs.mkdirSync(path.join(d, '.agents'));
  const mine = { 'lint-checker': { PostToolUse: [{ matcher: 'run_command', hooks: [{ command: './lint.sh' }] }] } };
  fs.writeFileSync(path.join(d, '.agents', 'hooks.json'), JSON.stringify(mine));
  assert.equal(hooks.ensureHooks(d, '/opt/node', '/b.js').changed, true);
  const after = readHooks(d);
  assert.deepEqual(after['lint-checker'], mine['lint-checker'], 'the person\'s hook changed');
  assert.ok(after[hooks.HOOK_NAME]);
  const mtime = fs.statSync(path.join(d, '.agents', 'hooks.json')).mtimeMs;
  assert.deepEqual(hooks.ensureHooks(d, '/opt/node', '/b.js'), { ok: true, changed: false, why: null });
  assert.equal(fs.statSync(path.join(d, '.agents', 'hooks.json')).mtimeMs, mtime, 'an unchanged entry was rewritten');
  assert.equal(hooks.ensureHooks(d, '/opt/node', '/moved/b.js').changed, true, 'a moved bridge must update the entry');
});

test('#4043: a hooks.json that is not a JSON object is left exactly as it is', () => {
  for (const body of ['{ not json', '[1,2]', '"text"']) {
    const d = workdir();
    fs.mkdirSync(path.join(d, '.agents'));
    fs.writeFileSync(path.join(d, '.agents', 'hooks.json'), body);
    const r = hooks.ensureHooks(d, '/opt/node', '/b.js');
    assert.equal(r.ok, false);
    assert.equal(fs.readFileSync(path.join(d, '.agents', 'hooks.json'), 'utf8'), body, 'a file we cannot parse was changed');
  }
});

test('#4043: the hook command really runs through sh -c, from paths with spaces and a quote', () => {
  const dir = path.join(SB, "Application Support", "it's here");
  fs.mkdirSync(dir, { recursive: true });
  const fakeBridge = path.join(dir, 'fake bridge.js');
  const out = path.join(SB, 'argv.json');
  fs.writeFileSync(fakeBridge, `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));`);
  const entry = hooks.kosmosEntry(process.execPath, fakeBridge);
  execFileSync('sh', ['-c', entry.Stop[0].command]);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), ['Stop'], 'the quoted command did not reach the bridge with its event');
});

test('#4043: the bridge maps its hooked events, needs_you only for a real ask_question, and ignores anything else', () => {
  assert.deepEqual(bridge.reportFor('PreInvocation', {}), { state: 'working', text: '' });
  assert.deepEqual(bridge.reportFor('Stop', { fullyIdle: true, error: '' }), { state: 'idle', text: '' });
  assert.equal(bridge.reportFor('Stop', { fullyIdle: false, error: 'boom' }).state, 'idle', 'an errored turn is still over');
  assert.match(bridge.reportFor('Stop', { error: 'boom' }).text, /boom/);
  for (const ev of ['PostInvocation', 'Notification', '', undefined]) assert.equal(bridge.reportFor(ev, {}), null, String(ev));
  /* needs_you only from a real ask_question (Gemini-Sub's spec), never from anything idle (#4006). */
  assert.equal(bridge.reportFor('PreToolUse', { toolCall: { name: 'run_command', args: {} } }), null, 'another tool was reported as needs_you');
  assert.equal(bridge.reportFor('PreToolUse', {}), null, 'a PreToolUse with no tool named was reported');
  /* agy's own schema (1.2.11): questions[].question. */
  assert.deepEqual(bridge.reportFor('PreToolUse', { toolCall: { name: 'ask_question', args: { questions: [{ question: 'Deploy now?', options: ['yes', 'no'] }] } } }), { state: 'needs_you', text: 'Deploy now?' });
  assert.equal(bridge.reportFor('PreToolUse', { toolCall: { name: 'ask_question', args: { questions: [{ question: 'A?' }, { question: 'B?' }] } } }).text, 'A? / B?');
  assert.equal(bridge.reportFor('PreToolUse', { toolCall: { name: 'ask_question', args: {} } }).text, 'Antigravity is asking you a question', 'the route refuses a needs_you with no reason');
  assert.deepEqual(bridge.reportFor('PostToolUse', {}), { state: 'working', text: '' }, 'answered: back to working');
  for (const ev of ['PreToolUse', 'PreInvocation', 'Stop', 'PostToolUse']) assert.equal(bridge.answerFor(ev), '{}', ev + ': Kosmos never makes a decision for agy');
});

test('#4043: the report is marked auto, so a turn ending cannot erase a deliberate blocked', () => {
  const b = bridge.buildBody('idle', '', { TMUX_PANE: '%7' });
  assert.equal(b.auto, true);
  assert.equal(b.from_pane, '%7');
});

test('#4043: run as agy runs it, the bridge answers {} first and exits 0 fast even with no board', () => {
  const start = Date.now();
  const r = spawnSync(process.execPath, [BRIDGE_FILE, 'Stop'], {
    input: JSON.stringify({ conversationId: 'x', fullyIdle: true, error: '' }),
    env: { ...process.env, KOSMOS_PORT: '9', TMUX_PANE: '%stdout-' + process.pid }, // nothing listens on port 9
    encoding: 'utf8',
    timeout: 15000,
  });
  try { fs.rmSync(bridge.markerFile({ TMUX_PANE: '%stdout-' + process.pid }), { force: true }); } catch { /* none */ }
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}', 'agy reads stdout as the hook\'s answer; it must be exactly {}');
  assert.ok(Date.now() - start < (bridge.STDIN_TIMEOUT_MS + bridge.TIMEOUT_MS + 3000), 'the bridge stalled the agent');
});

test('#4043: a repeated working is sent once per THROTTLE_MS per pane; a change of state always goes', () => {
  const env = { TMUX_PANE: '%throttle-' + process.pid };
  try { fs.rmSync(bridge.markerFile(env), { force: true }); } catch { /* none */ }
  const t = 1_000_000;
  assert.equal(bridge.shouldSend('working', t, env), true, 'the first working goes');
  assert.equal(bridge.shouldSend('working', t + 1000, env), false, 'a repeat inside the window is held');
  assert.equal(bridge.shouldSend('idle', t + 2000, env), true, 'a change of state always goes');
  assert.equal(bridge.shouldSend('working', t + 3000, env), true, 'and so does the change back');
  assert.equal(bridge.shouldSend('working', t + 3000 + bridge.THROTTLE_MS, env), true, 'a heartbeat once the window has passed');
  const other = { TMUX_PANE: '%throttle-other-' + process.pid };
  assert.equal(bridge.shouldSend('working', t + 3001, other), true, 'panes are throttled separately');
  for (const e of [env, other]) { try { fs.rmSync(bridge.markerFile(e), { force: true }); } catch { /* none */ } }
});

test('#4043: a board that never answers costs at most the bridge\'s own budget', async () => {
  const http = require('node:http');
  const server = http.createServer(() => { /* never answer */ });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%slow-' + process.pid };
  try { fs.rmSync(bridge.markerFile(env), { force: true }); } catch { /* none */ }
  const { spawn } = require('node:child_process');
  const start = Date.now();
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [BRIDGE_FILE, 'Stop'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    p.stdin.end(JSON.stringify({ fullyIdle: true, error: '' }));
    p.on('exit', resolve);
  });
  const took = Date.now() - start;
  server.closeAllConnections(); server.close();
  try { fs.rmSync(bridge.markerFile(env), { force: true }); } catch { /* none */ }
  assert.equal(code, 0);
  assert.ok(took < bridge.STDIN_TIMEOUT_MS + bridge.TIMEOUT_MS + 3000, 'the bridge held agy for ' + took + 'ms on a silent board');
  assert.ok(took >= bridge.TIMEOUT_MS - 200, 'control: it did wait on the silent board (' + took + 'ms), so the bound was exercised');
});

test('#4043: the supervisor writes the hook before every agy launch, and cannot fail the launch (SOURCE pin)', () => {
  /* The launch needs tmux and agy, so the order is pinned in source, as
     supervisor.pane-reach-1160.test.js pins agytrust's. */
  const sh = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const at = sh.indexOf('elif [ "$RUNNER" = antigravity ]; then');
  assert.ok(at > -1, 'the antigravity branch moved: re-anchor this pin');
  const branch = sh.slice(at);
  const call = branch.indexOf('"$NODE_BIN" "$_eng/agyhooks.js" "$WORKDIR" "$NODE_BIN" "$_AGY_BRIDGE" >/dev/null || true');
  const launch = branch.indexOf('new-session');
  assert.ok(call > -1, 'the supervisor no longer runs agyhooks for an agy agent');
  assert.ok(launch > -1 && call < launch, 'agyhooks must run BEFORE agy is launched, or the first turn reports nothing');
  assert.match(branch.slice(0, launch), /_AGY_BRIDGE="\$\(cd "\$\(dirname "\$0"\)"/, 'the bridge must be the copy beside the supervisor');
});

test('#4043: the installed copy finds the engine through the engine-path pointer (no engine/ beside it)', () => {
  const dir = path.join(SB, 'support', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const engine = path.join(__dirname);
  fs.writeFileSync(path.join(dir, 'engine-path'), engine + '\n');
  assert.equal(bridge.engineDir(dir), engine, 'the supportDir copy could not find the engine, so no board token would be sent');
  assert.equal(bridge.engineDir(path.join(SB, 'nowhere')), null, 'control: no pointer and no engine beside it is null, not a guess');
});

test('#4043: the command-line entry always exits 0 and says why on stderr when it cannot write', () => {
  const d = workdir();
  fs.mkdirSync(path.join(d, '.agents'));
  fs.writeFileSync(path.join(d, '.agents', 'hooks.json'), '{ not json');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'agyhooks.js'), d, '/opt/node', '/b.js'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'a hook we could not write must never stop the launch');
  assert.match(r.stderr, /not valid JSON/);
  const ok = workdir();
  const r2 = spawnSync(process.execPath, [path.join(__dirname, 'agyhooks.js'), ok, '/opt/node', '/b.js'], { encoding: 'utf8' });
  assert.equal(r2.status, 0);
  assert.ok(readHooks(ok)[hooks.HOOK_NAME], 'control: the CLI writes the hook');
});

test('#4043: run for an ask_question, the bridge answers exactly {} (no permission decision)', () => {
  const r = spawnSync(process.execPath, [BRIDGE_FILE, 'PreToolUse'], {
    input: JSON.stringify({ toolCall: { name: 'ask_question', args: { questions: [{ question: 'Go?' }] } } }),
    env: { ...process.env, KOSMOS_PORT: '9', TMUX_PANE: '%pretool-' + process.pid },
    encoding: 'utf8', timeout: 15000,
  });
  try { fs.rmSync(bridge.markerFile({ TMUX_PANE: '%pretool-' + process.pid }), { force: true }); } catch { /* none */ }
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
});

test('#4043: agents without a pane never share one throttle marker', () => {
  assert.equal(bridge.throttleKey({ TMUX_PANE: '%3' }, 99), 'pane-%3');
  const a = bridge.throttleKey({ KOSMOS_AGENT_TOKEN: 'aaaa' }, 99);
  const b = bridge.throttleKey({ KOSMOS_AGENT_TOKEN: 'bbbb' }, 99);
  assert.ok(a.startsWith('tok-') && b.startsWith('tok-') && a !== b, 'two agents\' tokens gave one key');
  assert.notEqual(bridge.throttleKey({}, 4242), bridge.throttleKey({}, 4343), 'two agy processes shared a key');
  assert.equal(bridge.throttleKey({}, 1), 'nopane', 'control: only an unknowable caller falls back to the shared key');
});

/* Drive the real bridge, as agy runs it, against a fake board in THIS process (grok-report-bridge.test.js's
   drive()). Async spawn so the stub can answer; the handler records before it responds, so the child's
   close is a sufficient barrier. */
function driveBridge(port, eventName, payload, pane) {
  const { spawn } = require('node:child_process');
  return new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: pane };
    delete env.KOSMOS_AGENT_TOKEN;
    const child = spawn(process.execPath, [BRIDGE_FILE, eventName], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('bridge exited ' + code))));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('#4043: what the board actually receives: the route, state, text, auto and pane, with the throttle', async () => {
  const http = require('node:http');
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"recorded":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const pane = '%post-' + process.pid;
  try { fs.rmSync(bridge.markerFile({ TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  try {
    await driveBridge(port, 'PreInvocation', { conversationId: 'c' }, pane);
    await driveBridge(port, 'PreInvocation', { conversationId: 'c' }, pane); // a repeat inside the window
    await driveBridge(port, 'PreToolUse', { toolCall: { name: 'ask_question', args: { questions: [{ question: 'Ship it?' }, { question: 'Which env?' }] } } }, pane);
    await driveBridge(port, 'PreToolUse', { toolCall: { name: 'run_command', args: {} } }, pane); // not ours: nothing sent
    await driveBridge(port, 'PostToolUse', { toolCall: { name: 'ask_question' } }, pane);
    await driveBridge(port, 'Stop', { fullyIdle: true, error: 'quota exceeded' }, pane);
  } finally {
    server.closeAllConnections(); server.close();
    try { fs.rmSync(bridge.markerFile({ TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  }
  assert.deepEqual(seen.map((s) => s.body.state), ['working', 'needs_you', 'working', 'idle'],
    'the repeated working must be held by the throttle, and a non-ask_question PreToolUse must send nothing');
  for (const s of seen) {
    assert.equal(s.method, 'POST');
    assert.equal(s.url, '/api/report');
    assert.equal(s.body.auto, true, 'every report is auto (#1456)');
    assert.equal(s.body.from_pane, pane, 'the pane identity must travel');
  }
  assert.equal(seen[1].body.text, 'Ship it? / Which env?', 'the question the person sees is agy\'s own');
  assert.equal(seen[3].body.text, 'The turn ended with an error: quota exceeded');
});
