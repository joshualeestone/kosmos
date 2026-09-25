'use strict';
/**
 * #3734 on Windows: `kosmos agent create` asks for a one-member team (POST /api/team) with the agent's
 * launch token and the long timeout, names the made agent with the board's address, refuses before sending
 * when there is no launch token, and reads a timeout as "may have been made", never as "not made".
 * Driven through main() with its seams (fetch, hook, out/err, url); nothing leaves the process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

function harness({ token = 'abc123', answer, throws } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    hook: { agentToken: () => token, readBoardToken: () => null, resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined, timeout: init.signal });
      if (throws) throw throws;
      const [status, json] = answer();
      return { status, ok: status < 400, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(json), json: async () => json };
    },
  };
  return { io, sent, lines };
}

test('#3734 Windows agent create sends a one-member team with the token and names the made agent with the board link', async () => {
  const h = harness({ answer: () => [200, { outcome: 'created', created: [{ name: 'pm', shownAs: 'PM' }], refused: [] }] });
  const code = await cli.main(['agent', 'create', 'PM', 'pm', 'they asked'], h.io);
  assert.equal(code, 0, h.lines.err.join('\n'));
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].url, /\/api\/team$/);
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], 'abc123');
  assert.deepEqual(h.sent[0].body, { purpose: 'they asked', members: [{ name: 'PM', role: 'pm' }] });
  assert.match(h.lines.out.join('\n'), /Made "PM"\. It's on your board now: http:\/\/127\.0\.0\.1:16180\//);
});

test('#3734 Windows agent create with no launch token refuses before sending anything', async () => {
  const h = harness({ token: null, answer: () => [200, {}] });
  const code = await cli.main(['agent', 'create', 'PM', 'pm'], h.io);
  assert.equal(code, 1);
  assert.equal(h.sent.length, 0, 'a create with no launch token reached the board');
  assert.match(h.lines.err.join('\n'), /no launch token; make the agent from New agent/);
});

test('#3734 Windows agent create reads a timeout as "may have been made", not "not made"', async () => {
  const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError';
  const h = harness({ throws: e });
  const code = await cli.main(['agent', 'create', 'PM', 'pm'], h.io);
  assert.equal(code, 3);
  assert.match(h.lines.err.join('\n'), /may have been made; look at the board before trying again/);
  assert.doesNotMatch(h.lines.err.join('\n'), /could not reach/);
});

test('#3734 Windows agent create says a refused member\'s reason', async () => {
  const h = harness({ answer: () => [400, { outcome: 'refused', created: [], refused: [{ name: 'PM', because: 'there is already an agent called PM' }] }] });
  const code = await cli.main(['agent', 'create', 'PM', 'pm'], h.io);
  assert.equal(code, 1);
  assert.match(h.lines.err.join('\n'), /did not make that agent: there is already an agent called PM/);
});
