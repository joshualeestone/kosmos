'use strict';
/**
 * #4451, the Windows half: `kosmos connections` and `kosmos connect <service>` in
 * tools/windows/kosmos-cli.js, mirroring cli.connections-4451.test.js for install/kosmos.
 * Driven through main() with its seams (fetch, hook, stdin, out/err); nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-connections-4451.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const SECRET = 'brv_' + 'x9'.repeat(20);

function harness({ answer = () => [200, {}], throws, stdin = { text: '', ended: true } } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => stdin,
    hook: { agentToken: () => 'agent-tok', readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, method: init.method, headers: init.headers, rawBody: init.body, body: init.body ? JSON.parse(init.body) : undefined });
      if (throws) throw throws;
      const [status, json] = answer(u);
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

const HELD = { services: [
  { name: 'GitHub', how: 'sign-in', held: null },
  { name: 'Cloudflare', how: 'token', held: true, connect: 'cloudflare' },
  { name: 'Brave Search', how: 'token', held: false, connect: 'brave-search' },
  { name: 'GitHub2', how: 'sign-in', held: true },
] };

test('#4451: kosmos connections reads the cheap route with the board token only, never the live sweep, and says each state', async () => {
  const h = harness({ answer: () => [200, HELD] });
  assert.equal(await cli.main(['connections'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'GET');
  assert.match(h.sent[0].url, /\/api\/connections\/held$/);
  assert.equal(h.sent[0].headers['x-kosmos-board-token'], 'board-tok');
  assert.ok(!('x-kosmos-agent-token' in h.sent[0].headers), 'the agent token was sent to a board-token route');
  const out = h.lines.out.join('\n');
  assert.match(out, /^GitHub: not known without a live check/m);
  assert.match(out, /^Cloudflare: connected \(a token is stored; .*replace it with: kosmos connect cloudflare\)$/m);
  assert.match(out, /^Brave Search: not connected \(store the token the person gives you with: kosmos connect brave-search\)$/m);
  assert.match(out, /^GitHub2: connected \(signed in through Kosmos\)$/m);
});

test('#4451: kosmos connections says so when the board is unreachable, refuses, or answers something unreadable', async () => {
  const down = harness({ throws: new Error('ECONNREFUSED') });
  assert.equal(await cli.main(['connections'], down.io), 1);
  assert.match(down.all(), /could not reach Kosmos to read what is connected/);
  const refused = harness({ answer: () => [403, { error: 'cross-site read refused' }] });
  assert.equal(await cli.main(['connections'], refused.io), 1);
  assert.match(refused.all(), /refused that request: cross-site read refused\./);
  const odd = harness({ answer: () => [200, { nope: 1 }] });
  assert.equal(await cli.main(['connections'], odd.io), 1);
  assert.match(odd.all(), /could not read about what is connected/);
});

test('#4451: kosmos connect sends exactly the stdin token, in the body, to the service door, and says it connected', async () => {
  const h = harness({ stdin: { text: SECRET + '\r\n', ended: true }, answer: () => [200, { connected: true, service: 'Brave Search' }] });
  assert.equal(await cli.main(['connect', 'brave-search'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'POST');
  assert.match(h.sent[0].url, /\/api\/svc\/brave-search\/token$/);
  assert.deepEqual(h.sent[0].body, { token: SECRET });
  assert.ok(!('x-kosmos-agent-token' in h.sent[0].headers));
  assert.deepEqual(h.lines.out, ['Connected Brave Search. Its row in Settings > Connections shows it.']);
  assert.ok(!h.all().includes(SECRET), 'the token was printed');
});

test('#4451: cloudflare goes to its own door and is named Cloudflare', async () => {
  const h = harness({ stdin: { text: SECRET, ended: true }, answer: () => [200, { refused: 'Cloudflare did not accept that token' }] });
  assert.equal(await cli.main(['connect', 'cloudflare'], h.io), 1);
  assert.match(h.sent[0].url, /\/api\/cloudflare\/token$/);
  assert.equal(h.lines.err.join('\n'), 'Not connected: Cloudflare did not accept that token');
  const nodoor = harness({ stdin: { text: SECRET, ended: true }, answer: () => [404, { error: 'no such door' }] });
  assert.equal(await cli.main(['connect', 'cloudflare'], nodoor.io), 1);
  assert.match(nodoor.all(), /^Kosmos has no door for Cloudflare\. kosmos connections lists/);
});

test('#4451: a token given as an ARGUMENT, an empty stdin, a cut-off stdin or a bad name sends NOTHING', async () => {
  const cases = [
    [['connect', 'brave-search', SECRET], { text: '', ended: true }, /on stdin, not as an argument/],
    [['connect', 'brave-search'], { text: '  \n', ended: true }, /the token on stdin was empty/],
    [['connect', 'brave-search'], { text: '', ended: false }, /the token on stdin was empty/],
    [['connect', 'brave-search'], { text: SECRET.slice(0, 10), ended: false }, /stopped arriving without ending/],
    [['connect', 'brave-search'], { text: '', ended: false, overflow: true }, /too long to be a token/],
    [['connect'], { text: SECRET, ended: true }, /^Which service\?/],
    [['connect', '../../api/x'], { text: SECRET, ended: true }, /^Which service\?/],
    [['connect', 'Brave'], { text: SECRET, ended: true }, /^Which service\?/],
  ];
  for (const [argv, stdin, said] of cases) {
    const h = harness({ stdin, answer: () => [200, { connected: true }] });
    assert.equal(await cli.main(argv, h.io), 2, argv.join(' '));
    assert.equal(h.sent.length, 0, 'kosmos ' + argv.join(' ') + ' SENT a request');
    assert.match(h.lines.err.join('\n'), said, argv.join(' '));
  }
  /* CONTROL: the same harness with a good token and name does send, so the zeros above are refusals. */
  const control = harness({ stdin: { text: SECRET, ended: true }, answer: () => [200, { connected: true }] });
  assert.equal(await cli.main(['connect', 'brave-search'], control.io), 0);
  assert.equal(control.sent.length, 1);
});

test('#4451: a timeout is a maybe (exit 3) that names how to check; an unreachable board is 1', async () => {
  const slow = harness({ stdin: { text: SECRET, ended: true }, throws: Object.assign(new Error('t'), { name: 'TimeoutError' }) });
  assert.equal(await cli.main(['connect', 'exa'], slow.io), 3);
  assert.match(slow.all(), /may have connected; check with: kosmos connections/);
  const down = harness({ stdin: { text: SECRET, ended: true }, throws: new Error('ECONNREFUSED') });
  assert.equal(await cli.main(['connect', 'exa'], down.io), 1);
  assert.match(down.all(), /nothing was connected/);
});
