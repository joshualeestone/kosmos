'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
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
const fs = require('node:fs');
const path = require('node:path');
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

/* #4580: a send whose reply is cut may have been kept by the board; the CLI asks ONCE more (the board keeps one
   copy of the same send inside five minutes) and reports the receipt instead of a failure. */
function sequence(steps) {
  const lines = { out: [], err: [] };
  let calls = 0;
  const io = {
    env: { TMUX_PANE: '%42', KOSMOS_RETRY_PAUSE_MS: '0' },
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: '', ended: true }),
    hook: { agentToken: () => 'ab'.repeat(16), readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async () => { const s = steps[Math.min(calls, steps.length - 1)]; calls++; if (s instanceof Error) throw s; return { status: 200, text: async () => s }; },
  };
  return { io, out: () => lines.out.join('\n'), err: () => lines.err.join('\n'), calls: () => calls };
}
const reset = () => Object.assign(new Error('fetch failed'), { name: 'TypeError', cause: { code: 'ECONNRESET' } });
const refusedErr = () => Object.assign(new Error('fetch failed'), { name: 'TypeError', cause: { code: 'ECONNREFUSED' } });
const kept = '{"delivery":{"state":"placed","because":null,"id":"m1","duplicate":true}}';

test('#4580 Windows: a msg whose reply is cut is asked once more, and the receipt says it arrived', async () => {
  const h = sequence([reset(), kept]);
  assert.equal(await cli.main(['msg', 'mara', 'the lease is signed'], h.io), 0, h.err());
  // kosmos#9243: the duplicate prints its id too, since this retry's first attempt printed none.
  assert.match(h.out(), /^Placed with mara \(it had arrived the first time; it was not sent twice\)\.\nIts id is m1: kosmos msg --status m1 says later/);
  assert.match(h.err(), /asking once more/, 'the retry says so, on the captured stderr');
  assert.equal(h.calls(), 2);
});

/* kosmos#9243: each direct-message outcome that may have arrived, run through the CLI: exit 3 (a maybe), and words that
   point at the receipt or at waiting, never at checking with them. */
const timeoutErr = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
test('#9243 Windows: a timed-out msg says wait for their answer (no id), exit 3, and is not sent again', async () => {
  const h = sequence([timeoutErr(), timeoutErr()]);   // the CLI asks once more after a timeout; that times out too
  assert.equal(await cli.main(['msg', 'mara', 'the lease is signed'], h.io), 3, h.out() + h.err());
  assert.equal(h.calls(), 2, 'one retry, then stop');
  assert.match(h.err(), /with no id, kosmos msg --status cannot check it, so wait for their answer before sending it again\./);
  assert.doesNotMatch(h.err() + h.out(), /check with them/);
});
test('#9243 Windows: an unconfirmed msg says do not send it again, exit 3, and prints its id', async () => {
  const h = sequence(['{"delivery":{"state":"unconfirmed","because":"the text may be in their composer","id":"m7"}}']);
  assert.equal(await cli.main(['msg', 'mara', 'the lease is signed'], h.io), 3, h.out() + h.err());
  assert.match(h.err(), /^Not confirmed: the text may be in their composer\. Do not send it again: if an id is shown, kosmos msg --status says later whether they read it; if not, wait for their answer\.$/m);
  assert.match(h.out(), /^Its id is m7: kosmos msg --status m7 says later/m);
  assert.doesNotMatch(h.err() + h.out(), /check with them/);
});

test('#9243 Windows: with --no-reply, a timed-out or unconfirmed msg says do not send it again, never wait for an answer', async () => {
  const t = sequence([timeoutErr(), timeoutErr()]);
  assert.equal(await cli.main(['msg', '--no-reply', 'mara', 'fyi'], t.io), 3, t.out() + t.err());
  assert.match(t.err(), /with no id, kosmos msg --status cannot check it, and you asked for no reply, so do not send it again\./);
  assert.doesNotMatch(t.err(), /wait for their answer/);
  const u = sequence(['{"delivery":{"state":"unconfirmed","because":"the text may be in their composer","id":"m7"}}']);
  assert.equal(await cli.main(['msg', '--no-reply', 'mara', 'fyi'], u.io), 3, u.out() + u.err());
  assert.match(u.err(), /^Not confirmed: the text may be in their composer\. Do not send it again: if an id is shown, kosmos msg --status says later whether they read it\.$/m);
  assert.doesNotMatch(u.err(), /wait for their answer/);
  // The asked-once-more branch: a cut reply, then a retry that fails without a timeout.
  const r = sequence([reset(), reset()]);
  assert.equal(await cli.main(['msg', '--no-reply', 'mara', 'fyi'], r.io), 3, r.out() + r.err());
  assert.match(r.err(), /did not answer when asked once more\. The message may have been delivered; with no id, kosmos msg --status cannot check it, and you asked for no reply, so do not send it again\./);
});

