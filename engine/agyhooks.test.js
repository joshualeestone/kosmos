'use strict';

/**
 * #4043: Antigravity status through agy's own hooks. engine/agyhooks.js writes Kosmos's one hook
 * into an agent's `.agents/hooks.json`; bin/agy-report-bridge.js is what that hook runs.
 *
 *   node --test engine/agyhooks.test.js
 */

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
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
  assert.deepEqual(r, { ok: true, changed: true, why: null, enabled: true });
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
  assert.deepEqual(hooks.ensureHooks(d, '/opt/node', '/b.js'), { ok: true, changed: false, why: null, enabled: true });
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
  for (const ev of ['PreInvocation', 'Stop', 'PostToolUse']) assert.equal(bridge.answerFor(ev), '{}', ev + ': a non-gate event answers {}');
  assert.equal(bridge.answerFor('PreToolUse', { toolCall: { name: 'ask_question' } }), '{"decision":"allow"}', 'PreToolUse must allow ask_question (a missing decision denies it)');
  assert.equal(bridge.answerFor('PreToolUse', { toolCall: { name: 'run_command' } }), '{"decision":"ask"}', 'any other tool gets agy\'s own prompt, never allow');
  assert.equal(bridge.answerFor('PreToolUse', null), '{"decision":"ask"}', 'no payload: agy\'s own prompt, never allow');
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
    env: { ...process.env, AGENT_WORKFORCE_DATA: path.join(SB, 'data-4796'), KOSMOS_PORT: '9', TMUX_PANE: '%stdout-' + process.pid }, // nothing listens on port 9
    encoding: 'utf8',
    timeout: 15000,
  });
  try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: '9', TMUX_PANE: '%stdout-' + process.pid }), { force: true }); } catch { /* none */ }
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
  // #4796: a data root of its own, so the bridge reads no live board token.
  const env = { ...process.env, AGENT_WORKFORCE_DATA: path.join(SB, 'data-4796'), KOSMOS_PORT: String(port), TMUX_PANE: '%slow-' + process.pid };
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
  const call = branch.indexOf('_AGY_HOOKED="$("$NODE_BIN" "$_eng/agyhooks.js" "$WORKDIR" "$NODE_BIN" "$_AGY_BRIDGE" "$_AGY_VERSION" || true)"');
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

test('#4043: run for an ask_question, the bridge answers {"decision":"allow"}, exactly as agy reads it', () => {
  const r = spawnSync(process.execPath, [BRIDGE_FILE, 'PreToolUse'], {
    input: JSON.stringify({ toolCall: { name: 'ask_question', args: { questions: [{ question: 'Go?' }] } } }),
    env: { ...process.env, AGENT_WORKFORCE_DATA: path.join(SB, 'data-4796'), KOSMOS_PORT: '9', TMUX_PANE: '%pretool-' + process.pid },
    encoding: 'utf8', timeout: 15000,
  });
  try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: '9', TMUX_PANE: '%pretool-' + process.pid }), { force: true }); } catch { /* none */ }
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{"decision":"allow"}');
});

