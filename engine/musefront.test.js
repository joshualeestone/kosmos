'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { mkTemp } = require('../test-support/tmpdir.js');
const front = require('./musefront');

/* A front with its edges recorded. runTurn answers from `answers` (a function or a list), one per call. */
function harness(answers, opts = {}) {
  const calls = []; const reports = []; let out = '';
  let n = 0;
  const pending = [];
  const stops = [];   // how many times the front ended each held turn
  const runTurn = (input) => {
    calls.push(input);
    const i = n; n += 1;   // counted before a throwing answer, so the next call gets the next one
    const a = typeof answers === 'function' ? answers(input, i) : answers[i];
    if (a === 'hold') {
      return new Promise((resolve) => {
        pending.push(resolve);
        stops[i] = 0;
        // muserun's contract: the stop ends the turn with its STOPPED answer.
        input.onStop(() => { stops[i] += 1; resolve({ ok: false, text: '', because: 'Stopped before Muse Code finished' }); });
      });
    }
    return Promise.resolve(a);
  };
  const f = front.createFront({ workspace: '/w', sessionId: '11111111-2222-4333-8444-555555555555', runTurn, report: (s) => reports.push(s), write: (t) => { out += t; }, ...opts });
  return { f, calls, reports, out: () => out, pending, stops };
}
const OK = (text) => ({ ok: true, text, because: null });
/* A turn that is never stopped never ends, so a broken Stop must fail here rather than hang the file. */
const within = (p, what, ms = 2000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(what)), ms).unref())]);

test('one Enter is one message: chunked bytes before it are one turn, on this agent\'s session, never asking', async () => {
  const h = harness([OK('DONE')]);
  h.f.feed('Append a ');
  h.f.feed(Buffer.from('line to hello'));
  h.f.feed('.txt\r');
  await h.f.drained();
  assert.equal(h.calls.length, 1);
  const { onStop, ...sent } = h.calls[0];
  assert.deepEqual(sent, { workspace: '/w', sessionId: '11111111-2222-4333-8444-555555555555', prompt: 'Append a line to hello.txt', approvalMode: 'never' });
  assert.equal(typeof onStop, 'function', 'the front cannot stop the turn');
  assert.match(h.out(), /DONE\n> $/);
  assert.deepEqual(h.reports, ['working', 'idle']);
});

test('a message longer than a cooked terminal line (1024 bytes) arrives whole', async () => {
  const h = harness([OK('ok')]);
  const long = 'x'.repeat(5000);
  for (let i = 0; i < long.length; i += 700) h.f.feed(long.slice(i, i + 700));   // chat.js's chunked paste
  h.f.feed('\r');
  await h.f.drained();
  assert.equal(h.calls[0].prompt.length, 5000);
});

test('an empty Enter runs nothing; Backspace, Ctrl+U and Ctrl+C edit the line; key sequences are dropped whole', async () => {
  const h = harness([OK('a')]);
  h.f.feed('\r');
  h.f.feed('helo\u007flo');           // Backspace: "hello"
  h.f.feed('\u001b[A\u001bOB');        // arrow keys: no "[A" or "OB" left behind
  h.f.feed(' world\u0015');            // Ctrl+U drops the line
  h.f.feed('gone\u0003');              // Ctrl+C drops it too
  h.f.feed('kept\r');
  await h.f.drained();
  assert.equal(h.calls.length, 1, 'the empty Enter must not run a turn');
  assert.equal(h.calls[0].prompt, 'kept');
  // CONTROL for the arrow keys: the same line without them.
  const c = harness([OK('a')]);
  c.f.feed('helo\u007flo\r');
  await c.f.drained();
  assert.equal(c.calls[0].prompt, 'hello');
});

test('a message sent during a turn waits for it, runs next, and the board stays working between them', async () => {
  const h = harness(['hold', OK('second')]);
  h.f.feed('first\r');
  h.f.feed('second\r');
  assert.equal(h.calls.length, 1, 'the second message must not start while the first turn runs');
  assert.match(h.out(), /queued/);
  h.pending[0](OK('first answer'));
  await h.f.drained();
  assert.deepEqual(h.calls.map((c) => c.prompt), ['first', 'second']);
  assert.deepEqual(h.reports, ['working', 'working', 'idle'], 'no idle between two queued turns');
  assert.ok(h.out().indexOf('first answer') < h.out().indexOf('second\n> '));
});