test('#4580 Windows: a post whose reply is cut is asked once more too', async () => {
  const h = sequence([reset(), kept]);
  assert.equal(await cli.main(['post', 'proj', 'draft is in the folder'], h.io), 0, h.err());
  assert.match(h.out(), /it was not posted twice/);
  assert.equal(h.calls(), 2);
});

test('#4934 Windows: a post whose reply is cut and whose retry the loop guard refuses never says "nothing was sent"', async () => {
  const h = sequence([reset(), '{"delivery":{"state":"could_not","code":"room_held","because":"held","id":null}}']);
  assert.equal(await cli.main(['post', 'proj', 'draft is in the folder'], h.io), 1, h.err());
  assert.equal(h.calls(), 2, 'CONTROL: the retry was asked');
  assert.doesNotMatch(h.err(), /Nothing was sent to anyone/);
  assert.match(h.err(), /Not posted this time: .*Your first try may have reached the room before that: check kosmos room proj before posting it again\./);

  // --stdin case (#4934 review 2)
  const h2 = sequence([reset(), '{"delivery":{"state":"could_not","code":"room_held","because":"held","id":null}}']);
  h2.io.readStdin = async () => ({ text: 'piped draft in the folder', ended: true });
  assert.equal(await cli.main(['post', '--stdin', 'proj'], h2.io), 1, h2.err());
  assert.equal(h2.calls(), 2, 'CONTROL: the retry was asked for piped post too');
  assert.doesNotMatch(h2.err(), /The piped message was not sent;/);
  assert.doesNotMatch(h2.err(), /Nothing was sent to anyone/);
  const m = h2.err().match(/The piped message may not have been sent; a copy is saved at ([^\s,]+), so nothing is lost if it did not arrive\./);
  assert.ok(m, h2.err());
  assert.equal(fs.readFileSync(m[1], 'utf8'), 'piped draft in the folder');
  fs.rmSync(path.dirname(m[1]), { recursive: true, force: true });
});

test('#4580 Windows CONTROL: a refused connection is not retried (nothing arrived), and a post timeout is not retried', async () => {
  const r = sequence([refusedErr(), kept]);
  assert.notEqual(await cli.main(['msg', 'mara', 'hi'], r.io), 0);
  assert.equal(r.calls(), 1, 'a refused send is not asked again');
  const t = sequence([Object.assign(new Error('aborted'), { name: 'TimeoutError' }), kept]);
  assert.notEqual(await cli.main(['post', 'proj', 'hi'], t.io), 0);
  assert.equal(t.calls(), 1, 'a post that timed out is still being delivered: no second ask');
});

test('#4580 Windows: a timed-out msg whose retry is REFUSED keeps "may have been delivered" (the first may have landed)', async () => {
  const h = sequence([Object.assign(new Error('aborted'), { name: 'TimeoutError' }), refusedErr()]);
  assert.notEqual(await cli.main(['msg', 'mara', 'signed'], h.io), 0);
  assert.equal(h.calls(), 2);
  assert.match(h.err(), /may have been delivered/, h.err());
  assert.doesNotMatch(h.err(), /Is it running/);
});

test('#4580 Windows: a RESET first attempt then a failed retry (refused, or reset again) keeps "may have been delivered"', async () => {
  for (const [label, second] of [['refused', refusedErr()], ['reset', reset()]]) {
    for (const verb of [['msg', 'mara', 'signed'], ['post', 'proj', 'signed']]) {
      const h = sequence([reset(), second]);
      assert.equal(await cli.main(verb, h.io), 3, verb[0] + ' ' + label + ': ' + h.err());
      assert.equal(h.calls(), 2);
      assert.match(h.err(), /may have been delivered/, verb[0] + ' ' + label);
      assert.doesNotMatch(h.err(), /Is it running/, verb[0] + ' ' + label);
    }
  }
});