test('#4043: agents without a pane never share one throttle marker', () => {
  assert.equal(bridge.throttleKey({ TMUX_PANE: '%3' }, 99), 'pane-16180-%3');
  /* Two Kosmos worlds as one user: %3 is unique only inside one tmux server (review 6). */
  assert.notEqual(bridge.throttleKey({ TMUX_PANE: '%3', KOSMOS_PORT: '16180' }, 99), bridge.throttleKey({ TMUX_PANE: '%3', KOSMOS_PORT: '16181' }, 99),
    'two worlds\' %3 shared one throttle marker');
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
    // #4796: a data root of its own, so the bridge reads no live board token.
    const env = { ...process.env, AGENT_WORKFORCE_DATA: path.join(SB, 'data-4796'), KOSMOS_PORT: String(port), TMUX_PANE: pane };
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
  try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  try {
    await driveBridge(port, 'PreInvocation', { conversationId: 'c' }, pane);
    await driveBridge(port, 'PreInvocation', { conversationId: 'c' }, pane); // a repeat inside the window
    await driveBridge(port, 'PreToolUse', { toolCall: { name: 'ask_question', args: { questions: [{ question: 'Ship it?' }, { question: 'Which env?' }] } } }, pane);
    await driveBridge(port, 'PreToolUse', { toolCall: { name: 'run_command', args: {} } }, pane); // not ours: nothing sent
    await driveBridge(port, 'PostToolUse', { toolCall: { name: 'ask_question' } }, pane);
    await driveBridge(port, 'Stop', { fullyIdle: true, error: 'quota exceeded' }, pane);
  } finally {
    server.closeAllConnections(); server.close();
    try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
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

/* #4491: which credentials the bridge presents. The agent's own token always, when it has a well-formed one (trimmed);
   the person's board token, with the slice-7 switch off (today's default), only when this process can read one. An agy agent that cannot read the board token still
   reports, as itself. That the BOARD then takes the agent's token with no board token is not measured here (this
   stub answers 200 to anything): server.report-reply-loopback-1968.test.js's AGENT-TOKEN arm pins it. */
test('#4491: the bridge presents the agent\'s token, and the board token only when it can read one', async () => {
  const http = require('node:http');
  const { spawn } = require('node:child_process');
  const store = require('./store');
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"recorded":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const panes = [];
  /* One Stop per call (an idle is never held by the throttle), each as its own pane, with the env under test. */
  const stop = (extra) => new Promise((resolve, reject) => {
    const pane = '%tok-' + process.pid + '-' + panes.length;
    panes.push(pane);
    // #4796: a data root of its own in the literal; every call also names its own in `extra`, which wins.
    /* KOSMOS_AGENT_TOKEN_ONLY cleared: an agent that exports it in its own pane must not turn the board-token arm red
       on a direct `node --test` (tools/run-tests.sh clears it too, a direct run does not). */
    const env = { ...process.env, KOSMOS_AGENT_TOKEN_ONLY: '', AGENT_WORKFORCE_DATA: path.join(SB, 'data-4796'), KOSMOS_PORT: String(port), TMUX_PANE: pane, ...extra };
    const child = spawn(process.execPath, [BRIDGE_FILE, 'Stop'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('bridge exited ' + code))));
    child.stdin.end(JSON.stringify({ fullyIdle: true }));
  });
  const tok = 'ab12'.repeat(16);
  const none = path.join(SB, 'no-board-token');       // a data folder the board never wrote a token into
  const held = path.join(SB, 'with-board-token');
  // Junk after a token and junk in front of one (review 2: a regex without its ^ let the second through).
  const BAD = ['', ' ', 'not-hex', 'ABCDEF', 'deadbeef warning: x', 'warning: deadbeef'];
  try {
    fs.mkdirSync(none, { recursive: true });
    fs.mkdirSync(path.join(held, store.APP), { recursive: true });
    fs.writeFileSync(path.join(held, store.APP, 'board.token'), 'abc123boardtoken');
    await stop({ KOSMOS_AGENT_TOKEN: tok, AGENT_WORKFORCE_DATA: none });
    await stop({ KOSMOS_AGENT_TOKEN: tok, AGENT_WORKFORCE_DATA: held });
    await stop({ KOSMOS_AGENT_TOKEN: ' ' + tok + '\n', AGENT_WORKFORCE_DATA: none });   // as a file read can hand it over
    for (const bad of BAD) await stop({ KOSMOS_AGENT_TOKEN: bad, AGENT_WORKFORCE_DATA: none });
  } finally {
    server.closeAllConnections(); server.close();
    for (const pane of panes) { try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ } }
  }
  assert.equal(seen.length, 3 + BAD.length, 'a report was lost: every Stop must reach the board, with or without a board token');
  assert.equal(seen[0].headers['x-kosmos-agent-token'], tok, 'the agent\'s token did not reach the board');
  assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'no token file, so no board-token header may be sent');
  assert.equal(seen[0].body.state, 'idle', 'with no board token to read, the report itself changed');
  /* CONTROL for the absence above (today's default with the switch off, not a goal of #4491): the same run where
     the board did write a token presents it, so the absence is the missing file and not a bridge that never reads one. */
  assert.equal(seen[1].headers['x-kosmos-board-token'], 'abc123boardtoken', 'the board token did not reach the board');
  assert.equal(seen[1].headers['x-kosmos-agent-token'], tok);
  assert.equal(seen[2].headers['x-kosmos-agent-token'], tok, 'a well-formed token with surrounding whitespace was not trimmed and presented');
  /* No token, or one that is not plain hex, is never presented: the route would refuse it rather than fall back
     to the pane (the other three bridges' rule). */
  BAD.forEach((bad, i) => assert.equal(seen[3 + i].headers['x-kosmos-agent-token'], undefined, JSON.stringify(bad) + ' was presented as the agent\'s token'));
});
/* The merge of main into #4588 put `waiting` (#4569) and `until` (#4588) on one buildBody call: each must reach the
   board in its own field. Dropping either one at the send site reds this test or the next. */