test('a failed turn says why in the pane and still ends idle; a throwing runTurn does not stop the front', async () => {
  const h = harness((input, n) => {
    if (n === 0) return { ok: false, text: '', because: 'Muse Code is not signed in on this computer' };
    if (n === 1) throw new Error('boom');
    return OK('fine');
  });
  h.f.feed('one\r');
  await h.f.drained();
  assert.match(h.out(), /\(Muse Code is not signed in on this computer\)/);
  h.f.feed('two\r');
  await h.f.drained();
  assert.match(h.out(), /\(Kosmos could not run Muse Code just now\)/);
  h.f.feed('three\r');
  await h.f.drained();
  assert.match(h.out(), /fine\n> $/);
  assert.deepEqual(h.reports, ['working', 'idle', 'working', 'idle', 'working', 'idle']);
});

test('an Escape on its own (what chat.interrupt sends) never eats the next message', async () => {
  // chat.interrupt sends exactly one Escape; a message comes in a later read.
  for (const next of ['Hello there', 'OK do it', '[x] done']) {
    const h = harness([OK('a')]);
    h.f.feed('\u001b');
    h.f.feed(next + '\r');
    await within(h.f.drained(), 'the message after Stop never ran');
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].prompt, next, 'the Escape swallowed the start of the next message');
  }
  // An Escape followed in the same read by an ordinary character is Stop too, and the character is kept.
  const m = harness([OK('a')]);
  m.f.feed('\u001bHi\r');
  await within(m.f.drained(), 'the message after Stop never ran');
  assert.equal(m.calls[0].prompt, 'Hi', 'an Escape in the same read ate the next character');
  // CONTROL: an Escape sequence inside one read (an arrow key) is still dropped whole.
  const c = harness([OK('a')]);
  c.f.feed('\u001b[Ahi\r');
  await c.f.drained();
  assert.equal(c.calls[0].prompt, 'hi');
});

test('Escape ends the running turn, drops the waiting ones, and the front takes the next message', async () => {
  const h = harness(['hold', OK('never'), OK('after')]);
  h.f.feed('long job\r');
  h.f.feed('queued one\r');
  h.f.feed('half typed');
  h.f.feed('\u001b');
  await within(h.f.drained(), 'Stop did not end the running turn');
  assert.equal(h.stops[0], 1, 'the running turn was not stopped');
  assert.deepEqual(h.calls.map((c) => c.prompt), ['long job'], 'a waiting message ran after Stop');
  assert.match(h.out(), /1 waiting message was dropped/);
  assert.match(h.out(), /\(Stopped before Muse Code finished\)\n> $/);
  assert.equal(h.reports[h.reports.length - 1], 'idle');
  h.f.feed('after\r');
  await h.f.drained();
  assert.equal(h.calls[1].prompt, 'after', 'the half-typed line survived Stop');
  // CONTROL: without the Escape the queued message does run.
  const c = harness(['hold', OK('ran')]);
  c.f.feed('long job\r');
  c.f.feed('queued one\r');
  c.pending[0](OK('done'));
  await c.f.drained();
  assert.deepEqual(c.calls.map((x) => x.prompt), ['long job', 'queued one']);
});

test('Escape with nothing running only gives the prompt back', async () => {
  const h = harness([]);
  h.f.feed('\u001b');
  await h.f.drained();
  assert.equal(h.calls.length, 0);
  assert.match(h.out(), /> $/);
});

test('a long turn keeps saying working, and stops once the turn ends', async () => {
  const h = harness(['hold'], { workingEveryMs: 20 });
  h.f.feed('long\r');
  await new Promise((r) => setTimeout(r, 90));
  const during = h.reports.filter((x) => x === 'working').length;
  assert.ok(during >= 3, 'only ' + during + ' working reports in a long turn');
  h.pending[0](OK('done'));
  await h.f.drained();
  const atEnd = h.reports.length;
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(h.reports.length, atEnd, 'working kept being reported after the turn ended');
  assert.equal(h.reports[h.reports.length - 1], 'idle');
});

