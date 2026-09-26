'use strict';

/**
 * The grok report bridge (#3391), the stdin analog of gemini-report-bridge.test.js /
 * codex-report-bridge.test.js. Grok drives its hooks with the event as JSON on STDIN
 * (the gemini/claude shape, not codex's argv), so this drives the bridge the same way:
 * a child process fed the event on stdin, against a stub board capturing the POST. Same
 * contract as the sibling bridges: one event in, one honest report out carrying the
 * pane identity, the launch/board tokens and the world header, and NEVER a failure the
 * agent can feel (exit 0 always).
 */

const test = require('node:test');
const store = require('./engine/store');
const assert = require('node:assert/strict');
const http = require('node:http');
const nodePath = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const fsB = require('node:fs');
const osB = require('node:os');

const BRIDGE = nodePath.join(__dirname, 'bin', 'grok-report-bridge.js');

/** Run the bridge once against a stub board, feeding the event on STDIN; return
 * what the board saw. Async spawn (not spawnSync) for the same #2895 reason the
 * gemini/codex tests document: the bridge's fetch hits the stub running in THIS
 * process, so a synchronous spawn that blocks the event loop makes delivery flaky.
 * The child exits only after its fetch settles, and the handler pushes to `seen`
 * before responding, so awaiting the child's close is a sufficient barrier. */
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
        if (code !== 0) { server.close(() => reject(new Error('bridge exited ' + code))); return; }
        server.close(() => resolve(seen));
      });
      child.stdin.end(eventJson);
    });
  });
}

test('Stop reports idle, with the last words (lastAssistantMessage) and the pane identity', async () => {
  const seen = await drive(JSON.stringify({
    hook_event_name: 'Stop', reason: 'end_turn', lastAssistantMessage: 'the thing is done',
  }));
  assert.equal(seen.length, 1, 'exactly one report per turn');
  assert.equal(seen[0].path, '/api/report');
  const body = JSON.parse(seen[0].body);
  assert.equal(body.state, 'idle');
  assert.equal(body.text, 'the thing is done', 'grok carries the last words as lastAssistantMessage');
  assert.equal(body.from_pane, '%77', 'the pane identity is the evidence property; it must travel');
});

test('each lifecycle event maps to its state, over stdin, end to end', async () => {
  const cases = [
    [{ hook_event_name: 'SessionStart', source: 'new' }, 'started'],
    [{ hook_event_name: 'UserPromptSubmit', prompt: 'go' }, 'working'],
    [{ hook_event_name: 'SessionEnd', reason: 'quit' }, 'stopped'],
  ];
  for (const [evt, want] of cases) {
    const seen = await drive(JSON.stringify(evt));
    assert.equal(seen.length, 1, `${evt.hook_event_name} reported nothing`);
    assert.equal(JSON.parse(seen[0].body).state, want);
  }
});

test('#249: an interrupted or API-failed turn reports idle, so an agent never sticks on "working"', async () => {
  // StopCancelled fires INSTEAD of Stop on interrupt/declined/max-turns (measured:
  // reason "user_interrupt"); StopFailure on an API error. Both MUST map to a
  // non-working state or an interrupted grok agent shows "working" forever -- the
  // #249 "looks fine but is stuck" failure the whole self-report path exists to kill.
  const cancelled = await drive(JSON.stringify({ hook_event_name: 'StopCancelled', reason: 'user_interrupt' }));
  assert.equal(cancelled.length, 1, 'StopCancelled reported nothing, so an interrupted agent sticks on working');
  assert.equal(JSON.parse(cancelled[0].body).state, 'idle');
  const failed = await drive(JSON.stringify({ hook_event_name: 'StopFailure', reason: 'api_error' }));
  assert.equal(failed.length, 1, 'StopFailure reported nothing');
  assert.equal(JSON.parse(failed[0].body).state, 'idle');
});

test('#4006: a Notification reports NOTHING, so a quiet grok agent is never painted needs_you (and never auto-restarted)', async () => {
  // Measured on a real agent 2026-09-26: under --always-approve grok fires Notification about a minute after a
  // turn ends, message "Waiting for your next prompt". It is not a permission prompt, and reported as needs_you
  // it got a healthy agent restarted by the class-1 handler.
  const waiting = await drive(JSON.stringify({ hook_event_name: 'Notification', message: 'Waiting for your next prompt', notification_type: 'idle' }));
  assert.equal(waiting.length, 0, 'the turn-end Notification was reported: ' + JSON.stringify(waiting));
  const other = await drive(JSON.stringify({ hook_event_name: 'Notification', message: 'Tool X requires execution' }));
  assert.equal(other.length, 0, 'a Notification is never a permission prompt under always-approve, so none is reported');
  // CONTROL: the same harness does report a mapped event, so the empty results above are not a dead harness.
  const stop = await drive(JSON.stringify({ hook_event_name: 'Stop', reason: 'end_turn', lastAssistantMessage: 'done' }));
  assert.equal(stop.length, 1);
  assert.equal(JSON.parse(stop[0].body).state, 'idle');
});

