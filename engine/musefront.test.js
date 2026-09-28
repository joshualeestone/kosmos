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
function harness(answers) {
  const calls = []; const reports = []; let out = '';
  let n = 0;
  const pending = [];
  const runTurn = (input) => {
    calls.push(input);
    const i = n; n += 1;   // counted before a throwing answer, so the next call gets the next one
    const a = typeof answers === 'function' ? answers(input, i) : answers[i];
    if (a === 'hold') return new Promise((resolve) => pending.push(resolve));
    return Promise.resolve(a);
  };
  const f = front.createFront({ workspace: '/w', sessionId: '11111111-2222-4333-8444-555555555555', runTurn, report: (s) => reports.push(s), write: (t) => { out += t; } });
  return { f, calls, reports, out: () => out, pending };
}
const OK = (text) => ({ ok: true, text, because: null });

test('one Enter is one message: chunked bytes before it are one turn, on this agent\'s session, never asking', async () => {
  const h = harness([OK('DONE')]);
  h.f.feed('Append a ');
  h.f.feed(Buffer.from('line to hello'));
  h.f.feed('.txt\r');
  await h.f.drained();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { workspace: '/w', sessionId: '11111111-2222-4333-8444-555555555555', prompt: 'Append a line to hello.txt', approvalMode: 'never' });
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
  fs.writeFileSync(file, 'not-a-uuid\n');
  const c = front.loadSession(dir, { randomUUID: () => '99999999-8888-4777-8666-555555555555' });
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
