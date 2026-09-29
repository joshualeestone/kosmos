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

/* #4569 (Josh, 11:57: Mark ignored "stop" twice, behind 14 room posts). */
const OP = (t) => '[message from your operator at 11:52 AM · to answer, run: kosmos reply] ' + t;
const BG = (n) => '[background from your colleague Sam · m' + n + ' · project fivefamilies · not addressed to you] thanks ' + n;
const COL = (t) => '[message from your colleague Dario · m9 · project fivefamilies · to answer, run: kosmos post --in-reply-to m9 fivefamilies] ' + t;

test('#4569: a message from the person runs before waiting room posts, behind only the person\'s earlier ones', async () => {
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok ' + i)));
  h.f.feed('long job\r');
  h.f.feed(COL('can you check X') + '\r');
  h.f.feed(OP('first from Josh') + '\r');
  h.f.feed(OP('second from Josh') + '\r');
  assert.match(h.out(), /queued ahead of other waiting messages: a message from your operator/);
  h.pending[0](OK('done'));
  await within(h.f.drained(), 'the queue did not drain');
  assert.deepEqual(h.calls.map((c) => c.prompt), ['long job', OP('first from Josh'), OP('second from Josh'), COL('can you check X')],
    'the person waited behind a colleague\'s message, or their own two swapped');
  // CONTROL: two colleague messages keep arrival order.
  const c = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  c.f.feed('long job\r'); c.f.feed(COL('a') + '\r'); c.f.feed(COL('b') + '\r');
  c.pending[0](OK('done')); await c.f.drained();
  assert.deepEqual(c.calls.map((x) => x.prompt), ['long job', COL('a'), COL('b')]);
});

test('#4569: "stop" from the person ends the running turn, drops what waits, and runs as the next turn saying what was dropped', async () => {
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('Stopped.')));
  h.f.feed('long job\r');
  for (let n = 1; n <= 14; n++) h.f.feed(BG(n) + '\r');
  h.f.feed(OP('are you there') + '\r');
  h.f.feed(OP('Stop.') + '\r');
  await within(h.f.drained(), '"stop" did not end the running turn');
  assert.equal(h.stops[0], 1, 'the running turn was not stopped');
  assert.equal(h.calls.length, 2, 'a dropped message ran: ' + h.calls.map((c) => c.prompt.slice(0, 40)).join(' | '));
  const note = h.calls[1].prompt;
  assert.match(note, /^\[Kosmos: your operator asked you to stop, so the turn you were on was ended; 14 other waiting messages were dropped; these earlier messages from your operator were dropped unread: "are you there"\. Stop the work you were doing\.\]\n/);
  assert.ok(note.endsWith(OP('Stop.')), 'the stop message itself did not reach the agent');
  assert.match(h.out(), /stopped at your operator's request; 15 waiting messages were dropped/);
  assert.equal(h.reports[h.reports.length - 1], 'idle');
});

test('#4569: only a short stop from the person stops; a longer instruction, a colleague\'s "stop", or a stop with nothing running is a normal message', async () => {
  for (const [label, msg] of [['an instruction', OP('stop posting duplicates and fix the summary')], ['a colleague', COL('stop')]]) {
    const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
    h.f.feed('long job\r'); h.f.feed(BG(1) + '\r'); h.f.feed(msg + '\r');
    assert.equal(h.stops[0], 0, label + ' stopped the running turn');
    h.pending[0](OK('done')); await h.f.drained();
    assert.equal(h.calls.length, 3, label + ': a waiting message was dropped');
  }
  const idle = harness([OK('Nothing to stop.')]);
  idle.f.feed(OP('you can pause') + '\r');
  await within(idle.f.drained(), 'an idle stop hung');
  assert.deepEqual(idle.calls.map((c) => c.prompt), [OP('you can pause')], 'an idle stop got a note about dropping nothing');
  // CONTROL: the same "you can pause" during a turn does stop it.
  const c = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  c.f.feed('long job\r'); c.f.feed(OP('you can pause') + '\r');
  await within(c.f.drained(), 'CONTROL: "you can pause" did not stop');
  assert.equal(c.stops[0], 1);
});

