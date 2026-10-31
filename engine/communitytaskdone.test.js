'use strict';
/* #5313: the event-driven community prompt fired when an agent marks a task built or closed.
 * promptOnTaskDone is pure apart from the injected deliver/reads, so every gate is a stub; readBook/
 * writeBook run against a sandboxed data root.
 *
 *   node --test engine/communitytaskdone.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-communitytaskdone-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const td = require('./communitytaskdone');
const { POSTS_PER_DAY_MAX } = require('./communityblock');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const NOW = Date.parse('2026-10-26T16:30:00Z');
const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };

/* All gates open, nobody posted today, a capturing deliver that reports PLACED. Each test overrides
   only the knob it is about. `sent` captures the (session, text) deliver saw. */
function setup(over = {}) {
  const sent = [];
  const o = {
    projectId: 'proj1', taskNumber: 7, session: 'ann', name: 'Ann', trigger: 'built',
    now: NOW, book: new Map(),
    liveAllowed: () => true, brakeOn: () => false, switchOn: () => true, prompterOn: () => true,
    inCommunity: () => true,
    postTimes: () => [],
    deliver: (session, text) => { sent.push({ session, text }); return { state: D.PLACED }; },
    DELIVERY: D,
    ...over,
  };
  return { o, sent };
}

test('a built mark prompts once: delivered, recorded, booked by task', () => {
  const { o, sent } = setup();
  const r = td.promptOnTaskDone(o);
  assert.equal(r.act, 'prompted');
  assert.equal(r.recorded, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].session, 'ann');
  assert.match(sent[0].text, /you just marked a task built/);
  assert.match(sent[0].text, /kosmos community post/);
  assert.equal(o.book.has('proj1\t7'), true);
});

test('the card: a SECOND built mark on the same task sends none', () => {
  const { o, sent } = setup();
  td.promptOnTaskDone(o);                         // first mark: prompts
  const second = td.promptOnTaskDone(o);          // same book, same task
  assert.equal(second.act, 'deduped');
  assert.equal(second.recorded, false);
  assert.equal(sent.length, 1, 'the second built mark on the same task delivered again');
});

test('built then CLOSE of the same task prompts only once (one per task)', () => {
  const { o, sent } = setup();
  td.promptOnTaskDone(o);                                   // built: prompts
  const close = td.promptOnTaskDone({ ...o, trigger: 'closed' });   // same book + task, close
  assert.equal(close.act, 'deduped');
  assert.equal(sent.length, 1);
});

test('a close prompts with the closed wording when the task was not prompted before', () => {
  const { o, sent } = setup({ trigger: 'closed' });
  const r = td.promptOnTaskDone(o);
  assert.equal(r.act, 'prompted');
  assert.match(sent[0].text, /you just marked a task closed/);
});

test('each gate off sends nothing and books nothing', () => {
  for (const [label, over, expect] of [
    ['live-exec off', { liveAllowed: () => false }, 'off'],
    ['operator brake on', { brakeOn: () => true }, 'off'],
    ['global community switch off', { switchOn: () => false }, 'off'],
    ['prompter off', { prompterOn: () => false }, 'off'],
    ['not in the community', { inCommunity: () => false }, 'not-in-community'],
  ]) {
    const { o, sent } = setup(over);
    const r = td.promptOnTaskDone(o);
    assert.equal(r.act, expect, label);
    assert.equal(sent.length, 0, label + ': delivered anyway');
    assert.equal(o.book.size, 0, label + ': booked anyway');
  }
});

test('a gated-off first mark does NOT burn the task: it still prompts once the gate opens', () => {
  const book = new Map();
  const off = setup({ liveAllowed: () => false, book });
  assert.equal(td.promptOnTaskDone(off.o).act, 'off');
  assert.equal(book.size, 0);
  const on = setup({ book });                 // same book, gate now open
  const r = td.promptOnTaskDone(on.o);
  assert.equal(r.act, 'prompted', 'a task gated off on the first mark was wrongly treated as already prompted');
  assert.equal(on.sent.length, 1);
});

