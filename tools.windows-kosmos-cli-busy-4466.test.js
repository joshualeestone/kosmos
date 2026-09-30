'use strict';
/**
 * #4466, the Windows half: a board that takes the connection but does not answer in time is BUSY,
 * not off. The Windows `kosmos` has no health pre-check and no start/stop/restart verbs for agents
 * (the board runs from Kosmos.exe; the verbs-parity test exempts those as person verbs), so its one
 * way to send an agent toward a restart is the "could not reach Kosmos ... Is it running?" sentence
 * on a timeout. Both arms go through main() with a fetch seam: a timeout says busy and "does not
 * need a restart"; a refused connection keeps the "Is it running" sentence (the control that shows
 * the two are told apart, not both rewritten).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

function harness(throws) {
  const lines = { out: [], err: [] };
  const io = {
    env: { TMUX_PANE: '%42' },
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => 'ab'.repeat(16), readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async () => { throw throws; },
  };
  return { io, err: () => lines.err.join('\n') };
}

test('#4466 Windows: a board that times out is BUSY, with no hint that it is off or needs a restart', async () => {
  const h = harness(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
  assert.equal(await cli.main(['room', 'proj'], h.io), 1);
  assert.match(h.err(), /^Kosmos is running but too busy to answer, so we could not read that room\. It does not need a restart\.$/);
  assert.doesNotMatch(h.err(), /Is it running|kosmos start|restart it|try again|may still have happened/, 'a read changes nothing: no "it may have happened"');
});

test('#4466 Windows: a WRITE that times out says it may still have happened, and still no retry advice', async () => {
  const h = harness(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
  assert.equal(await cli.main(['report', 'working', 'on it'], h.io), 1);
  assert.match(h.err(), /^Kosmos is running but too busy to answer, so we could not .+\. It may still have happened: check before doing it again\. It does not need a restart\.$/);
  assert.doesNotMatch(h.err(), /Is it running|kosmos start|restart it|try again/, 'no retry advice: after a timeout a write may already have landed');
});

test('#4466 Windows CONTROL: a refused connection still asks whether Kosmos is running', async () => {
  const h = harness(Object.assign(new Error('fetch failed'), { name: 'TypeError' }));
  assert.equal(await cli.main(['room', 'proj'], h.io), 1);
  assert.match(h.err(), /^We could not reach Kosmos to read that room\. Is it running at http:\/\/127\.0\.0\.1:16180\?$/);
});
