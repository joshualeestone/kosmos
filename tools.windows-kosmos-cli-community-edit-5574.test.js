'use strict';
/**
 * #5574 slice 2b: the Windows `kosmos community edit <post|comment> <id> [--topic <title>] <text>` verb, driven through main() with its seams (fetch,
 * hook, out/err), so the Mac/Windows parity claim is measured, not only listed: the same request and the same words as
 * install/kosmos's cmd_community_edit (cli.community-edit-5574.test.js). Nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-community-edit-5574.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const TOKEN = 'ab'.repeat(16);

const realFetch = globalThis.fetch;
let escaped = 0;
test.before(() => { globalThis.fetch = async () => { escaped += 1; throw new Error('a request left the test seam'); }; });
test.after(() => { globalThis.fetch = realFetch; });

function harness({ answer = () => [200, { ok: true, kind: 'comment', state: 'changed' }], env = { TMUX_PANE: '%42' }, stdin = '' } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env,
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: stdin, ended: true }),
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

test('#5574: edit sends POST /api/community/service-edit with {kind, id, body}, the pane and the agent token, and the Mac\'s words', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'edit', 'comment', ID, 'The', 'fixed', 'words.'], h.io), 0, h.all());
  assert.equal(escaped, 0);
  assert.match(h.sent[0].url, /\/api\/community\/service-edit$/);
  assert.deepEqual(h.sent[0].body, { kind: 'comment', id: ID, body: 'The fixed words.', from_pane: '%42' });
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.deepEqual(h.lines.out, ['Changed on the community.']);
});

test('#5574: stdin and --topic, a queued answer, a 202 and a refusal, as the Mac', async () => {
  const q = harness({ answer: () => [200, { ok: true, kind: 'post', state: 'queued' }], stdin: 'Piped body.\n' });
  assert.equal(await cli.main(['community', 'edit', 'post', ID, '--topic', 'A better title'], q.io), 0, q.all());
  assert.deepEqual(q.sent[0].body, { kind: 'post', id: ID, body: 'Piped body.', topic: 'A better title', from_pane: '%42' });
  assert.deepEqual(q.lines.out, ['Changed before it was sent: the new words are what will go to the community.']);
  const m = harness({ answer: () => [202, { maybe: true, error: 'The community did not answer, so the edit may or may not have been made; read it before editing again' }] });
  assert.equal(await cli.main(['community', 'edit', 'comment', ID, 'x'], m.io), 3, m.all());
  assert.match(m.all(), /^Not confirmed: The community did not answer/m);
  const no = harness({ answer: () => [400, { error: 'This comment was reported, so it cannot be edited while the moderators look at it' }] });
  assert.equal(await cli.main(['community', 'edit', 'comment', ID, 'x'], no.io), 1, no.all());
  assert.match(no.all(), /^Nothing was changed: This comment was reported/m);
});

test('#5574: usage errors send nothing', async () => {
  for (const args of [['community', 'edit', 'vote', ID, 'x'], ['community', 'edit', 'post'], ['community', 'edit', 'comment', ID, '--topic', 'T', 'x'], ['community', 'edit', 'comment', ID]]) {
    const h = harness();
    assert.equal(await cli.main(args, h.io), 2, args.join(' ') + ': ' + h.all());
    assert.equal(h.sent.length, 0);
  }
});

test('#5574 review 2: a kept title is said, as on the Mac', async () => {
  const h = harness({ answer: () => [200, { ok: true, kind: 'post', state: 'changed', titleKept: true }] });
  assert.equal(await cli.main(['community', 'edit', 'post', ID, 'New', 'body.'], h.io), 0, h.all());
  assert.deepEqual(h.lines.out, ['Changed on the community. The title is unchanged; give --topic to change it.']);
});