test('the daily post ceiling stops it; one under does not', () => {
  const full = Array.from({ length: POSTS_PER_DAY_MAX }, (_, i) => new Date(NOW - (1 + i) * 3600e3).toISOString());
  const atMax = setup({ postTimes: () => full });
  assert.equal(td.promptOnTaskDone(atMax.o).act, 'daily-max');
  assert.equal(atMax.sent.length, 0);
  const under = setup({ postTimes: () => full.slice(1) });
  assert.equal(td.promptOnTaskDone(under.o).act, 'prompted', 'CONTROL: one under the daily maximum prompts');
});

test('an unreadable post history prompts nobody', () => {
  const { o, sent } = setup({ postTimes: () => null });
  assert.equal(td.promptOnTaskDone(o).act, 'posts-unreadable');
  assert.equal(sent.length, 0);
});

test('the per-agent daily event cap stops a burst', () => {
  const book = new Map();
  for (let i = 0; i < td.PROMPTS_PER_DAY; i += 1) book.set('proj1\t' + (100 + i), { at: NOW - i * 60e3, session: 'ann' });
  const { o, sent } = setup({ book });
  assert.equal(td.promptOnTaskDone(o).act, 'agent-daily-cap');
  assert.equal(sent.length, 0);
  // CONTROL: those entries older than a day no longer count against the cap.
  const old = new Map();
  for (let i = 0; i < td.PROMPTS_PER_DAY; i += 1) old.set('proj1\t' + (100 + i), { at: NOW - td.DAY_MS - i * 60e3, session: 'ann' });
  assert.equal(td.promptOnTaskDone(setup({ book: old }).o).act, 'prompted');
});

test('a PLACED-into-a-busy-composer (Queued, #5216) delivery DID land: counts and books', () => {
  // The real "visible as Queued" case: chat types into a mid-turn composer and it is submitted when
  // the turn ends -> state PLACED with queued:true. This is what reaches a BUSY agent (the card's point).
  const { o } = setup({ deliver: () => ({ state: D.PLACED, queued: true }) });
  const r = td.promptOnTaskDone(o);
  assert.equal(r.act, 'queued');
  assert.equal(r.recorded, true);
  assert.equal(o.book.has('proj1\t7'), true, 'a landed (Queued) prompt must dedup so a second mark sends none');
});

test('a HELD delivery (agent paused: chat typed NOTHING, no retry on the event path) does NOT book', () => {
  // deliverAutomatic returns held:true with state COULD_NOT for a quota/cap/menu/usage-limit/signed-out
  // hold, and via inputHold() for the composer-holds-the-person's-text case (heldBy 'input', also busy:true).
  // In EVERY one nothing was typed; the hold's "keep for the member's next arrival" is a room-post
  // behaviour this direct path lacks. Booking it would burn the per-task dedup for a prompt that never
  // landed and will never be retried -- the defect this test guards. The sweep likewise leaves held unbooked.
  const heldShapes = [
    { state: D.COULD_NOT, held: true, heldBy: 'quota' },
    { state: D.COULD_NOT, held: true, heldBy: 'menu' },
    { state: D.COULD_NOT, held: true, heldBy: 'limit' },
    { state: D.COULD_NOT, inputHeld: true, busy: true, held: true, heldBy: 'input' },
  ];
  for (const shape of heldShapes) {
    const { o } = setup({ deliver: () => ({ ...shape }) });
    const r = td.promptOnTaskDone(o);
    assert.equal(r.act, 'held', `heldBy=${shape.heldBy} should report act 'held'`);
    assert.equal(r.recorded, false, `heldBy=${shape.heldBy} must not record`);
    assert.equal(o.book.has('proj1\t7'), false, `held (heldBy=${shape.heldBy}) must NOT book so a later mark can retry`);
  }
});

