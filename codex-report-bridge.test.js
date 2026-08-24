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
        seen.push({ path: req.url, body });
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