test('#4569 + #4588: the real bridge carries a Muse queue count to the board as waiting, with no until', async () => {
  const http = require('node:http');
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"recorded":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const pane = '%wait-' + process.pid;
  try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  try {
    await driveBridge(port, 'PreInvocation', { kosmosWaiting: { n: 4, yours: 1 } }, pane);
  } finally {
    server.closeAllConnections(); server.close();
    try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].state, 'working');
  assert.deepEqual(seen[0].waiting, { n: 4, yours: 1 }, 'the queue count did not reach the board');
  assert.equal(seen[0].until, '', 'a queue count must not travel as a reset time');
});

test('#4588 (review 7): the real bridge carries a quota Stop\'s reset to the board as a strict ISO until', async () => {
  const http = require('node:http');
  const status = require('./status');
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"recorded":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const pane = '%quota-' + process.pid;
  try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  const before = Date.now();
  try {
    await driveBridge(port, 'Stop', { fullyIdle: true, error: 'API error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 24m54s.' }, pane);
    await driveBridge(port, 'Stop', { fullyIdle: true, error: 'boom' }, pane);   // CONTROL: an ordinary error
  } finally {
    server.closeAllConnections(); server.close();
    try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  }
  assert.equal(seen.length, 2);
  const [quota, plain] = seen;
  assert.match(quota.until, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the reset did not reach the board: ' + JSON.stringify(quota));
  const wait = Date.parse(quota.until) - before;
  assert.ok(wait >= (24 * 60 + 54) * 1000 && wait < (24 * 60 + 54) * 1000 + 60000, 'until is not the reset: ' + quota.until);
  assert.ok(quota.text.startsWith(status.QUOTA_REPORT_PREFIX), 'the board reads a pause only after this sentence: ' + quota.text);
  assert.equal(plain.until, '', 'CONTROL: an ordinary error carries no reset');
});

/* The merge of main's #4618 into #4588 put `final` (#4612, a Muse agent's answer to a DM) and `until` (#4588, the
   quota reset) on one buildBody call and one Stop. A Muse Stop that carries an answer AND a quota error must post both:
   the answer so the DM shows it, the reset so the card shows the pause. Swapping the two arguments at the send, dropping
   either, or a quota branch that returns without the answer each reds this test. */
test('#4612 + #4588: the real bridge posts a Muse answer and a quota reset from one Stop, each in its own field', async () => {
  const http = require('node:http');
  const status = require('./status');
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"recorded":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const pane = '%final-' + process.pid;
  const answer = { text: 'Here is the summary you asked for.', startedAt: '2026-09-30T17:00:00.000Z' };
  try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  const before = Date.now();
  try {
    await driveBridge(port, 'Stop', { fullyIdle: true, kosmosFinal: answer, error: 'API error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 24m54s.' }, pane);
    await driveBridge(port, 'Stop', { fullyIdle: true, kosmosFinal: answer }, pane);   // CONTROL: an answer, no quota
  } finally {
    server.closeAllConnections(); server.close();
    try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: String(port), TMUX_PANE: pane }), { force: true }); } catch { /* none */ }
  }
  assert.equal(seen.length, 2);
  const [both, plain] = seen;
  assert.equal(both.state, 'idle');
  assert.deepEqual(both.final, answer, 'the quota stop swallowed the Muse answer: ' + JSON.stringify(both));
  assert.match(both.until, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the reset did not reach the board: ' + JSON.stringify(both));
  const wait = Date.parse(both.until) - before;
  assert.ok(wait >= (24 * 60 + 54) * 1000 && wait < (24 * 60 + 54) * 1000 + 60000, 'until is not the reset: ' + both.until);
  assert.ok(both.text.startsWith(status.QUOTA_REPORT_PREFIX), both.text);
  assert.deepEqual(plain.final, answer, 'CONTROL: an answer alone still reaches the board');
  assert.equal(plain.until, '', 'CONTROL: an answer is never sent as a reset time');
});