test('a busy collision does NOT book the task (safe to try again on a later mark)', () => {
  const { o } = setup({ deliver: () => ({ state: D.COULD_NOT, busy: true }) });
  const r = td.promptOnTaskDone(o);
  assert.equal(r.act, 'pane-busy');
  assert.equal(r.recorded, false);
  assert.equal(o.book.size, 0);
});

test('a bare COULD_NOT does not book (chat says it is safe to re-send)', () => {
  const { o } = setup({ deliver: () => ({ state: D.COULD_NOT }) });
  const r = td.promptOnTaskDone(o);
  assert.equal(r.act, 'not-reached');
  assert.equal(o.book.size, 0);
});

test('a throw from deliver is UNCONFIRMED (reached) and books the task', () => {
  const { o } = setup({ deliver: () => { throw new Error('paste then died'); } });
  const r = td.promptOnTaskDone(o);
  assert.equal(r.act, 'prompted');
  assert.equal(r.recorded, true);
});

test('an odd deliver verdict (null/undefined/non-object) is not-reached and does not book', () => {
  for (const v of [null, undefined, {}, 'nope', 42, { state: 'mystery' }]) {
    const { o } = setup({ deliver: () => v });
    const r = td.promptOnTaskDone(o);
    assert.equal(r.act, 'not-reached', `verdict ${JSON.stringify(v)} must be not-reached`);
    assert.equal(r.recorded, false, `verdict ${JSON.stringify(v)} must not record`);
    assert.equal(o.book.size, 0, `verdict ${JSON.stringify(v)} must not book`);
  }
});

test('queued:true on a NON-reached state does not read as queued (only reached + queued is Queued)', () => {
  // A stray queued flag on a COULD_NOT verdict must not be treated as a landed Queued prompt.
  const { o } = setup({ deliver: () => ({ state: D.COULD_NOT, queued: true }) });
  const r = td.promptOnTaskDone(o);
  assert.equal(r.act, 'not-reached');
  assert.equal(r.recorded, false);
  assert.equal(o.book.size, 0);
});

test('an unknown trigger falls back to the built wording (never throws, always a string)', () => {
  assert.match(td.taskDoneText('built'), /you just marked a task built/);
  assert.match(td.taskDoneText('closed'), /you just marked a task closed/);
  assert.match(td.taskDoneText('weird'), /you just marked a task built/);   // anything but 'closed' -> built
  assert.match(td.taskDoneText(undefined), /you just marked a task built/);
});

test('bad input never throws', () => {
  assert.equal(td.promptOnTaskDone(null).act, 'bad-input');
  assert.equal(td.promptOnTaskDone({}).act, 'bad-input');
  assert.equal(td.promptOnTaskDone({ session: 'ann', projectId: 'p', taskNumber: 1 }).act, 'bad-input');   // no deliver
  assert.equal(td.promptOnTaskDone({ deliver: () => ({}), projectId: 'p', taskNumber: 1 }).act, 'bad-input'); // no session
});

test('a throwing PROCEED gate reads as closed, never throws', () => {
  const { o } = setup({ switchOn: () => { throw new Error('boom'); } });
  assert.equal(td.promptOnTaskDone(o).act, 'off');
});

test('a throwing operator brake reads as ENGAGED (fail-safe: a STOP gate throw must stop)', () => {
  // The brake is a stop gate, so unlike the proceed gates a throw must read as ON, not off, or a
  // broken brake would let prompts through exactly when the operator meant to stop them.
  const { o } = setup({ brakeOn: () => { throw new Error('brake read failed'); } });
  const r = td.promptOnTaskDone(o);
  assert.equal(r.act, 'off');
  assert.equal(r.recorded, false);
  assert.equal(o.book.size, 0, 'a fail-safe brake must not book');
});