test('a character split across two reads arrives whole', async () => {
  const h = harness([OK('a')]);
  const bytes = Buffer.from('caf\u00e9 \u{1F600}\r', 'utf8');
  h.f.feed(bytes.subarray(0, 4));   // mid-\u00e9
  h.f.feed(bytes.subarray(4, 8));   // mid-emoji
  h.f.feed(bytes.subarray(8));
  await h.f.drained();
  assert.equal(h.calls[0].prompt, 'caf\u00e9 \u{1F600}');
  assert.doesNotMatch(h.calls[0].prompt, /\uFFFD/);
});

test('control sequences in Muse\'s answer never reach the pane; newlines and tabs do', async () => {
  const osc52 = '\u001b]52;c;ZXZpbA==\u0007';
  const h = harness([{ ok: false, text: 'line one\r\n\tline ' + osc52 + 'two\u001b[2J\u009b', because: 'bad\u001b[31m' }]);
  h.f.feed('go\r');
  await h.f.drained();
  assert.doesNotMatch(h.out(), /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/, 'a control byte reached the pane: ' + JSON.stringify(h.out()));
  assert.match(h.out(), /line one\n\tline \]52;c;ZXZpbA==two\[2J\n/);
  assert.match(h.out(), /\(bad\[31m\)/);
  assert.ok(front.WORKING_EVERY_MS < 60 * 1000, 'the heartbeat is not under the report bridge\'s 60 s throttle');
});

test('the session id is made once, kept in the agent folder (mode 600), and reused', () => {
  const dir = mkTemp('musefront-');
  const a = front.loadSession(dir);
  assert.match(a.id, front.UUID_RE);
  assert.equal(a.note, null);
  const file = front.sessionFile(dir);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const b = front.loadSession(dir);
  assert.equal(b.id, a.id, 'a restart must continue the same Muse session');
  // An unreadable id is replaced, and the pane is told.
  fs.writeFileSync(file, 'not-a-uuid\n', { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  const c = front.loadSession(dir, { randomUUID: () => '99999999-8888-4777-8666-555555555555' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'a replaced session file kept its old mode');
  assert.equal(c.id, '99999999-8888-4777-8666-555555555555');
  assert.match(c.note, /could not be read/);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), c.id);
});

test('a session that cannot be saved still runs, and says a restart will start a new one', () => {
  const dir = mkTemp('musefront-');
  fs.writeFileSync(path.join(dir, '.kosmos'), 'a file where the folder should be');
  const r = front.loadSession(dir);
  assert.match(r.id, front.UUID_RE);
  assert.match(r.note, /could not save/);
});

test('the reporter runs the bridge the supervisor names, with PreInvocation for working and Stop for idle', () => {
  const spawned = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end: (d) => spawned[spawned.length - 1].stdin.push(d) });
    child.unref = () => {};
    spawned.push({ bin, args, env: opts.env, stdin: [] });
    return child;
  };
  const report = front.makeReporter({ spawn, node: '/n/node', env: { KOSMOS_MUSE_BRIDGE: '/sup/bin/agy-report-bridge.js', TMUX_PANE: '%9' } });
  report('working'); report('idle'); report('needs_you');
  assert.deepEqual(spawned.map((s) => [s.bin, ...s.args]), [
    ['/n/node', '/sup/bin/agy-report-bridge.js', 'PreInvocation'],
    ['/n/node', '/sup/bin/agy-report-bridge.js', 'Stop'],
  ], 'only working and idle are reported, through the named bridge');
  assert.deepEqual(spawned[0].stdin, ['{}']);
  assert.equal(spawned[0].env.TMUX_PANE, '%9', 'the pane identity must reach the bridge');
  // A spawn that throws is swallowed.
  assert.doesNotThrow(() => front.makeReporter({ spawn: () => { throw new Error('no'); } })('working'));
});

test('the bridge maps the two events the front sends to working and idle', () => {
  const bridge = require('../bin/agy-report-bridge.js');
  assert.deepEqual(bridge.reportFor('PreInvocation', {}), { state: 'working', text: '' });
  assert.deepEqual(bridge.reportFor('Stop', {}), { state: 'idle', text: '' });
});
