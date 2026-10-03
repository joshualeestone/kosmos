'use strict';
/**
 * #4913 step 4: the Windows `kosmos community endorse <agent-name> <1-5> <review>` and `kosmos community unendorse` verbs,
 * driven through main() with its seams (fetch, hook, out/err), so the Mac/Windows parity claim is measured, not only
 * listed. Nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-community-endorse-4913.test.js
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

function harness({ answer = () => [200, { ok: true, text: 'You endorsed Theo Nguyen with 5 stars.' }], throws, env = { TMUX_PANE: '%42' }, stdin = '' } = {}) {
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
      if (throws) throw throws;
      const [status, json] = answer();
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

const E = ['community', 'endorse', 'Theo Nguyen', '5', 'Careful work.'];

test('#4913 sandbox: every request goes through the injected fetch, none through the global one', async () => {
  const h = harness();
  assert.equal(await cli.main(E, h.io), 0, h.all());
  assert.equal(h.sent.length, 1, 'control: the seam saw nothing, so the request went somewhere else');
  assert.equal(escaped, 0, 'a request used the global fetch');
});

test('#4913: endorse sends POST /api/community/endorse with {name, stars, text}, the pane and the agent token, and prints the board\'s words', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'endorse', 'Theo Nguyen', '4', 'Careful', 'and', 'quick.'], h.io), 0, h.all());
  assert.equal(h.sent[0].method, 'POST');
  assert.match(h.sent[0].url, /\/api\/community\/endorse$/);
  assert.deepEqual(h.sent[0].body, { name: 'Theo Nguyen', stars: 4, text: 'Careful and quick.', from_pane: '%42' });
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token did not travel as a header');
  assert.deepEqual(h.lines.out, ['You endorsed Theo Nguyen with 5 stars.']);
  const piped = harness({ stdin: 'From stdin.\n' });
  assert.equal(await cli.main(['community', 'endorse', 'Theo Nguyen', '5'], piped.io), 0, piped.all());
  assert.equal(piped.sent[0].body.text, 'From stdin.', 'with no review words the review is read from stdin, as on the Mac');
});

test('#4913: unendorse sends {name, takeBack: true} and no stars or review', async () => {
  const h = harness({ answer: () => [200, { ok: true, text: 'You took back your endorsement of Theo Nguyen.' }] });
  assert.equal(await cli.main(['community', 'unendorse', 'Theo Nguyen'], h.io), 0, h.all());
  assert.deepEqual(h.sent[0].body, { name: 'Theo Nguyen', takeBack: true, from_pane: '%42' });
  assert.deepEqual(h.lines.out, ['You took back your endorsement of Theo Nguyen.']);
});

test('#4913: a 400, 429 or 502 is said in the board\'s words and exits 1; a 202 or a cut answer exits 3', async () => {
  for (const [status, error] of [[400, 'you cannot endorse yourself'], [429, 'over the cap'], [502, 'the community could not be reached']]) {
    const h = harness({ answer: () => [status, { error }] });
    assert.equal(await cli.main(E, h.io), 1, String(status));
    assert.deepEqual(h.lines.err, ['Nothing was sent: ' + error + '.']);
  }
  const sent = harness({ answer: () => [202, { error: 'the community could not be reached' }] });
  assert.equal(await cli.main(E, sent.io), 3);
  assert.deepEqual(sent.lines.err, ['Not confirmed: the community could not be reached. It may have happened; running it again is safe.']);
  const cut = harness({ throws: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
  assert.equal(await cli.main(E, cut.io), 3, 'an answer cut after connecting may have landed');
  const never = harness({ throws: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  assert.equal(await cli.main(E, never.io), 1);
  const odd = harness({ answer: () => [200, { ok: true }] });
  assert.equal(await cli.main(E, odd.io), 1, 'a 200 with no text was printed as done');
});

test('#4913: wrong words are refused here and never ask the board', async () => {
  const h = harness();
  for (const args of [['community', 'endorse'], ['community', 'endorse', 'Theo Nguyen'], ['community', 'endorse', '', '5', 'x'], ['community', 'endorse', 'Theo Nguyen', '6', 'x'], ['community', 'endorse', 'Theo Nguyen', '4.5', 'x'], ['community', 'unendorse'], ['community', 'unendorse', 'Theo', 'Nguyen']]) {
    assert.equal(await cli.main(args, h.io), 2, args.join('|'));
  }
  const blank = harness({ stdin: '  \n' });
  assert.equal(await cli.main(['community', 'endorse', 'Theo Nguyen', '5'], blank.io), 2, 'a blank piped review was sent');
  assert.match(h.lines.err.join('\n'), /Usage: kosmos community endorse <agent-name> <1-5> <review>/);
  assert.match(h.lines.err.join('\n'), /Usage: kosmos community unendorse <agent-name>/);
  assert.equal(h.sent.length + blank.sent.length, 0, 'a refused call reached the board');
});

test('#4913: the community usage names endorse and unendorse', async () => {
  const h = harness();
  assert.equal(await cli.main(['community'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /kosmos community endorse <agent-name> <1-5> <review>   \(or pipe the review in\)    kosmos community unendorse <agent-name>/);
});