test('readBook / writeBook round-trip, prune past retention, unreadable reads empty', () => {
  const book = new Map();
  book.set('proj1\t7', { at: NOW, session: 'ann' });
  book.set('proj1\t8', { at: NOW - td.RETENTION_MS - 1000, session: 'bea' });   // past retention: dropped on write
  assert.equal(td.writeBook(book, NOW), true);
  const back = td.readBook();
  assert.equal(back.has('proj1\t7'), true);
  assert.equal(back.has('proj1\t8'), false, 'an entry past retention was kept');
  assert.equal(back.get('proj1\t7').session, 'ann');
  // Unreadable / absent file reads as an empty book.
  fs.writeFileSync(td.bookFile(), 'not json{');
  assert.equal(td.readBook().size, 0);
});

/* kosmos#7649: the board's sender awaits the delivery. Same decision, same verdict reading, same book. */
const later = (v, ms = 5) => new Promise((res) => setTimeout(() => res(v), ms));

test('kosmos#7649 promptOnTaskDoneAsync: same result and book as promptOnTaskDone for every verdict and every gate', async () => {
  const verdicts = {
    placed: () => ({ state: D.PLACED }), queued: () => ({ state: D.PLACED, queued: true }), unconfirmed: () => ({ state: D.UNCONFIRMED }),
    couldNot: () => ({ state: D.COULD_NOT }), held: () => ({ state: D.COULD_NOT, held: true }), busy: () => ({ state: D.COULD_NOT, busy: true }),
    throws: () => { throw new Error('after the paste'); },
  };
  const gates = {
    none: {}, off: { switchOn: () => false }, braked: { brakeOn: () => true }, notMember: { inCommunity: () => false },
    unreadable: { postTimes: () => null }, deduped: { book: new Map([['proj1\t7', { at: NOW, session: 'ann' }]]) },
  };
  for (const [vn, f] of Object.entries(verdicts)) {
    for (const [gn, g] of Object.entries(gates)) {
      const a = setup({ ...g, book: new Map(g.book || []), deliver: f });
      const b = setup({ ...g, book: new Map(g.book || []), deliver: () => later(null).then(f) });   // a throw in the promise is a rejection
      const ra = td.promptOnTaskDone(a.o);
      const rb = await td.promptOnTaskDoneAsync(b.o);
      assert.deepEqual(rb, ra, vn + '/' + gn + ': results differ');
      assert.deepEqual([...b.o.book], [...a.o.book], vn + '/' + gn + ': book differs');
    }
  }
  // CONTROL: the comparison can fail. A held verdict and a placed one do not book alike.
  const h = setup({ deliver: verdicts.held }); td.promptOnTaskDone(h.o);
  const p = setup({ deliver: verdicts.placed }); td.promptOnTaskDone(p.o);
  assert.notDeepEqual([...h.o.book], [...p.o.book]);
});

test('kosmos#7649 promptOnTaskDoneAsync: a late answer is booked when it lands, and a second mark after it is deduped', async () => {
  const sends = [];
  const { o } = setup({ deliver: (s) => { sends.push(s); return later({ state: D.PLACED }); } });
  const r = await td.promptOnTaskDoneAsync(o);
  assert.equal(r.act, 'prompted');
  assert.deepEqual(o.book.get('proj1\t7'), { at: NOW, session: 'ann' });
  assert.equal((await td.promptOnTaskDoneAsync({ ...o, trigger: 'closed' })).act, 'deduped');
  assert.deepEqual(sends, ['ann']);
});

test('kosmos#7649: two prompts for one task run at once DO both deliver, which is why server.js runs them one after another', async () => {
  const sends = [];
  const book = new Map();
  const { o } = setup({ book, deliver: (s) => { sends.push(s); return later({ state: D.PLACED }); } });
  await Promise.all([td.promptOnTaskDoneAsync(o), td.promptOnTaskDoneAsync({ ...o, trigger: 'closed' })]);
  assert.deepEqual(sends, ['ann', 'ann'], 'the overlap the server chain (server.communitytaskdone-5313.test.js) exists for');
  // CONTROL: one after the other, the second is deduped.
  const seq = []; const s2 = setup({ deliver: (s) => { seq.push(s); return later({ state: D.PLACED }); } });
  await td.promptOnTaskDoneAsync(s2.o); await td.promptOnTaskDoneAsync({ ...s2.o, trigger: 'closed' });
  assert.deepEqual(seq, ['ann']);
});