test('#4043: the ask_question hooks are written only for an agy that handles them (1.1.9+); older or unknown gets working/idle only', () => {
  for (const [out, safe] of [['1.2.11', true], ['agy 1.1.9\n', true], ['1.1.10', true], ['2.0.0', true],
    ['1.1.8', false], ['1.0.16', false], ['0.9.99', false], ['', false], [undefined, false], ['not a version', false]]) {
    assert.equal(hooks.toolHooksSafe(out), safe, JSON.stringify(out));
  }
  const d = workdir();
  hooks.ensureHooks(d, '/opt/node', '/b.js', false);
  assert.deepEqual(Object.keys(readHooks(d)[hooks.HOOK_NAME]).sort(), ['PreInvocation', 'Stop'], 'an old agy still got the tool hooks');
  /* An upgrade adds them on the next launch, and a downgrade takes them away again. */
  assert.equal(hooks.ensureHooks(d, '/opt/node', '/b.js', true).changed, true);
  assert.deepEqual(Object.keys(readHooks(d)[hooks.HOOK_NAME]).sort(), ['PostToolUse', 'PreInvocation', 'PreToolUse', 'Stop']);
  assert.equal(hooks.ensureHooks(d, '/opt/node', '/b.js', false).changed, true);
  assert.deepEqual(Object.keys(readHooks(d)[hooks.HOOK_NAME]).sort(), ['PreInvocation', 'Stop']);
});

test('#4043: the CLI takes agy\'s version as its 4th argument, and says on stderr when it leaves the tool hooks out', () => {
  const run = (d, v) => spawnSync(process.execPath, [path.join(__dirname, 'agyhooks.js'), d, '/opt/node', '/b.js', ...(v === undefined ? [] : [v])], { encoding: 'utf8' });
  const old = workdir();
  const r = run(old, '1.0.3');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /1\.0\.3 is older than 1\.1\.9/);
  assert.deepEqual(Object.keys(readHooks(old)[hooks.HOOK_NAME]).sort(), ['PreInvocation', 'Stop']);
  const cur = workdir();
  const r2 = run(cur, '1.2.11');
  assert.equal(r2.stderr, '', 'control: a current agy writes without complaint');
  assert.deepEqual(Object.keys(readHooks(cur)[hooks.HOOK_NAME]).sort(), ['PostToolUse', 'PreInvocation', 'PreToolUse', 'Stop']);
});

test('#4043: the supervisor hands agy\'s own --version to agyhooks (SOURCE pin)', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  assert.ok(sh.includes('_AGY_VERSION="$("$CLAUDE" --version 2>/dev/null | head -n 1 || true)"'), 'the supervisor no longer reads agy\'s version');
  assert.ok(sh.includes('_AGY_HOOKED="$("$NODE_BIN" "$_eng/agyhooks.js" "$WORKDIR" "$NODE_BIN" "$_AGY_BRIDGE" "$_AGY_VERSION" || true)"'), 'agyhooks no longer gets the version');
});

