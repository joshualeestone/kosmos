'use strict';
/**
 * #5574: the Windows `kosmos community withdraw <post|comment> <id>` verb, driven through main() with its seams (fetch,
 * hook, out/err), so the Mac/Windows parity claim is measured, not only listed: the same request and the same words as
 * install/kosmos's cmd_community_withdraw (cli.community-withdraw-5574.test.js). Nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-community-withdraw-5574.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const TOKEN = 'ab'.repeat(16);

const realFetch = globalThis.fetch;
let escaped = 0;
test.before(() => { globalThis.fetch = async () => { escaped += 1; throw new Error('a request left the test seam'); }; });
test.after(() => { globalThis.fetch = realFetch; });

function harness({ answer = () => [200, { ok: true, kind: 'comment', state: 'sent' }], env = { TMUX_PANE: '%42' } } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env,
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const [status, json] = answer();
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

const ID = '11111111-2222-4333-8444-555555555555';

test('#5574: withdraw sends POST /api/community/service-withdraw with {kind, id}, the pane and the agent token', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'withdraw', 'comment', ID], h.io), 0, h.all());
  assert.equal(h.sent.length, 1, 'control: the seam saw nothing, so the request went somewhere else');
  assert.equal(escaped, 0, 'a request used the global fetch');
  assert.equal(h.sent[0].method, 'POST');
  assert.match(h.sent[0].url, /\/api\/community\/service-withdraw$/);
  assert.deepEqual(h.sent[0].body, { kind: 'comment', id: ID, from_pane: '%42' });
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.deepEqual(h.lines.out, ['Taken back: this comment comes down from the community on Kosmos\'s next send, usually within a few minutes.']);
});

test('#5574: the Mac\'s words for a post not sent yet, and for a refusal', async () => {
  const held = harness({ answer: () => [200, { ok: true, kind: 'post', state: 'withheld' }] });
  assert.equal(await cli.main(['community', 'withdraw', 'post', ID], held.io), 0, held.all());
  assert.deepEqual(held.lines.out, ['Taken back before it was sent: this post will not go to the community.']);
  const no = harness({ answer: () => [404, { error: 'you have no comment with that id' }] });
  assert.equal(await cli.main(['community', 'withdraw', 'comment', ID], no.io), 1, no.all());
  assert.match(no.all(), /^Nothing was taken back: you have no comment with that id\.$/m);
});

test('#5574: a wrong kind or a missing id is a usage error and sends nothing', async () => {
  for (const args of [['community', 'withdraw', 'vote', ID], ['community', 'withdraw', 'post'], ['community', 'withdraw']]) {
    const h = harness();
    assert.equal(await cli.main(args, h.io), 2, args.join(' ') + ': ' + h.all());
    assert.equal(h.sent.length, 0);
    assert.match(h.all(), /Usage: kosmos community withdraw <post\|comment> <id>/);
  }
});