test('#4569: background posts that pile up during a turn run as ONE turn; addressed messages keep their own', async () => {
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  h.f.feed('long job\r');
  h.f.feed(BG(1) + '\r'); h.f.feed(COL('please review') + '\r'); h.f.feed(BG(2) + '\r'); h.f.feed(BG(3) + '\r');
  h.pending[0](OK('done'));
  await h.f.drained();
  assert.equal(h.calls.length, 3, 'three background posts were three turns: ' + h.calls.length);
  const digest = h.calls[1].prompt;
  assert.match(digest, /^\[Kosmos: 3 room posts arrived while you were busy, all background, none addressed to you\. Read them together; answer only if one needs you\.\]\n/);
  assert.ok(digest.includes(BG(1)) && digest.includes(BG(2)) && digest.includes(BG(3)), 'a background post was lost from the digest');
  assert.equal(h.calls[2].prompt, COL('please review'));
  // CONTROL: a single background post runs as itself, with no digest note.
  const c = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  c.f.feed('long job\r'); c.f.feed(BG(1) + '\r');
  c.pending[0](OK('done')); await c.f.drained();
  assert.equal(c.calls[1].prompt, BG(1));
});

test('#4569 review round 1: a stop with Kosmos\'s framing around it (a reply quote, a reactions note, a catch-up note) still stops', async () => {
  for (const [label, words] of [
    ['a reply quote', '(answering: "working on it") stop'],
    ['a reactions note', 'stop [kosmos] reactions from the person you have not been told about yet: \u{1F44D} on "done"'],
    ['a catch-up note', 'you can pause [This room has been talking without you: 3 earlier posts]'],
  ]) {
    const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
    h.f.feed('long job\r'); h.f.feed(OP(words) + '\r');
    await within(h.f.drained(), label + ': the stop did not end the turn');
    assert.equal(h.stops[0], 1, label + ' was not read as a stop');
  }
  // CONTROL: framing around an instruction does not make it a stop.
  const c = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  c.f.feed('long job\r'); c.f.feed(OP('(answering: "stop") keep going') + '\r');
  assert.equal(c.stops[0], 0, 'a quoted "stop" in a reply stopped the turn');
  c.pending[0](OK('done')); await c.f.drained();
});

test('#4569 review round 1: a second stop leaves the first stop\'s note running, so what was dropped is still said', async () => {
  const h = harness((input, i) => ((i === 0 || i === 1) ? 'hold' : OK('ok')));
  h.f.feed('long job\r');
  h.f.feed(OP('are you there') + '\r');
  h.f.feed(OP('stop') + '\r');            // ends turn 0; the note becomes turn 1 (held)
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.length, 2, 'the stop note did not start');
  assert.match(h.calls[1].prompt, /dropped unread: "are you there"/);
  h.f.feed(BG(1) + '\r');
  h.f.feed(OP('STOP!') + '\r');           // must not end the note or replace it
  assert.equal(h.stops[1], 0, 'the second stop ended the first stop\'s note');
  assert.match(h.out(), /already stopping; 1 more waiting message was dropped/);
  h.pending[1](OK('Stopped, sorry.'));
  await within(h.f.drained(), 'the note did not finish');
  assert.equal(h.calls.length, 2, 'something ran after the note: ' + h.calls.map((c) => c.prompt.slice(0, 30)).join(' | '));
});