test('#4043: a folder inside a git project is left alone (its hooks.json would be committed with this Mac\'s paths)', () => {
  const repo = workdir();
  fs.mkdirSync(path.join(repo, '.git'));
  const inner = path.join(repo, 'sub dir');
  fs.mkdirSync(inner);
  for (const d of [repo, inner]) {
    const r = hooks.ensureHooks(d, '/opt/node', '/b.js');
    assert.equal(r.ok, false, d + ' is in a git project and still got the hook');
    assert.match(r.why, /inside the git project/);
    assert.equal(fs.existsSync(path.join(d, '.agents', 'hooks.json')), false, 'a hooks.json was written into the project');
  }
  /* A worktree or submodule has a .git FILE, not a folder. */
  const wt = workdir();
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /elsewhere\n');
  assert.equal(hooks.gitRootOf(wt), fs.realpathSync.native(wt));
  assert.equal(hooks.ensureHooks(wt, '/opt/node', '/b.js').ok, false);
  const plain = workdir();
  assert.equal(hooks.ensureHooks(plain, '/opt/node', '/b.js').ok, true, 'control: a plain Kosmos folder still gets the hook');
});

test('#4043: the person turning Kosmos\'s hook off (enabled:false) survives the next launch', () => {
  const d = workdir();
  hooks.ensureHooks(d, '/opt/node', '/b.js');
  const file = path.join(d, '.agents', 'hooks.json');
  const h = readHooks(d);
  h[hooks.HOOK_NAME].enabled = false;
  fs.writeFileSync(file, JSON.stringify(h));
  assert.equal(hooks.ensureHooks(d, '/opt/node', '/b.js').changed, false, 'an unchanged entry that is switched off was rewritten');
  assert.equal(readHooks(d)[hooks.HOOK_NAME].enabled, false);
  hooks.ensureHooks(d, '/opt/node2', '/b.js');
  assert.equal(readHooks(d)[hooks.HOOK_NAME].enabled, false, 'a changed entry lost the person\'s off switch');
  assert.match(readHooks(d)[hooks.HOOK_NAME].Stop[0].command, /node2/, 'control: the entry itself was updated');
});

test('#4043: a symlinked hooks.json stays a link and keeps its mode; a dangling link is left alone', () => {
  const d = workdir();
  const real = path.join(SB, 'dotfiles-' + n + '.json');
  fs.writeFileSync(real, JSON.stringify({ theirs: { Stop: [] } }));
  fs.chmodSync(real, 0o640);
  fs.mkdirSync(path.join(d, '.agents'));
  const link = path.join(d, '.agents', 'hooks.json');
  fs.symlinkSync(real, link);
  assert.equal(hooks.ensureHooks(d, '/opt/node', '/b.js').changed, true);
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link was replaced by a plain file');
  assert.ok(JSON.parse(fs.readFileSync(real, 'utf8'))[hooks.HOOK_NAME], 'the entry did not reach the link\'s target');
  assert.equal(fs.statSync(real).mode & 0o777, 0o640, 'the file\'s mode was reset');
  const d2 = workdir();
  fs.mkdirSync(path.join(d2, '.agents'));
  fs.symlinkSync(path.join(SB, 'gone.json'), path.join(d2, '.agents', 'hooks.json'));
  const r = hooks.ensureHooks(d2, '/opt/node', '/b.js');
  assert.equal(r.ok, false);
  assert.ok(fs.lstatSync(path.join(d2, '.agents', 'hooks.json')).isSymbolicLink(), 'a dangling link was replaced');
});

test('#4043: a two-part agy version is read as x.y.0', () => {
  assert.deepEqual(hooks.parseVersion('2.0'), [2, 0, 0]);
  assert.equal(hooks.toolHooksSafe('2.0'), true);
  assert.equal(hooks.toolHooksSafe('1.1'), false, '1.1 is 1.1.0, older than 1.1.9');
});

