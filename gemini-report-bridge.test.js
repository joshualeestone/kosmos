'use strict';

/**
 * The gemini report bridge (#3296), the stdin analog of codex-report-bridge.test.js.
 * Gemini drives its hooks with the event as JSON on STDIN (not argv, which is codex's
 * shape), so this drives the bridge the same way: a child process fed the event on
 * stdin, against a stub board capturing the POST. Same contract as the codex bridge:
 * one event in, one honest report out carrying the pane identity, the launch/board
 * tokens and the world header, and NEVER a failure the agent can feel (exit 0 always).
 */

const test = require('node:test');
const store = require('./engine/store');
const assert = require('node:assert/strict');
const http = require('node:http');
const nodePath = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const fsB = require('node:fs');
const osB = require('node:os');

const BRIDGE = nodePath.join(__dirname, 'bin', 'gemini-report-bridge.js');

/** Run the bridge once against a stub board, feeding the event on STDIN; return
 * what the board saw. Async spawn (not spawnSync) for the same #2895 reason the
 * codex test documents: the bridge's fetch hits the stub running in THIS process,
 * so a synchronous spawn that blocks the event loop makes delivery flaky. The child
 * exits only after its fetch settles, and the handler pushes to `seen` before
 * responding, so awaiting the child's close is a sufficient barrier. */
function drive(eventJson, env = {}) {
  return new Promise((resolve, reject) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        seen.push({ path: req.url, body, headers: req.headers });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"recorded":true}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const child = spawn(process.execPath, [BRIDGE], {
        env: { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%77', ...env },
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      child.on('error', (err) => server.close(() => reject(err)));
      child.on('close', (code) => {
        // The bridge's cardinal rule is exit 0 no matter what; a non-zero exit is a
        // real regression worth surfacing.
        if (code !== 0) { server.close(() => reject(new Error('bridge exited ' + code))); return; }
        server.close(() => resolve(seen));
      });
      child.stdin.end(eventJson);
    });
  });
}

test('AfterAgent reports idle, with the last words and the pane identity', async () => {
  const seen = await drive(JSON.stringify({
    hook_event_name: 'AfterAgent', prompt: 'do the thing', prompt_response: 'the thing is done',
  }));
  assert.equal(seen.length, 1, 'exactly one report per turn');
  assert.equal(seen[0].path, '/api/report');
  const body = JSON.parse(seen[0].body);
  assert.equal(body.state, 'idle');
  assert.equal(body.text, 'the thing is done');
  assert.equal(body.from_pane, '%77', 'the pane identity is the evidence property; it must travel');
});

test('each lifecycle event maps to its state, over stdin, end to end', async () => {
  const cases = [
    [{ hook_event_name: 'SessionStart', source: 'startup' }, 'started'],
    [{ hook_event_name: 'BeforeAgent', prompt: 'go' }, 'working'],
    [{ hook_event_name: 'SessionEnd', reason: 'quit' }, 'stopped'],
  ];
  for (const [evt, want] of cases) {
    const seen = await drive(JSON.stringify(evt));
    assert.equal(seen.length, 1, `${evt.hook_event_name} reported nothing`);
    assert.equal(JSON.parse(seen[0].body).state, want);
  }
});

test('Notification reports needs_you carrying a reason, so the route does not drop it', async () => {
  const withMsg = await drive(JSON.stringify({ hook_event_name: 'Notification', message: 'Tool X requires execution' }));
  assert.equal(JSON.parse(withMsg[0].body).state, 'needs_you');
  assert.equal(JSON.parse(withMsg[0].body).text, 'Tool X requires execution');
  // A Notification with no message still carries a non-empty reason (selfreport.js
  // refuses a needs_you with no reason/on/owner, so an empty one would be dropped).
  const noMsg = await drive(JSON.stringify({ hook_event_name: 'Notification' }));
  assert.equal(JSON.parse(noMsg[0].body).state, 'needs_you');
  assert.ok(JSON.parse(noMsg[0].body).text.length > 0, 'a needs_you with no reason would be refused by the route');
});

test('an event we have not observed reports nothing, and neither does garbage stdin', async () => {
  const unknown = await drive(JSON.stringify({ hook_event_name: 'BeforeTool', tool_name: 'x' }));
  assert.equal(unknown.length, 0, 'unobserved events are ignored, not guessed at');
  const stop = await drive(JSON.stringify({ hook_event_name: 'Stop' }));
  assert.equal(stop.length, 0, 'gemini rejects "Stop"; the bridge never maps it');
  const garbage = await drive('this is not json {');
  assert.equal(garbage.length, 0);
  const empty = await drive('');
  assert.equal(empty.length, 0, 'no stdin at all reports nothing');
});