test('#4569 review round 1: a digest carries at most 40 posts, the newest, and says how many it left out', async () => {
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  h.f.feed('long job\r');
  for (let n = 1; n <= 45; n++) h.f.feed(BG(n) + '\r');
  h.pending[0](OK('done')); await h.f.drained();
  const d = h.calls[1].prompt;
  assert.match(d, /^\[Kosmos: 45 room posts arrived while you were busy, all background, none addressed to you\. The 5 oldest are left out; they are in that project's room \(kosmos room <project-id>\) if you need them\./);
  assert.ok(!d.includes('thanks 5\n') && d.includes('thanks 6\n') && d.endsWith('thanks 45'), 'not the newest 40');
  assert.equal(h.calls.length, 2);
});

test('#4569 review round 2: a digest also stops at 32 KB of posts, keeping the newest; after Escape drops a waiting stop note, a later stop gets its own', async () => {
  const big = (n) => '[background from your colleague Sam \u00b7 m' + n + ' \u00b7 project p \u00b7 not addressed to you] ' + String(n).padStart(3, '0') + 'x'.repeat(3000);
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  h.f.feed('long job\r');
  for (let n = 1; n <= 20; n++) h.f.feed(big(n) + '\r');
  h.pending[0](OK('done')); await h.f.drained();
  const d = h.calls[1].prompt;
  assert.ok(d.length < 34 * 1024, 'the digest is ' + d.length + ' characters');
  assert.match(d, /^\[Kosmos: 20 room posts arrived .* The \d+ oldest are left out;/);
  assert.ok(d.includes('] 020x'), 'the newest post was left out');
  // Escape while a stop note waits: the note is dropped and a later stop still gets its own note.
  const e = harness((input, i) => ((i === 0 || i === 1) ? 'hold' : OK('ok')));   // 0 long job, 1 another job, 2 the later stop's note
  e.f.feed('long job\r'); e.f.feed(OP('stop') + '\r');   // the note waits behind the ending turn
  e.f.feed('\u001b');                                       // Escape: drops the waiting note
  await within(e.f.drained(), 'Escape did not settle');
  assert.equal(e.calls.length, 1, 'a dropped stop note still ran');
  e.f.feed('another job\r'); e.f.feed(OP('stop') + '\r');
  await within(e.f.drained(), 'the later stop did not end the turn');
  assert.match(e.calls[e.calls.length - 1].prompt, /^\[Kosmos: your operator asked you to stop/, 'a later stop was treated as "already stopping"');
});

test('#4569 review round 3: a message sent between two stops is named to the agent, not only in the pane', async () => {
  const h = harness((input, i) => ((i === 0 || i === 1) ? 'hold' : OK('ok')));
  h.f.feed('long job\r');
  h.f.feed(OP('stop') + '\r');                              // turn 0 ends; the note is turn 1 (held)
  await new Promise((r) => setImmediate(r));
  h.f.feed(OP('actually, deploy the fix first') + '\r');   // waits behind the running note
  h.f.feed(OP('stop') + '\r');                              // drops it
  h.pending[1](OK('Stopped.'));
  await within(h.f.drained(), 'the notes did not finish');
  assert.equal(h.calls.length, 3, 'the in-between message was never mentioned to the agent');
  assert.match(h.calls[2].prompt, /^\[Kosmos: your operator asked you to stop again, and these messages from them, sent in between, were dropped unread: "actually, deploy the fix first"\.\]\n/);
  // CONTROL: a second stop with nothing of the person's in between adds no note.
  const c = harness((input, i) => ((i === 0 || i === 1) ? 'hold' : OK('ok')));
  c.f.feed('long job\r'); c.f.feed(OP('stop') + '\r');
  await new Promise((r) => setImmediate(r));
  c.f.feed(BG(1) + '\r'); c.f.feed(OP('stop') + '\r');
  c.pending[1](OK('Stopped.')); await c.f.drained();
  assert.equal(c.calls.length, 2);
  // "hold" is an answer, not a stop.
  const d = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  d.f.feed('long job\r'); d.f.feed(OP('hold') + '\r');
  assert.equal(d.stops[0], 0, '"hold" stopped the turn');
  d.pending[0](OK('done')); await d.f.drained();
});

test('#4569 review round 4: the same dropped message named twice waits as ONE note, and it is still a stop note', async () => {
  const h = harness((input, i) => ((i === 0 || i === 1) ? 'hold' : OK('ok')));
  h.f.feed('long job\r'); h.f.feed(OP('stop') + '\r');
  await new Promise((r) => setImmediate(r));
  h.f.feed(OP('x') + '\r'); h.f.feed(OP('stop') + '\r');   // note 2 names "x"
  h.f.feed(OP('x') + '\r'); h.f.feed(OP('stop') + '\r');   // the same note again: not queued twice
  h.f.feed(OP('y') + '\r');                                // the person's next message queues BEHIND the waiting note
  h.pending[1](OK('Stopped.'));
  await within(h.f.drained(), 'the queue did not drain');
  const prompts = h.calls.map((c) => c.prompt);
  assert.equal(prompts.filter((q) => /stop again/.test(q)).length, 1, 'the identical note ran twice: ' + prompts.length);
  assert.ok(/stop again/.test(prompts[2]) && prompts[3] === OP('y'), 'order: ' + prompts.map((q) => q.slice(0, 30)).join(' | '));
});

test('#4569 review round 5: a stop note Muse refuses as busy (the stopped turn still holding the session) is tried again and runs', async () => {
  const run = require('./muserun');
  let busyLeft = 2;
  const h = harness((input, i) => {
    if (i === 0) return 'hold';
    if (/^\[Kosmos: your operator asked you to stop/.test(input.prompt) && busyLeft > 0) { busyLeft--; return { ok: false, text: '', because: run.BUSY }; }
    return OK('Stopped.');
  }, { busyRetryMs: 5 });
  h.f.feed('long job\r'); h.f.feed(OP('are you there') + '\r'); h.f.feed(OP('stop') + '\r');
  await within(h.f.drained(), 'the retried note never finished');
  const notes = h.calls.filter((c) => /^\[Kosmos: your operator asked you to stop/.test(c.prompt));
  assert.equal(notes.length, 3, 'the note was not tried again after a busy answer');
  assert.ok(!h.out().includes(run.BUSY), 'a busy answer the retry recovered from was printed as a failure');
  assert.match(h.out(), /Stopped\./);
  // CONTROL: an ordinary message refused as busy is not retried (only a stop note is).
  const c = harness([{ ok: false, text: '', because: run.BUSY }], { busyRetryMs: 5 });
  c.f.feed('hello\r'); await within(c.f.drained(), 'an ordinary busy message hung');
  assert.equal(c.calls.length, 1);
  assert.ok(c.out().includes('(' + run.BUSY + ')') && !c.out().includes('Stopped before'), 'an ordinary busy message was retried or relabelled: ' + c.out());
});

test('#4569 review round 5: a second stop counts a colleague\'s dropped message to the agent', async () => {
  const h = harness((input, i) => ((i === 0 || i === 1) ? 'hold' : OK('ok')));
  h.f.feed('long job\r'); h.f.feed(OP('stop') + '\r');
  await new Promise((r) => setImmediate(r));
  h.f.feed(COL('can you check X') + '\r'); h.f.feed(OP('stop') + '\r');
  h.pending[1](OK('Stopped.')); await h.f.drained();
  assert.match(h.calls[2] && h.calls[2].prompt, /^\[Kosmos: your operator asked you to stop again, and 1 message addressed to you was dropped too\.\]\n/);
});

test('#4569 review round 6: Escape during a busy retry\'s wait cancels the note; it never runs after that', async () => {
  const run = require('./muserun');
  assert.equal(run.BUSY, 'Muse Code is still working on this agent\'s last turn', 'musefront spells muserun.BUSY; keep them equal');
  assert.equal(run.STOPPED, 'Stopped before Muse Code finished', 'musefront spells muserun.STOPPED; keep them equal');
  const h = harness((input, i) => {
    if (i === 0) return 'hold';
    if (/^\[Kosmos: your operator asked you to stop/.test(input.prompt)) { input.onStop(() => {}); return { ok: false, text: '', because: run.BUSY }; }   // as muserun: onStop is handed over first
    return OK('ok');
  }, { busyRetryMs: 150 });
  h.f.feed('long job\r'); h.f.feed(OP('stop') + '\r');
  await new Promise((r) => setTimeout(r, 40));    // the note has been refused once and is waiting to retry
  const before = h.calls.length;
  h.f.feed('\u001b');                               // Escape during the wait
  await within(h.f.drained(), 'the front did not settle after Escape');
  assert.equal(h.calls.length, before, 'the cancelled note ran again after Escape');
  assert.match(h.out(), /\(Stopped before Muse Code finished\)\n> $/);
});

test('#4569 review round 7: a stop typed during the wait after Escape starts a fresh note that does not claim a turn was ended', async () => {
  const run = require('./muserun');
  let refusals = 1;
  const h = harness((input, i) => {
    if (i === 0) return 'hold';
    if (/^\[Kosmos: your operator asked you to stop/.test(input.prompt) && refusals-- > 0) { input.onStop(() => {}); return { ok: false, text: '', because: run.BUSY }; }   // as muserun: onStop first
    return OK('ok');
  }, { busyRetryMs: 150 });
  h.f.feed('long job\r'); h.f.feed(OP('stop') + '\r');
  await new Promise((r) => setTimeout(r, 40));      // the first note was refused once; the loop waits (still running)
  h.f.feed('\u001b');                                 // cancels it
  h.f.feed(OP('please stop') + '\r');                // running, nothing waiting, no turn in flight
  await within(h.f.drained(), 'the front did not settle');
  const notes = h.calls.filter((c) => /^\[Kosmos: your operator asked you to stop/.test(c.prompt));
  assert.equal(notes.length, 2, 'expected the cancelled note once and the fresh note once: ' + notes.length);
  assert.match(notes[1].prompt, /^\[Kosmos: your operator asked you to stop, so nothing else was waiting\./, 'the fresh note claimed a turn was ended');
});

test('#4569 review round 8: a note Muse stays busy for is given up after 1 + 4 tries, and says why', async () => {
  const run = require('./muserun');
  const h = harness((input, i) => {
    if (i === 0) return 'hold';
    if (/^\[Kosmos: your operator asked you to stop/.test(input.prompt)) { input.onStop(() => {}); return { ok: false, text: '', because: run.BUSY }; }
    return OK('ok');
  }, { busyRetryMs: 2 });
  h.f.feed('long job\r'); h.f.feed(OP('stop') + '\r');
  await within(h.f.drained(), 'the retries never gave up');
  assert.equal(h.calls.filter((c) => /^\[Kosmos: your operator asked you to stop/.test(c.prompt)).length, 5);
  assert.match(h.out(), new RegExp('\\(' + run.BUSY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)\\n> $'));
  assert.equal(h.reports[h.reports.length - 1], 'idle');
});

test('#4569 review round 8: two stops in one read: the second finds the first note waiting, not yet running', async () => {
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok')));
  h.f.feed('long job\r'); h.f.feed(OP('are you there') + '\r');
  h.f.feed(OP('stop') + '\r' + OP('stop') + '\r');   // one chunk: the note is queued, not started, when the second arrives
  await within(h.f.drained(), 'did not settle');
  const notes = h.calls.filter((c) => /^\[Kosmos: your operator asked you to stop/.test(c.prompt));
  assert.equal(notes.length, 1, 'the second stop replaced or duplicated the waiting note');
  assert.match(notes[0].prompt, /dropped unread: "are you there"/);
});

/* #4569 fix 4 (the write-up: "Working, 14 messages waiting" on the card). */
test('#4569 fix 4: while a turn runs, the board hears how many messages wait and how many are the person\'s, once a burst settles', async () => {
  const sent = [];
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok')), { report: (s, w) => sent.push([s, w ? w.n + '/' + w.yours : '']), noteEveryMs: 20 });
  h.f.feed('long job\r');
  for (let n = 1; n <= 14; n++) h.f.feed(BG(n) + '\r');
  h.f.feed(OP('are you there') + '\r');
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(sent, [['working', ''], ['working', '15/1']], 'a burst was not one report: ' + JSON.stringify(sent));
  h.pending[0](OK('done'));
  await h.f.drained();
  assert.deepEqual(sent[sent.length - 1], ['idle', ''], 'the note outlived the queue');
  // Each turn starts with the count as it is then: the person's message ran first with the 14 posts waiting,
  // then the digest took all 14 at once, leaving nothing.
  assert.deepEqual(sent.slice(2), [['working', '14/0'], ['working', ''], ['idle', '']], JSON.stringify(sent));
});

test('#4569 fix 4: the count follows the person\'s messages, and nothing is reported while idle', async () => {
  const sent = [];
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('ok')), { report: (s, w) => sent.push([s, w ? w.n + '/' + w.yours : '']), noteEveryMs: 10 });
  h.f.feed('long job\r'); h.f.feed(OP('one') + '\r');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent[sent.length - 1][1], '1/1');
  h.f.feed(OP('two') + '\r');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent[sent.length - 1][1], '2/2');
  h.pending[0](OK('done')); await h.f.drained();
  const n = sent.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, n, 'a note was sent after the front went idle');
});

test('#4569 fix 4: the reporter hands the count to the bridge in its payload; the bridge puts it on a working report and throttles by count', () => {
  const spawned = [];
  const spawn = () => { const c = new EventEmitter(); c.stdin = Object.assign(new EventEmitter(), { end: (d) => spawned.push(d) }); c.unref = () => {}; return c; };
  const report = front.makeReporter({ spawn, node: '/n', env: { KOSMOS_MUSE_BRIDGE: '/b.js' } });
  report('working', { n: 3, yours: 1 }); report('working'); report('idle');
  assert.deepEqual(spawned, ['{"kosmosWaiting":{"n":3,"yours":1}}', '{}', '{}']);
  const bridge = require('../bin/agy-report-bridge');
  assert.deepEqual(bridge.reportFor('PreInvocation', { kosmosWaiting: { n: 3, yours: 1 } }), { state: 'working', text: '', waiting: { n: 3, yours: 1 } });
  assert.deepEqual(bridge.buildBody('working', '', { TMUX_PANE: '%1' }, { n: 3, yours: 1 }).waiting, { n: 3, yours: 1 }, 'the count did not reach the report body');
  assert.equal(bridge.reportFor('PreInvocation', { kosmosWaiting: { n: '3', yours: 1 } }).waiting, undefined, 'a count that is not a number was carried');
  assert.deepEqual(bridge.reportFor('PreInvocation', {}), { state: 'working', text: '' }, 'CONTROL: agy\'s own payload still says nothing');
  assert.equal(bridge.reportFor('Stop', { kosmosWaiting: { n: 1, yours: 0 } }).waiting, undefined, 'an idle report carried a count');
  const fs = require('node:fs');
  const env = { KOSMOS_PORT: '9', TMUX_PANE: '%note-' + process.pid };   // this test's own marker (bridge.markerFile)
  fs.rmSync(bridge.markerFile(env), { force: true });
  try {
    const t = 1700000000000;
    assert.equal(bridge.shouldSend('working', t, env, '3/1'), true);
    assert.equal(bridge.shouldSend('working', t + 1000, env, '3/1'), false, 'CONTROL: the same working count within a minute is held back');
    assert.equal(bridge.shouldSend('working', t + 2000, env, '4/1'), true, 'a new count was held back as a repeat');
    assert.equal(bridge.shouldSend('working', t + 3000, env, ''), true, 'clearing the line was held back');
  } finally { fs.rmSync(bridge.markerFile(env), { force: true }); }
});

/* #4612: the turn's answer rides with the idle report, so the DM can show it when no reply arrived. */
test('#4612: an idle report after a turn that finished with words carries its answer and when the turn began', async () => {
  const sent = [];
  const h = harness([OK('Here is the summary you asked for.')], { report: (s, w, final) => sent.push([s, final || null]) });
  const before = Date.now();
  h.f.feed(OP('summarise it') + '\r');
  await h.f.drained();
  const [state, final] = sent[sent.length - 1];
  assert.equal(state, 'idle');
  assert.equal(final && final.text, 'Here is the summary you asked for.');
  assert.ok(Date.parse(final.startedAt) >= before - 5 && Date.parse(final.startedAt) <= Date.now(), 'startedAt is not the turn start: ' + final.startedAt);
  // A DM turn that failed after printing part of an answer, or finished with no words, sends no answer (round 3).
  for (const [label, out] of [['a failed turn with partial words', { ok: false, text: 'partial wor', because: 'Muse Code did not finish the turn' }],
    ['a turn with no words', { ok: true, text: '', because: null }]]) {
    const f = []; const g = harness([out], { report: (s, w, x) => f.push(x || null) });
    g.f.feed(OP('x') + '\r'); await g.f.drained();
    assert.equal(f[f.length - 1], null, label + ' was carried as an answer');
  }
});

test('#4612: the reporter sends the answer as kosmosFinal; the bridge puts it on a Stop only', () => {
  const spawned = [];
  const spawn = () => { const c = new EventEmitter(); c.stdin = Object.assign(new EventEmitter(), { end: (d) => spawned.push(d) }); c.unref = () => {}; return c; };
  front.makeReporter({ spawn, node: '/n', env: { KOSMOS_MUSE_BRIDGE: '/b.js' } })('idle', null, { text: 'done', startedAt: '2026-09-29T17:00:00.000Z' });
  assert.deepEqual(JSON.parse(spawned[0]), { kosmosFinal: { text: 'done', startedAt: '2026-09-29T17:00:00.000Z' } });
  const bridge = require('../bin/agy-report-bridge');
  const r = bridge.reportFor('Stop', { kosmosFinal: { text: 'done', startedAt: '2026-09-29T17:00:00.000Z' } });
  assert.deepEqual(r, { state: 'idle', text: '', final: { text: 'done', startedAt: '2026-09-29T17:00:00.000Z' } });
  assert.deepEqual(bridge.buildBody('idle', '', { TMUX_PANE: '%1' }, null, r.final).final, r.final);
  assert.equal(bridge.reportFor('PreInvocation', { kosmosFinal: { text: 'x', startedAt: '2026-09-29T17:00:00.000Z' } }).final, undefined, 'a working report carried an answer');
  assert.deepEqual(bridge.reportFor('Stop', {}), { state: 'idle', text: '' }, 'CONTROL: agy\'s own Stop is unchanged');
});

test('#4612 review round 1: the answer carried is the DM turn\'s, even when a room turn runs after it', async () => {
  const sent = [];
  const h = harness((input, i) => (i === 0 ? 'hold' : /kosmos reply\]/.test(input.prompt) ? OK('Answer to Josh.') : OK('Nothing here needs me.')),
    { report: (s, w, final) => sent.push([s, final || null]) });
  h.f.feed('long job\r');
  const fedAt = Date.now();
  h.f.feed(OP('are you there') + '\r');    // runs next (the person first)
  h.f.feed(BG(1) + '\r');                  // then the room post
  await new Promise((r) => setTimeout(r, 5));
  h.pending[0](OK('done'));
  await h.f.drained();
  const idle = sent.filter(([s]) => s === 'idle');
  assert.equal(idle.length, 1);
  assert.equal(idle[0][1] && idle[0][1].text, 'Answer to Josh.', 'the room turn\'s answer was carried: ' + JSON.stringify(idle));
  assert.ok(Date.parse(idle[0][1].startedAt) > fedAt, 'startedAt is when the DM was fed, not when its turn began');
  // CONTROL: only room turns ran, so no answer is carried.
  const c = []; const r = harness([OK('Nothing here needs me.')], { report: (s, w, final) => c.push(final || null) });
  r.f.feed(BG(2) + '\r'); await r.f.drained();
  assert.equal(c[c.length - 1], null, 'a room turn\'s answer was carried as a DM answer');
  // A room post from the person (the room envelope) is not a DM either.
  const d = []; const q = harness([OK('Room answer.')], { report: (s, w, final) => d.push(final || null) });
  q.f.feed('[message from your operator · m7 · project p · to answer, run: kosmos post --in-reply-to m7 p] hi\r'); await q.f.drained();
  assert.equal(d[d.length - 1], null, 'a room post from the person was carried as a DM answer');
});

test('#4612 review round 2: a stop note\'s answer is carried (it answers the person\'s stop DM); a later failed DM clears an earlier answer', async () => {
  const sent = [];
  const h = harness((input, i) => (i === 0 ? 'hold' : OK('Stopped, sorry.')), { report: (s, w, final) => sent.push([s, final || null]) });
  h.f.feed('long job\r'); h.f.feed(OP('stop') + '\r');
  await within(h.f.drained(), 'the stop did not settle');
  const idle = sent.filter(([s]) => s === 'idle');
  assert.equal(idle[idle.length - 1][1] && idle[idle.length - 1][1].text, 'Stopped, sorry.', 'the stop note\'s answer was not carried');
  // A DM answered, then a second DM whose turn fails, before any idle: nothing is carried (never the older answer).
  const f = [];
  const g = harness((input, i) => (i === 0 ? 'hold' : i === 1 ? OK('first answer') : { ok: false, text: '', because: 'Muse Code did not finish the turn' }),
    { report: (s, w, final) => f.push([s, final || null]) });
  g.f.feed('long job\r'); g.f.feed(OP('one') + '\r'); g.f.feed(OP('two') + '\r');
  g.pending[0](OK('done')); await g.f.drained();
  assert.equal(f.filter(([s]) => s === 'idle').pop()[1], null, 'an older DM\'s answer was carried for a newer DM whose turn failed');
});

test('#4612 review round 2: every real DM envelope form is recognised, straight from engine/messages.js operatorDirect', async () => {
  const src = require('node:fs').readFileSync(require.resolve('./messages'), 'utf8');
  const at = src.indexOf('function operatorDirect(');
  assert.notEqual(at, -1, 'operatorDirect is gone from engine/messages.js');
  const operatorDirect = new Function(src.slice(at, src.indexOf('\n}\n', at) + 2) + '\nreturn operatorDirect;')();
  const forms = [operatorDirect(null, ''), operatorDirect('11:52 AM', ''),
    operatorDirect(null, ' \u00b7 answers "first words"'), operatorDirect('11:52 AM', ' \u00b7 answers "first words"')];
  for (const env of forms) {
    const finals = [];
    const h = harness([OK('answer')], { report: (s, w, final) => finals.push(final || null) });
    h.f.feed(env + ' hello\r');
    await h.f.drained();
    assert.equal(finals[finals.length - 1] && finals[finals.length - 1].text, 'answer', 'not recognised as a DM: ' + env);
  }
});