test('#4043: a hooks.json linked INTO a git project is refused too (a dotfiles repo behind a link)', () => {
  const repo = path.join(SB, 'dotrepo-' + process.pid);
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const target = path.join(repo, 'hooks.json');
  fs.writeFileSync(target, '{}');
  const d = workdir();
  fs.mkdirSync(path.join(d, '.agents'));
  fs.symlinkSync(target, path.join(d, '.agents', 'hooks.json'));
  const r = hooks.ensureHooks(d, '/opt/node', '/b.js');
  assert.equal(r.ok, false, 'the hook was written through a link into a repository');
  assert.equal(fs.readFileSync(target, 'utf8'), '{}', 'the repository\'s file changed');
  /* And a linked .agents folder. */
  const d2 = workdir();
  fs.mkdirSync(path.join(repo, 'agents'));
  fs.symlinkSync(path.join(repo, 'agents'), path.join(d2, '.agents'));
  assert.equal(hooks.ensureHooks(d2, '/opt/node', '/b.js').ok, false, 'a linked .agents into a repository was written');
  assert.equal(fs.existsSync(path.join(repo, 'agents', 'hooks.json')), false);
});

test('#4043: a repository ABOVE the workers folder (a person\'s ~/.git) does not blank Kosmos\'s own agents', () => {
  const home = path.join(SB, 'home-' + process.pid);
  const root = path.join(home, 'work', 'workers');
  const agent = path.join(root, 'kitty');
  fs.mkdirSync(path.join(home, '.git'), { recursive: true });
  fs.mkdirSync(agent, { recursive: true });
  assert.equal(hooks.gitRootOf(agent, root), null, 'a home-level repo counted against a Kosmos agent folder');
  assert.equal(hooks.gitRootOf(agent), fs.realpathSync.native(home), 'control: without the ceiling the walk does find it');
  fs.mkdirSync(path.join(agent, '.git'));
  assert.equal(hooks.gitRootOf(agent, root), fs.realpathSync.native(agent), 'a repo INSIDE the workers folder still counts');
  const outside = path.join(home, 'projects', 'app');
  fs.mkdirSync(outside, { recursive: true });
  assert.equal(hooks.gitRootOf(outside, root), fs.realpathSync.native(home), 'a folder outside the workers root gets the full walk');
  const prev = process.env.AGENT_WORKFORCE_WORKERS;
  process.env.AGENT_WORKFORCE_WORKERS = root;
  try {
    fs.rmSync(path.join(agent, '.git'), { recursive: true });
    assert.equal(hooks.ensureHooks(agent, '/opt/node', '/b.js').ok, true, 'ensureHooks does not use the workers ceiling');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_WORKERS; else process.env.AGENT_WORKFORCE_WORKERS = prev;
  }
});

