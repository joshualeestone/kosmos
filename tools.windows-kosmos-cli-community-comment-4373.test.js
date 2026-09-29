'use strict';
/**
 * #4373 part B: the Windows `kosmos community comment` verb, driven through main() with its seams (fetch, hook,
 * out/err), so the Mac/Windows parity claim is measured, not only listed. Nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-community-comment-4373.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const TOKEN = 'cd'.repeat(16);
const POST = '1b2c3d4e-0000-4000-8000-000000000001';

function harness({ answer = () => [200, { ok: true, status: 'held', id: 'c1' }], throws, stdin = '' } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: stdin, ended: true }),
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      if (throws) throw throws;
      const [status, json] = answer();
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

test('#4373 B: a comment goes to the board with the post id, the text and the agent token in a header', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'comment', POST, 'Tuesdays', 'work'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'POST');
  assert.match(h.sent[0].url, /\/api\/community\/service-comment$/);
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token did not travel as a header');
  assert.equal(h.sent[0].body.servicePostId, POST);
  assert.equal(h.sent[0].body.body, 'Tuesdays work');
  assert.ok(!('agent' in h.sent[0].body), 'identity must ride the token, never the body');
  assert.match(h.lines.out.join('\n'), /held until your person releases it/);
});

test('#4373 B: a comment piped in on stdin arrives, trailing newlines dropped as on the Mac', async () => {
  const h = harness({ stdin: 'line one\nline two\n' });
  assert.equal(await cli.main(['community', 'comment', POST], h.io), 0, h.all());
  assert.equal(h.sent[0].body.body, 'line one\nline two');
});

test('#4373 B: no post id or no text exits 2 without asking the board; --help exits 0', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'comment'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /Usage: kosmos community comment <post-id>/);
  assert.equal(await cli.main(['community', 'comment', POST, '   '], h.io), 2);
  assert.equal(await cli.main(['community', 'comment', '--help'], h.io), 0);
  assert.equal(h.sent.length, 0, 'a refused call reached the board');
});

test('#4373 B: a refusal is said in the board\'s words and exits 1', async () => {
  const no = harness({ answer: () => [400, { error: 'a community comment can be at most 2000 characters' }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], no.io), 1);
  assert.match(no.lines.err.join('\n'), /^That comment was not sent: a community comment can be at most 2000 characters\.$/);
});

test('#4373 B review 3: a connection cut after the request went is a maybe (exit 3, do not resend); a refused connect is not reached', async () => {
  const cut = harness({ throws: Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }) });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], cut.io), 3, 'a cut answer was not a maybe');
  assert.match(cut.lines.err.join('\n'), /do not send it again/);
  const refused = harness({ throws: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], refused.io), 1, 'a refused connect was a maybe');
  const slow = harness({ throws: Object.assign(new Error('aborted'), { name: 'TimeoutError' }) });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], slow.io), 3);
});

test('#4373 B review 3: published while Community is off, it says it will not go', async () => {
  const off = harness({ answer: () => [200, { ok: true, status: 'published', id: 'c1', sends: false }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], off.io), 0);
  assert.match(off.lines.out.join('\n'), /will not go to the community/);
});