test('an event we do not map reports nothing, and neither does garbage stdin', async () => {
  // Grok DOES fire PreToolUse/PostToolUse (measured), but the bridge maps neither, so
  // they report nothing -- the "observe, don't invent" rule, tested against a real
  // grok event rather than an imaginary one.
  const preTool = await drive(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'run_terminal_command' }));
  assert.equal(preTool.length, 0, 'unmapped events are ignored, not guessed at');
  const unknown = await drive(JSON.stringify({ hook_event_name: 'NoSuchEvent' }));
  assert.equal(unknown.length, 0);
  const garbage = await drive('this is not json {');
  assert.equal(garbage.length, 0);
  const empty = await drive('');
  assert.equal(empty.length, 0, 'no stdin at all reports nothing');
});

test('a board that is down never becomes a failure the agent can feel', () => {
  // No server at this port; the bridge must exit 0 regardless. spawnSync is fine here
  // (no in-process server to service), and a non-zero status IS the failure.
  const r = spawnSync(process.execPath, [BRIDGE], {
    input: JSON.stringify({ hook_event_name: 'Stop', reason: 'end_turn', lastAssistantMessage: 'x' }),
    env: { ...process.env, KOSMOS_PORT: '1', TMUX_PANE: '%1' },
  });
  assert.equal(r.status, 0, 'the bridge must exit 0 even when the board is unreachable');
});

test('#1456: an auto turn-complete report cannot erase a standing block', async () => {
  const seen = await drive(JSON.stringify({ hook_event_name: 'Stop', reason: 'end_turn', lastAssistantMessage: 'done' }));
  assert.equal(seen.length, 1);
  const body = JSON.parse(seen[0].body);
  assert.equal(body.auto, true, 'without auto:true the route sends auto:false and a blocked filed during the turn is erased by the turn ending (#900/#1456)');
  assert.equal(typeof body.auto, 'boolean', 'the route reads body.auto === true, so a truthy non-boolean is a false');
});

const TURN = JSON.stringify({ hook_event_name: 'Stop', reason: 'end_turn', lastAssistantMessage: 'done' });

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
  const data = fsB.mkdtempSync(nodePath.join(osB.tmpdir(), 'aw-3391-bridge-'));
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
  const none = fsB.mkdtempSync(nodePath.join(osB.tmpdir(), 'aw-3391-bridge-none-'));
  try {
    const seen = await drive(TURN, { AGENT_WORKFORCE_DATA: none });
    assert.equal(seen[0].headers['x-kosmos-board-token'], undefined, 'no token file, so no board-token header may be sent');
  } finally {
    fsB.rmSync(none, { recursive: true, force: true });
  }
});

test('#1704: the bridge names this agent\'s Kosmos, and says default when KOSMOS_WORLD is absent', async () => {
  const { WORLD_HEADER } = require('./engine/launchidentity');
  const data = fsB.mkdtempSync(nodePath.join(osB.tmpdir(), 'aw-3391-world-'));
  try {
    const named = await drive(TURN, { AGENT_WORKFORCE_DATA: data, KOSMOS_WORLD: 'test' });
    assert.equal(named[0].headers[WORLD_HEADER], 'test');
    const plain = await drive(TURN, { AGENT_WORKFORCE_DATA: data, KOSMOS_WORLD: '' });
    assert.equal(plain[0].headers[WORLD_HEADER], 'default');
  } finally {
    fsB.rmSync(data, { recursive: true, force: true });
  }
});

test('#3391: a snake_case last_assistant_message is accepted as the idle text too', async () => {
  // The measured Stop payload carries lastAssistantMessage (camelCase); the bridge also
  // accepts a snake_case spelling in case a future grok build adds one, so pin both.
  const seen = await drive(JSON.stringify({ hook_event_name: 'Stop', reason: 'end_turn', last_assistant_message: 'snake words' }));
  assert.equal(JSON.parse(seen[0].body).text, 'snake words');
});