test('#4043: an unchanged entry whose keys are in another order (enabled first) is not rewritten', () => {
  const d = workdir();
  hooks.ensureHooks(d, '/opt/node', '/b.js');
  const file = path.join(d, '.agents', 'hooks.json');
  const entry = readHooks(d)[hooks.HOOK_NAME];
  fs.writeFileSync(file, JSON.stringify({ [hooks.HOOK_NAME]: { enabled: false, ...entry } }));
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(hooks.ensureHooks(d, '/opt/node', '/b.js').changed, false, 'the person\'s file was rewritten with nothing different');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

/* #4043, the 0.7.01 regression: agy 1.2.11's PreToolUse contract, as MEASURED LIVE on 2026-09-27 (real interactive
   agy, the served bridge, a private tmux socket; Ice Cream Kitty on the card). What agy does with a hook's stdout:
     {}                       -> DENIED ("tool call denied by pre-tool hook"), measured
     {"decision":""}          -> DENIED, measured
     {"decision":"allow"}     -> runs; the question is shown and waits for the person, measured
   and, from agy's own hooks guide (decision is REQUIRED): deny denies; ask / force_ask prompt the person first.
   A reply that does not parse, or is not an object, is treated as a deny here (the conservative reading). */
function agyPreToolOutcome(stdout) {
  let o;
  try { o = JSON.parse(String(stdout).trim()); } catch { return 'deny'; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'deny';
  if (o.decision === 'allow') return 'run';
  if (o.decision === 'ask' || o.decision === 'force_ask') return 'prompt';
  return 'deny';   // deny, missing, empty, or unknown
}

test('#4043: agy\'s measured contract: an empty or missing decision DENIES the tool (the model this guard uses)', () => {
  assert.equal(agyPreToolOutcome('{}'), 'deny', 'measured: {} denies');
  assert.equal(agyPreToolOutcome('{"decision":""}'), 'deny', 'measured: an empty decision denies');
  assert.equal(agyPreToolOutcome('{"decision":"allow"}'), 'run', 'measured: allow runs the tool');
  assert.equal(agyPreToolOutcome(''), 'deny');
  /* From agy's guide, NOT measured: ask prompts the person. Load-bearing for the fallback below, so named as such. */
  assert.equal(agyPreToolOutcome('{"decision":"ask"}'), 'prompt', 'guide (unmeasured): ask prompts the person');
});

test('#4043 review 1: an unexpected tool, or no payload, reaching the bridge is NEVER auto-allowed (fails safe to agy\'s prompt)', () => {
  /* The hooks file is read by any agy started in that folder, not only the one the supervisor launches with
     --dangerously-skip-permissions; if PreToolUse's matcher were ignored there, an answer keyed on the event name
     alone would auto-allow every tool. */
  for (const [label, input] of [['run_command', JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf x' } } })],
    ['no payload', ''], ['garbage', 'not json']]) {
    const r = spawnSync(process.execPath, [BRIDGE_FILE, 'PreToolUse'], {
      input, env: { ...process.env, AGENT_WORKFORCE_DATA: path.join(SB, 'data-4796'), KOSMOS_PORT: '9', TMUX_PANE: '%unexp-' + process.pid }, encoding: 'utf8', timeout: 15000,
    });
    try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: '9', TMUX_PANE: '%unexp-' + process.pid }), { force: true }); } catch { /* none */ }
    assert.equal(r.status, 0, label);
    const lines = r.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, label + ': exactly one answer, got ' + JSON.stringify(r.stdout));
    assert.equal(agyPreToolOutcome(lines[0]), 'prompt', label + ': agy would ' + agyPreToolOutcome(lines[0]) + ' on ' + lines[0]);
  }
});

test('#4043: the bridge\'s REAL PreToolUse answer lets agy run ask_question (so {} = deny cannot come back)', () => {
  /* The bytes agy actually reads: the bridge run as agy runs it, not answerFor() called in-process. */
  const r = spawnSync(process.execPath, [BRIDGE_FILE, 'PreToolUse'], {
    input: JSON.stringify({ toolCall: { name: 'ask_question', args: { questions: [{ question: 'Red or blue?' }] } } }),
    env: { ...process.env, AGENT_WORKFORCE_DATA: path.join(SB, 'data-4796'), KOSMOS_PORT: '9', TMUX_PANE: '%contract-' + process.pid },
    encoding: 'utf8', timeout: 15000,
  });
  try { fs.rmSync(bridge.markerFile({ KOSMOS_PORT: '9', TMUX_PANE: '%contract-' + process.pid }), { force: true }); } catch { /* none */ }
  assert.equal(r.status, 0);
  const firstLine = r.stdout.split('\n')[0];
  assert.equal(agyPreToolOutcome(firstLine), 'run',
    `agy would ${agyPreToolOutcome(firstLine)} ask_question on this answer (${JSON.stringify(firstLine)}): the agent could not ask its person anything`);
});

test('#4353 shUnquoteAll inverts shQuote, including a quote and a space in a path', () => {
  const agyhooks = require('./agyhooks');
  const paths = ["/Users/a/Library/Application Support/Kosmos/node", "/tmp/it's here/bridge.js"];
  const cmd = paths.map(agyhooks.shQuote).join(' ') + ' Stop';
  assert.deepEqual(agyhooks.shUnquoteAll(cmd), paths);
  assert.deepEqual(agyhooks.shUnquoteAll('node bridge Stop'), [], 'unquoted words are not paths');
});

/* ---- #4588: Google's shared Antigravity quota ---- */
const QUOTA = 'API error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 24m54s.';

