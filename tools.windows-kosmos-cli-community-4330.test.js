'use strict';
/**
 * #4330, the Windows half of #4289: `kosmos community post` carries the words, the topic and the
 * agent token to POST /api/community/post, and says held or published in the Mac's words. The
 * payload and header asserts mirror cli.community-post-4289.test.js. Driven through main() with
 * its seams (fetch, hook, stdin, out/err); nothing leaves the process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const TOKEN = 'ab'.repeat(16);
const RICH = 'We moved invoicing to Tuesdays. `echo PWNED` $HOME "quotes" \\ backslash\n\n- one\n- two';

function harness({ answer = () => [200, { ok: true, status: 'held', id: 'p1' }], throws, stdin = { text: '', ended: true }, env = { TMUX_PANE: '%42' }, token = TOKEN } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env,
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => stdin,
    hook: { agentToken: () => token, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      if (throws) throw throws;
      const [status, json] = answer();
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

test('#4330: a post carries the words as written, the topic, the pane and both tokens, and says it is held', async () => {
  const h = harness();
  const code = await cli.main(['community', 'post', '--topic', 'Weekly ops', RICH], h.io);
  assert.equal(code, 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'POST');
  assert.match(h.sent[0].url, /\/api\/community\/post$/);
  const b = h.sent[0].body;
  assert.equal(b.kind, 'community_post');
  assert.equal(b.body, RICH);
  assert.equal(b.topic, 'Weekly ops');
  assert.equal(b.from_pane, '%42');
  assert.ok(!Number.isNaN(Date.parse(b.at)), 'no timestamp');
  assert.ok(!('agent' in b), 'the CLI named the agent in the body; identity must come from the token');
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(h.sent[0].headers['x-kosmos-board-token'], 'board-tok');
  assert.equal(h.sent[0].headers['content-type'], 'application/json');
  assert.match(h.lines.out.join('\n'), /held until your person releases it/);
});

test('#4330: a piped post and --topic= work, no pane means no from_pane, and a published answer says so', async () => {
  const h = harness({ stdin: { text: RICH + '\r\n', ended: true }, env: {}, answer: () => [200, { ok: true, status: 'published', id: 'p2' }] });
  const code = await cli.main(['community', 'post', '--topic=Hi'], h.io);
  assert.equal(code, 0, h.all());
  assert.equal(h.sent[0].body.body, RICH, 'the piped words did not arrive as written (only the trailing newline goes)');
  assert.equal(h.sent[0].body.topic, 'Hi');
  assert.ok(!('from_pane' in h.sent[0].body));
  assert.deepEqual(h.lines.out, ['Posted to the Kosmos community.']);
});

test('#4330: a refusal from the board is said in its words and exits 1', async () => {
  const h = harness({ answer: () => [403, { error: 'posting to the community feed requires an agent token' }] });
  assert.equal(await cli.main(['community', 'post', 'hello'], h.io), 1);
  assert.match(h.lines.err.join('\n'), /^That was not posted: posting to the community feed requires an agent token\.$/);
});

test('#4330: a 200 that is neither held nor published is not called posted', async () => {
  const h = harness({ answer: () => [200, { ok: true }] });
  assert.equal(await cli.main(['community', 'post', 'hello'], h.io), 1);
  assert.match(h.lines.err.join('\n'), /That was not posted: Kosmos gave an answer we could not read\./);
});

test('#4330: an unreachable board is named with its address; a timeout is a maybe (exit 3), not a failure', async () => {
  const down = harness({ throws: Object.assign(new Error('fetch failed'), { name: 'TypeError' }) });
  assert.equal(await cli.main(['community', 'post', 'hi'], down.io), 1);
  assert.match(down.lines.err.join('\n'), /^We could not reach Kosmos to post that\. Is it running at http:\/\/127\.0\.0\.1:16180\?$/);
  const slow = harness({ throws: Object.assign(new Error('aborted'), { name: 'TimeoutError' }) });
  assert.equal(await cli.main(['community', 'post', 'hi'], slow.io), 3);
  assert.match(slow.lines.err.join('\n'), /may have been made/);
});

test('#4330: usage, empty posts, a bare --topic and --help send nothing', async () => {
  const h = harness({ stdin: { text: '  \n', ended: true } });
  assert.equal(await cli.main(['community'], h.io), 2);
  assert.equal(await cli.main(['community', 'publish', 'x'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /^Usage: kosmos community post \[--topic "<topic>"\] <text> {3}\(or pipe the post in on stdin\)$/m);
  assert.doesNotMatch(h.lines.err.join('\n'), /^Unknown:/m);
  assert.equal(await cli.main(['community', 'post'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /Nothing to post: a community post needs some text/);
  assert.equal(await cli.main(['community', 'post', '--topic'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /^--topic needs a topic\.$/m);
  h.lines.out.length = 0;
  assert.equal(await cli.main(['community', 'post', '--help'], h.io), 0);
  assert.deepEqual(h.lines.out, [cli.USAGE.community]);
  assert.equal(h.sent.length, 0, 'something was posted');
});

test('#4330: a piped post that stopped without ending is refused, not posted in part', async () => {
  const h = harness({ stdin: { text: 'half a thou', ended: false } });
  assert.equal(await cli.main(['community', 'post'], h.io), 2);
  assert.equal(h.sent.length, 0);
  assert.match(h.lines.err.join('\n'), /may be cut short/);
});

test('#4330: a malformed agent token is not sent (the hook keeps hex only, as the Mac does)', async () => {
  const hook = require('./engine/kosmos-report-hook.js');
  const h = harness({ token: hook.agentToken({ KOSMOS_AGENT_TOKEN: 'not-hex; rm -rf' }) });
  assert.equal(await cli.main(['community', 'post', 'hi'], h.io), 0, h.all());
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], undefined);
});
