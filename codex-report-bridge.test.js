'use strict';

/**
 * The codex notify bridge (#245 on #526): one observed event in, one
 * honest report out, carrying the pane identity, and never a failure the
 * agent can feel. Driven as codex drives it — a child process with one
 * JSON argument — against a stub board capturing the POST.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const BRIDGE = nodePath.join(__dirname, 'bin', 'codex-report-bridge.js');

/** Run the bridge once against a stub board; return what the board saw. */
function drive(eventJson, env = {}) {
  return new Promise((resolve) => {
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
      execFileSync(process.execPath, [BRIDGE, eventJson], {
        env: { ...process.env, KOSMOS_PORT: String(port), TMUX_PANE: '%77', ...env },
      });
      // The bridge's fetch is async past main(); give it a beat, then close.
      setTimeout(() => server.close(() => resolve(seen)), 300);
    });
  });
}

test('a completed turn reports idle, with the last words and the pane identity', async () => {
  const seen = await drive(JSON.stringify({
    type: 'agent-turn-complete',
    'thread-id': 't', 'turn-id': 'u', cwd: '/x', client: 'codex-tui',
    'input-messages': ['do the thing'],
    'last-assistant-message': 'the thing is done',
  }));
  assert.equal(seen.length, 1, 'exactly one report per turn');
  assert.equal(seen[0].path, '/api/report');
  const body = JSON.parse(seen[0].body);
  assert.equal(body.state, 'idle');
  assert.equal(body.text, 'the thing is done');
  assert.equal(body.from_pane, '%77', 'the pane identity is the evidence property; it must travel');
});

test('an event we have not observed reports nothing, and neither does garbage', async () => {
  const unknown = await drive(JSON.stringify({ type: 'approval-requested', anything: true }));
  assert.equal(unknown.length, 0, 'unobserved events are ignored, not guessed at');
  const garbage = await drive('this is not json {');
  assert.equal(garbage.length, 0);
});

test('a board that is down never becomes a failure the agent can feel', () => {
  // No server at this port; the bridge must exit 0 regardless (execFileSync
  // throws on non-zero, so completing IS the assertion).
  execFileSync(process.execPath, [BRIDGE, JSON.stringify({ type: 'agent-turn-complete', 'last-assistant-message': 'x' })], {
    env: { ...process.env, KOSMOS_PORT: '1', TMUX_PANE: '%1' },
  });
  assert.ok(true);
});


/* ------------------------------------------------------------------ #1139
 * LINK 3. The supervisor mints a token into the pane environment and, until
 * now, nothing read it.
 *
 * \U0001f6d1 THE SILENT ARM MATTERS MORE THAN THE SENDING ONE. `/api/report` does
 * not downgrade: a presented token DECIDES, so a malformed or absent-but-sent
 * value turns a working pane-derived report into a refusal the agent cannot
 * feel. Every agent already running was launched without a token, so "sends
 * nothing" is the common case and the one that must not regress.
 * -------------------------------------------------------------------------- */

const TURN = JSON.stringify({
  type: 'agent-turn-complete',
  'thread-id': 't', 'turn-id': 'u', cwd: '/x', client: 'codex-tui',
  'input-messages': ['go'], 'last-assistant-message': 'done',
});

test('#1139: the launch token rides as the sender header when the pane has one', async () => {
  const tok = 'a'.repeat(64);
  const seen = await drive(TURN, { KOSMOS_AGENT_TOKEN: tok });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], tok, 'the token did not reach the board');
  /* The pane still travels. The route prefers the token and this is not an
     either/or: dropping the pane would strand every agent whose token does
     not resolve, on the one path that has no other identity. */
  assert.equal(JSON.parse(seen[0].body).from_pane, '%77', 'the pane identity stopped travelling');
});

test('#1139: no token in the pane means no header, so an agent running today reports exactly as before', async () => {
  const seen = await drive(TURN, { KOSMOS_AGENT_TOKEN: '' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers['x-kosmos-agent-token'], undefined,
    'an empty token was presented as a header, and the route does not downgrade, so this report would be refused');
});

test('#1139: a malformed token is not presented, because presenting it would REFUSE the report', async () => {
  for (const bad of ['not-hex', 'ABCDEF', 'deadbeef warning: something', ' ']) {
    const seen = await drive(TURN, { KOSMOS_AGENT_TOKEN: bad });
    assert.equal(seen.length, 1, `nothing was reported at all for ${JSON.stringify(bad)}`);
    assert.equal(seen[0].headers['x-kosmos-agent-token'], undefined,
      `${JSON.stringify(bad)} was presented as a token; the route would refuse the report rather than fall back to the pane`);
  }
});

test('#1456: the turn-complete report says the MACHINE wrote it, so it cannot erase a standing block', async () => {
  const seen = await drive(JSON.stringify({
    type: 'agent-turn-complete', 'last-assistant-message': 'the thing is done',
  }));
  assert.equal(seen.length, 1, 'the control: the bridge did report at all');
  const body = JSON.parse(seen[0].body);
  assert.equal(body.auto, true,
    'agent-turn-complete is the Codex analogue of Claude\'s Stop hook: it fires '
    + 'at the end of EVERY turn. Without this the route sends auto:false, #900\'s '
    + 'guard is never entered, and a `blocked` the agent filed DURING the turn is '
    + 'erased by its own turn ending. #900 was fixed on the Claude path and the '
    + 'fix was a flag a caller has to remember; this is the caller that forgot.');
  assert.equal(typeof body.auto, 'boolean',
    'the route reads `body.auto === true`, so a truthy non-boolean is a false');
});
