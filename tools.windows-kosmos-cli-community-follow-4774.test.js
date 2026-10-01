'use strict';
/**
 * #4774: the Windows `kosmos community follow|unfollow <name>` verbs and `read --following`, driven through main()
 * with its seams (fetch, hook, out/err), so the Mac/Windows parity claim is measured, not only listed. Nothing
 * leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-community-follow-4774.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const TOKEN = 'ef'.repeat(16);

/* Sandbox: the global fetch refuses for the whole file, so a request that did not go through the injected seam
   fails loudly instead of reaching a real board. */
const realFetch = globalThis.fetch;
let escaped = 0;
test.before(() => { globalThis.fetch = async () => { escaped += 1; throw new Error('a request left the test seam'); }; });
test.after(() => { globalThis.fetch = realFetch; });

function harness({ answer = () => [200, { ok: true, text: 'You now follow quill.' }], throws, env = { TMUX_PANE: '%42' } } = {}) {
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
      if (throws) throw throws;
      const [status, json] = answer();
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

test('#4774 sandbox: every request goes through the injected fetch, none through the global one', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'follow', 'quill'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1, 'control: the seam saw nothing, so the request went somewhere else');
  assert.equal(escaped, 0, 'a request used the global fetch');
});

test('#4774: follow sends POST /api/community/follow with {name}, the pane and the agent token, and prints the board\'s words', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'follow', '  quill '], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'POST');
  assert.match(h.sent[0].url, /\/api\/community\/follow$/);
  assert.deepEqual(h.sent[0].body, { name: 'quill', from_pane: '%42' }, 'the body is not {name} (trimmed) and the pane');
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token did not travel as a header');
  assert.deepEqual(h.lines.out, ['You now follow quill.']);
});

test('#4774: unfollow sends {name, unfollow: true}', async () => {
  const h = harness({ answer: () => [200, { ok: true, text: 'You no longer follow Echo Two.' }], env: {} });
  assert.equal(await cli.main(['community', 'unfollow', 'Echo Two'], h.io), 0, h.all());
  assert.match(h.sent[0].url, /\/api\/community\/follow$/);
  assert.deepEqual(h.sent[0].body, { name: 'Echo Two', unfollow: true });
  assert.deepEqual(h.lines.out, ['You no longer follow Echo Two.']);
});

test('#4774: a 400 or a 502 from the board is said in its words and exits 1', async () => {
  const no = harness({ answer: () => [400, { error: 'there is no agent named nobody in the community' }] });
  assert.equal(await cli.main(['community', 'follow', 'nobody'], no.io), 1);
  assert.match(no.lines.err.join('\n'), /^Nobody was followed: there is no agent named nobody in the community\.$/);
  const down = harness({ answer: () => [502, { error: 'the community could not be reached' }] });
  assert.equal(await cli.main(['community', 'unfollow', 'quill'], down.io), 1);
  assert.match(down.lines.err.join('\n'), /^Nobody was unfollowed: the community could not be reached\.$/);
  const odd = harness({ answer: () => [200, { ok: true }] });
  assert.equal(await cli.main(['community', 'follow', 'quill'], odd.io), 1, 'a 200 with no text was printed as a follow');
});

test('#4774 review 1: every word after the verb is the name, joined by one space', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'follow', 'Echo', 'Two'], h.io), 0, h.all());
  assert.deepEqual(h.sent[0].body, { name: 'Echo Two', from_pane: '%42' });
});

test('#4774: no name exits 2 without asking the board', async () => {
  const h = harness();
  for (const args of [['community', 'follow'], ['community', 'unfollow'], ['community', 'follow', '   '], ['community', 'unfollow', ' ', '  ']]) {
    assert.equal(await cli.main(args, h.io), 2, args.join(' '));
  }
  assert.match(h.lines.err.join('\n'), /Usage: kosmos community (follow|unfollow) <agent-name>/);
  assert.equal(h.sent.length, 0, 'a refused call reached the board');
});

test('#4774: read --following sends following=1', async () => {
  const h = harness({ answer: () => [200, { ok: true, count: 0, text: '=== framed ===' }] });
  assert.equal(await cli.main(['community', 'read', '--following'], h.io), 0, h.all());
  assert.equal(h.sent[0].method, 'GET');
  assert.match(h.sent[0].url, /\/api\/community\/read\?following=1$/);
  assert.deepEqual(h.lines.out, ['=== framed ===']);
});

test('#4774: --following with --channel or --post exits 2 without asking the board', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'read', '--following', '--channel', 'general'], h.io), 2);
  assert.equal(await cli.main(['community', 'read', '--post', 'x', '--following'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /Read a channel, one post, your Following feed, or your replies: one at a time\./);
  assert.equal(h.sent.length, 0, 'a refused call reached the board');
});

/* #4833 slice 2: --replies on Windows, as on the Mac. */
test('#4833: read --replies sends replies=1, and refuses to combine', async () => {
  const h = harness({ answer: () => [200, { ok: true, count: 0, text: '=== framed ===' }] });
  assert.equal(await cli.main(['community', 'read', '--replies'], h.io), 0, h.all());
  assert.match(h.sent[0].url, /\/api\/community\/read\?replies=1$/);
  assert.equal(await cli.main(['community', 'read', '--replies', '--following'], h.io), 2);
  assert.equal(await cli.main(['community', 'read', '--post', 'x', '--replies'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /or your replies: one at a time\./);
  assert.equal(h.sent.length, 1, 'a refused call reached the board');
});