test('a board that is down never becomes a failure the agent can feel', () => {
  // No server at this port; the bridge must exit 0 regardless. spawnSync is fine here
  // (no in-process server to service), and a non-zero status IS the failure.
  const r = spawnSync(process.execPath, [BRIDGE], {
    input: JSON.stringify({ hook_event_name: 'AfterAgent', prompt_response: 'x' }),
    env: { ...process.env, KOSMOS_PORT: '1', TMUX_PANE: '%1' },
  });
  assert.equal(r.status, 0, 'the bridge must exit 0 even when the board is unreachable');
});

test('#1456: an auto turn-complete report cannot erase a standing block', async () => {
  const seen = await drive(JSON.stringify({ hook_event_name: 'AfterAgent', prompt_response: 'done' }));
  assert.equal(seen.length, 1);
  const body = JSON.parse(seen[0].body);
  assert.equal(body.auto, true, 'without auto:true the route sends auto:false and a blocked filed during the turn is erased by the turn ending (#900/#1456)');
  assert.equal(typeof body.auto, 'boolean', 'the route reads body.auto === true, so a truthy non-boolean is a false');
});

const TURN = JSON.stringify({ hook_event_name: 'AfterAgent', prompt: 'go', prompt_response: 'done' });

test('the launch token rides as the sender header when the pane has one', async () => {
  const tok = 'a'.repeat(64);
  const seen = await drive(TURN, { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(seen[0].headers['x-kosmos-agent-token'], tok, 'the token did not reach the board');
  assert.equal(JSON.parse(seen[0].body).from_pane, '%77', 'the pane identity stopped travelling');
});

test('no token means no header, and a malformed token is not presented (the route does not downgrade)', async () => {
  const none = await drive(TURN, { KOSMOS_AGENT_TOKEN: '' });
  assert.equal(none[0].headers['x-kosmos-agent-token'], undefined, 'an empty token must not be presented as a header');
  for (const bad of ['not-hex', 'ABCDEF', 'deadbeef warning: x', ' ']) {
    const seen = await drive(TURN, { KOSMOS_AGENT_TOKEN: bad });
    assert.equal(seen.length, 1, `nothing reported for ${JSON.stringify(bad)}`);
    assert.equal(seen[0].headers['x-kosmos-agent-token'], undefined,
      `${JSON.stringify(bad)} was presented; the route would refuse rather than fall back to the pane`);
  }
});

test('#1968: the board token is presented when the board wrote one, and omitted when not', async () => {
  const data = fsB.mkdtempSync(nodePath.join(osB.tmpdir(), 'aw-3296-bridge-'));
  try {
    const root = nodePath.join(data, store.APP);
    fsB.mkdirSync(root, { recursive: true });
    fsB.writeFileSync(nodePath.join(root, 'board.token'), 'abc123boardtoken');
    const withTok = await drive(TURN, { AGENT_WORKFORCE_DATA: data });
    assert.equal(withTok[0].headers['x-kosmos-board-token'], 'abc123boardtoken',
      'the board token did not reach the board, so an enforcing board would refuse the self-report');
  } finally {
    fsB.rmSync(data, { recursive: true, force: true });
  }
  const none = fsB.mkdtempSync(nodePath.join(osB.tmpdir(), 'aw-3296-bridge-none-'));
  try {
    const seen = await drive(TURN, { AGENT_WORKFORCE_DATA: none });
    assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'no token file, so no board-token header may be sent');
  } finally {
    fsB.rmSync(none, { recursive: true, force: true });
  }
});

test('#1704: the bridge names this agent\'s Kosmos, and says default when KOSMOS_WORLD is absent', async () => {
  const { WORLD_HEADER } = require('./engine/launchidentity');
  const data = fsB.mkdtempSync(nodePath.join(osB.tmpdir(), 'aw-3296-world-'));
  try {
    const named = await drive(TURN, { AGENT_WORKFORCE_DATA: data, KOSMOS_WORLD: 'test' });
    assert.equal(named[0].headers[WORLD_HEADER], 'test');
    const plain = await drive(TURN, { AGENT_WORKFORCE_DATA: data, KOSMOS_WORLD: '' });
    assert.equal(plain[0].headers[WORLD_HEADER], 'default');
  } finally {
    fsB.rmSync(data, { recursive: true, force: true });
  }
});
