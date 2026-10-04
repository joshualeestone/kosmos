'use strict';
/**
 * #4884: the Windows `kosmos community vote <post|comment> <id> <up|down|clear>` and `kosmos community votes` verbs,
 * driven through main() with its seams (fetch, hook, out/err), so the Mac/Windows parity claim is measured, not only
 * listed. Nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-community-vote-4884.test.js
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

function harness({ answer = () => [200, { ok: true, text: 'You voted that post up.' }], throws, env = { TMUX_PANE: '%42' } } = {}) {
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

const POST = '11111111-2222-4333-8444-555555555555';

test('#4884 sandbox: every request goes through the injected fetch, none through the global one', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'vote', 'post', POST, 'up'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1, 'control: the seam saw nothing, so the request went somewhere else');
  assert.equal(escaped, 0, 'a request used the global fetch');
});

test('#4884: vote sends POST /api/community/vote with {kind, id, direction}, the pane and the agent token, and prints the board\'s words', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'vote', 'comment', POST, 'down'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'POST');
  assert.match(h.sent[0].url, /\/api\/community\/vote$/);
  assert.deepEqual(h.sent[0].body, { kind: 'comment', id: POST, direction: 'down', from_pane: '%42' });
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token did not travel as a header');
  assert.deepEqual(h.lines.out, ['You voted that post up.']);
});

test('#4884: a 400, 429 or 502 from the board is said in its words and exits 1; a 200 with no words is not a vote', async () => {
  for (const [status, error] of [[400, 'you cannot vote on your own post'], [429, 'over the cap'], [502, 'the community could not be reached']]) {
    const h = harness({ answer: () => [status, { error }] });
    assert.equal(await cli.main(['community', 'vote', 'post', POST, 'up'], h.io), 1, String(status));
    assert.deepEqual(h.lines.err, ['Nothing was voted: ' + error + '.']);
  }
  const sent = harness({ answer: () => [202, { error: 'the community could not be reached' }] });
  assert.equal(await cli.main(['community', 'vote', 'post', POST, 'up'], sent.io), 3, 'a vote that may have been counted exits as maybe');
  assert.deepEqual(sent.lines.err, ['Not confirmed: the community could not be reached. It may have been counted; voting the same way again is safe.']);
  const cut = harness({ throws: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });   // connected, answer cut
  assert.equal(await cli.main(['community', 'vote', 'post', POST, 'up'], cut.io), 3, 'an answer cut after connecting may have voted');
  assert.match(cut.lines.err.join(' '), /It may have happened; running it again is safe/);
  const never = harness({ throws: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });   // never connected
  assert.equal(await cli.main(['community', 'vote', 'post', POST, 'up'], never.io), 1, 'a board that never answered the connection voted nothing');
  const odd = harness({ answer: () => [200, { ok: true }] });
  assert.equal(await cli.main(['community', 'vote', 'post', POST, 'up'], odd.io), 1, 'a 200 with no text was printed as a vote');
});

test('#4884: vote needs exactly three words, and votes takes none; neither asks the board otherwise', async () => {
  const h = harness();
  for (const args of [['community', 'vote'], ['community', 'vote', 'post', POST], ['community', 'vote', 'post', POST, 'up', 'extra'], ['community', 'votes', 'now']]) {
    assert.equal(await cli.main(args, h.io), 2, args.join(' '));
  }
  assert.match(h.lines.err.join('\n'), /Usage: kosmos community vote <post\|comment> <id> <up\|down\|clear>/);
  assert.match(h.lines.err.join('\n'), /Usage: kosmos community votes/);
  assert.equal(h.sent.length, 0, 'a refused call reached the board');
});

test('#4884: votes sends GET /api/community/votes and prints the board\'s words; a 502 exits 1', async () => {
  const h = harness({ answer: () => [200, { ok: true, text: 'You have met it.' }] });
  assert.equal(await cli.main(['community', 'votes'], h.io), 0, h.all());
  assert.equal(h.sent[0].method, 'GET');
  assert.match(h.sent[0].url, /\/api\/community\/votes$/);
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.deepEqual(h.lines.out, ['You have met it.']);
  const down = harness({ answer: () => [502, { error: 'the community could not be reached' }] });
  assert.equal(await cli.main(['community', 'votes'], down.io), 1);
  assert.deepEqual(down.lines.err, ['Nothing was read: the community could not be reached.']);
});

test('#4884: the community usage names vote and votes', async () => {
  const h = harness();
  assert.equal(await cli.main(['community'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /kosmos community vote <post\|comment> <id> <up\|down\|clear>    kosmos community votes/);
});

test('#5211: after a vote and after a comment the board\'s nudge prints on its own line (as the Mac); none, no line', async () => {
  const nudge = 'That post is by Ada (@ada-3f2c); you do not follow them.\tToday: votes 2/3, comments 1/2.';
  const shown = 'That post is by Ada (@ada-3f2c); you do not follow them. Today: votes 2/3, comments 1/2.';
  let h = harness({ answer: () => [200, { ok: true, text: 'You voted that post up.', nudge }] });
  assert.equal(await cli.main(['community', 'vote', 'post', POST, 'up'], h.io), 0, h.all());
  assert.deepEqual(h.lines.out, ['You voted that post up.', shown]);
  h = harness();
  assert.equal(await cli.main(['community', 'vote', 'post', POST, 'up'], h.io), 0, h.all());
  assert.deepEqual(h.lines.out, ['You voted that post up.'], 'control: a line with no nudge');
  for (const status of ['published', 'held']) {
    h = harness({ answer: () => [200, { ok: true, status, id: 'c1', sends: true, nudge }] });
    assert.equal(await cli.main(['community', 'comment', POST, 'hi'], h.io), 0, h.all());
    assert.equal(h.lines.out.length, 2, h.all());
    assert.equal(h.lines.out[1], shown);
  }
  h = harness({ answer: () => [200, { ok: true, status: 'published', id: 'c1', sends: true }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'hi'], h.io), 0, h.all());
  assert.equal(h.lines.out.length, 1, 'control: a comment with no nudge printed a second line');
});

test('#5212: community home GETs /api/community/home and prints the board\'s lines (as the Mac); an argument asks nothing', async () => {
  let h = harness({ answer: () => [200, { ok: true, text: 'Your posts: none.\u001b[31m\nnext:\n  1. vote: x\u0007' }] });
  assert.equal(await cli.main(['community', 'home'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'GET');
  assert.match(h.sent[0].url, /\/api\/community\/home$/);
  assert.deepEqual(h.lines.out.join('\n').split('\n'), ['Your posts: none.[31m', 'next:', '  1. vote: x']);
  h = harness();
  assert.equal(await cli.main(['community', 'home', 'extra'], h.io), 2);
  assert.equal(h.sent.length, 0);
});
