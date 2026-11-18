'use strict';
/**
 * kosmos#8722: on Windows, a follow, an unfollow or a vote whose answer was lost after connecting (a timeout or a cut)
 * may have happened: exit 3, and the words say a repeat is safe and its answer says where things stand now. One that
 * never connected did nothing: exit 1. Driven through main() with its seams; nothing leaves the process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const TOKEN = 'ef'.repeat(16);
const realFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error('a request left the test seam'); }; });
test.after(() => { globalThis.fetch = realFetch; });

function harness(throws) {
  const lines = { out: [], err: [] };
  const io = {
    env: { TMUX_PANE: '%42' },
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async () => { throw throws; },
  };
  return { io, lines };
}
const POST = '11111111-2222-4333-8444-555555555555';
const NOW = 'It may have happened; running it again is safe, and its answer says where things stand now.';
const cut = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const refused = () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

for (const [verb, args] of [['follow', ['community', 'follow', 'Ada']], ['unfollow', ['community', 'unfollow', 'Ada']], ['vote', ['community', 'vote', 'post', POST, 'up']]]) {
  test(`kosmos#8722: ${verb} with its answer cut after connecting exits 3 and says a repeat says where things stand`, async () => {
    const h = harness(cut());
    assert.equal(await cli.main(args, h.io), 3, h.lines.err.join(' '));
    assert.deepEqual(h.lines.err, ['Kosmos did not finish answering. ' + NOW]);
  });
  test(`kosmos#8722: ${verb} that timed out exits 3 with the same words`, async () => {
    const h = harness(timeout());
    assert.equal(await cli.main(args, h.io), 3, h.lines.err.join(' '));
    assert.deepEqual(h.lines.err, ['Kosmos did not finish answering. ' + NOW]);
  });
  test(`kosmos#8722 CONTROL: ${verb} that never connected exits 1 and does not say it may have happened`, async () => {
    const h = harness(refused());
    assert.equal(await cli.main(args, h.io), 1);
    assert.doesNotMatch(h.lines.err.join(' '), /may have happened/);
  });
}