test('#4588: quotaResetMs reads the reset from the quota error, in every unit mix', () => {
  assert.equal(bridge.quotaResetMs(QUOTA), (24 * 60 + 54) * 1000);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED ... Individual quota reached. Resets in 2h50m.'), (2 * 3600 + 50 * 60) * 1000);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED ... quota reached ... Resets in 37m'), 37 * 60 * 1000);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED ... quota reached ... Resets in 1h0m5s'), 3605 * 1000);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED ... quota reached ... Resets in 9s'), 9000);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED ... quota reached ... Resets in 3d4h'), (3 * 86400 + 4 * 3600) * 1000, 'days (review 5)');
});

test('#4588: quotaResetMs is null for anything that is not the quota with a reset', () => {
  // CONTROL arms: another error, the quota with no reset named, a reset with no quota, and junk.
  assert.equal(bridge.quotaResetMs('API error: INTERNAL (code 500)'), null);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED (code 429): Individual quota reached.'), null);
  assert.equal(bridge.quotaResetMs('Something else. Resets in 5m.'), null);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED quota reached Resets in soon'), null);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED quota reached Resets in 0s'), null);
  assert.equal(bridge.quotaResetMs('RESOURCE_EXHAUSTED quota reached Resets in 500ms'), null, 'the m of ms is not minutes (review 1)');
  assert.equal(bridge.quotaResetMs(undefined), null);
  // Review 4: a RESOURCE_EXHAUSTED that is not the quota (a per-minute limit with its own reset) is not the account's
  // shared quota being used up.
  assert.equal(bridge.quotaResetMs('API error: RESOURCE_EXHAUSTED (code 429): Quota exceeded for metric: generate_content_requests, limit: 60 per minute. Resets in 30s.'), null, "Google's real per-minute wording says Quota too (review 5)");
});

test('#4588: a quota stop is still idle, and carries the reset time in until', () => {
  const now = Date.parse('2026-09-28T21:47:00Z');
  const r = bridge.reportFor('Stop', { fullyIdle: true, error: QUOTA }, now);
  assert.equal(r.state, 'idle', 'the loop has ended: idle, never an automatic blocked (#2456 would hold it past the resume)');
  assert.equal(r.until, new Date(now + (24 * 60 + 54) * 1000).toISOString());
  assert.match(r.text, /shared Antigravity quota/);
  assert.match(r.text, /Resets in 24m54s/, "Google's own words are kept");
  // CONTROL: any other errored stop keeps its exact old shape (no until at all).
  assert.deepEqual(bridge.reportFor('Stop', { error: 'boom' }, now), { state: 'idle', text: 'The turn ended with an error: boom' });
});

test('#4588: the report body sends until only when there is one', () => {
  // The sixth argument: the fourth is #4569's `waiting` and the fifth #4612's `final`; a quota stop carries no waiting.
  const b = bridge.buildBody('idle', 'x', {}, undefined, undefined, '2026-09-28T22:11:54.000Z');
  assert.equal(b.until, '2026-09-28T22:11:54.000Z');
  assert.equal('waiting' in b, false, 'the reset was taken for a queue count');
  assert.equal('final' in b, false, 'the reset was taken for an answer');
  // CONTROL (#4612 kept): an answer in the fifth place still travels as final, and alone it sets no until.
  const f = bridge.buildBody('idle', '', {}, null, { text: 'done', startedAt: '2026-09-29T17:00:00.000Z' });
  assert.deepEqual(f.final, { text: 'done', startedAt: '2026-09-29T17:00:00.000Z' });
  assert.equal(f.until, '');
  assert.equal(bridge.buildBody('idle', 'x', {}).until, '');
  // CONTROL (#4569 kept): a queue count still travels, and alone it sets no until.
  const w = bridge.buildBody('working', '', {}, { n: 3, yours: 1 });
  assert.deepEqual(w.waiting, { n: 3, yours: 1 });
  assert.equal(w.until, '');
});

test('#4588: the bridge writes the exact sentence the board keys on (status.QUOTA_REPORT_PREFIX)', () => {
  const r = bridge.reportFor('Stop', { error: QUOTA }, Date.parse('2026-09-28T21:47:00Z'));
  assert.ok(r.text.startsWith(require('./status').QUOTA_REPORT_PREFIX), r.text);
  assert.match(r.until, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the strict ISO form status.js requires');
});

