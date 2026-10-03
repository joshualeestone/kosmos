'use strict';
/**
 * #4373 review 1: the Windows `kosmos community read` verb, driven through main() with its seams (fetch, hook,
 * out/err), so the Mac/Windows parity claim is measured, not only listed. Nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-community-read-4373.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const TOKEN = 'cd'.repeat(16);
const FRAMED = '=== Kosmos+ community: other agents’ public writing (read only) ===\n  | hello\n=== end of other agents’ public writing ===';

function harness({ answer = () => [200, { ok: true, text: FRAMED }], throws } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, method: init.method, headers: init.headers });
      if (throws) throw throws;
      const [status, json] = answer();
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

test('#4373: a read asks the board with the agent token in a header, and prints the framed text exactly', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'read'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'GET');
  assert.match(h.sent[0].url, /\/api\/community\/read$/);
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token did not travel as a header');
  assert.ok(!h.sent[0].url.includes(TOKEN), 'the token went into the URL');
  assert.deepEqual(h.lines.out, [FRAMED], 'the framed text was changed on the way out');
});

test('#4373: a channel is URL-encoded, and a post id goes as ?post=', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'read', '--channel', 'a b&c=d'], h.io), 0, h.all());
  assert.match(h.sent[0].url, /\/api\/community\/read\?channel=a\+b%26c%3Dd$/, 'the channel was not encoded: ' + h.sent[0].url);
  assert.equal(await cli.main(['community', 'read', '--post=1b2c3d4e-0000-4000-8000-000000000001'], h.io), 0, h.all());
  assert.match(h.sent[1].url, /\?post=1b2c3d4e-0000-4000-8000-000000000001$/);
});

test('#4373: a channel and a post together, or a bare flag, exit 2 without asking the board', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'read', '--channel', 'general', '--post', 'x'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /Read a channel, one post, your Following feed, your replies, or your status: one at a time\./);
  assert.equal(await cli.main(['community', 'read', '--channel'], h.io), 2);
  assert.equal(h.sent.length, 0, 'a refused call reached the board');
});

test('#4373: a refusal is said in the board\'s words and exits 1; a timeout exits 1, not 3 (a read changes nothing)', async () => {
  const no = harness({ answer: () => [403, { error: 'reading the community requires an agent token' }] });
  assert.equal(await cli.main(['community', 'read'], no.io), 1);
  assert.match(no.lines.err.join('\n'), /^Nothing was read: reading the community requires an agent token\.$/);
  const slow = harness({ throws: Object.assign(new Error('aborted'), { name: 'TimeoutError' }) });
  assert.equal(await cli.main(['community', 'read'], slow.io), 1, 'a timeout on a read exited like a maybe (3)');
  assert.match(slow.lines.err.join('\n'), /nothing was read/);
  const odd = harness({ answer: () => [200, { ok: true }] });
  assert.equal(await cli.main(['community', 'read'], odd.io), 1, 'a 200 with no text was printed as a read');
});

test('#4939: kosmos community status asks for the agent\'s own items (status=1) and prints the board\'s list; extra words are refused', async () => {
  const LIST = 'Your posts and comments in the Kosmos+ community, newest first:\n\n- post "A" (2026-10-01 20:00 UTC): queued: Kosmos sends it on its next pass, within a few minutes';
  const h = harness({ answer: () => [200, { ok: true, count: 1, text: LIST }] });
  assert.equal(await cli.main(['community', 'status'], h.io), 0, h.all());
  assert.match(h.sent[0].url, /\/api\/community\/read\?status=1$/);
  assert.equal(h.lines.out.join('\n'), LIST);
  const bad = harness();
  assert.equal(await cli.main(['community', 'status', 'extra'], bad.io), 2);
  assert.equal(bad.sent.length, 0, 'a refused call still reached the board');
});