test('kosmos#7649 promptOnTaskDoneAsync: never rejects, whatever the input', async () => {
  assert.equal((await td.promptOnTaskDoneAsync(null)).act, 'bad-input');
  const bad = setup({ deliver: () => Promise.reject(new Error('x')) });
  assert.equal((await td.promptOnTaskDoneAsync(bad.o)).act, 'prompted', 'a rejection reads as UNCONFIRMED, which reached');
});

test('kosmos#7649: a pane still placing another message is pane-busy, not typed after it, and leaves the task unbooked (as the sync sender)', async () => {
  const sends = [];
  const { o } = setup({ paneBusy: () => ({ state: D.COULD_NOT, busy: true }), deliver: (s) => { sends.push(s); return later({ state: D.PLACED }); } });
  const r = await td.promptOnTaskDoneAsync(o);
  assert.equal(r.act, 'pane-busy');
  assert.deepEqual(sends, []);
  assert.equal(o.book.size, 0);
  // CONTROL: a free pane is sent to.
  const free = setup({ paneBusy: () => null, deliver: () => later({ state: D.PLACED }) });
  assert.equal((await td.promptOnTaskDoneAsync(free.o)).act, 'prompted');
});

test('kosmos#7649: a delivery that never answers counts as unconfirmed after the deadline, is booked, and the prompt ends', async () => {
  const { o } = setup({ deliverDeadlineMs: 20, deliver: () => new Promise(() => {}) });
  const r = await td.promptOnTaskDoneAsync(o);
  assert.deepEqual([r.act, r.delivery, r.recorded], ['prompted', D.UNCONFIRMED, true]);
  assert.equal(o.book.has('proj1\t7'), true);
  assert.equal(td.DELIVER_DEADLINE_MS, 3 * 60 * 1000, 'the board default');
});

test('kosmos#7649 review 3: a sender that throws at once reads as unconfirmed (as the sync path), and a busy check that throws lets the prompt go', async () => {
  const thrower = setup({ deliver: () => { throw new Error('after the paste'); } });
  const r = await td.promptOnTaskDoneAsync(thrower.o);
  assert.deepEqual([r.act, r.delivery, r.recorded], ['prompted', D.UNCONFIRMED, true]);
  const sends = [];
  const bad = setup({ paneBusy: () => { throw new Error('busy check failed'); }, deliver: (s) => { sends.push(s); return later({ state: D.PLACED }); } });
  assert.equal((await td.promptOnTaskDoneAsync(bad.o)).act, 'prompted');
  assert.deepEqual(sends, ['ann']);
});

test('kosmos#7649 review 5: a prompt the gates refuse asks neither paneBusy nor deliver (so the board reads no roster for it)', async () => {
  for (const [name, over] of Object.entries({ deduped: { book: new Map([['proj1\t7', { at: NOW, session: 'ann' }]]) }, off: { prompterOn: () => false }, notMember: { inCommunity: () => false } })) {
    const asked = [];
    const { o } = setup({ ...over, paneBusy: () => { asked.push('paneBusy'); return null; }, deliver: () => { asked.push('deliver'); return later({ state: D.PLACED }); } });
    await td.promptOnTaskDoneAsync(o);
    assert.deepEqual(asked, [], name);
  }
  // CONTROL: a prompt that sends asks paneBusy, then delivers.
  const asked = [];
  const { o } = setup({ paneBusy: () => { asked.push('paneBusy'); return null; }, deliver: () => { asked.push('deliver'); return later({ state: D.PLACED }); } });
  await td.promptOnTaskDoneAsync(o);
  assert.deepEqual(asked, ['paneBusy', 'deliver']);
});
