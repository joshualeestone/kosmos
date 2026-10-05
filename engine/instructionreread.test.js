'use strict';
/* kosmos#5297: the owed "read this section again" lines. node --test engine/instructionreread.test.js */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-instructionreread-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const test = require('node:test');
const assert = require('node:assert/strict');
const ir = require('./instructionreread');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const T = Date.parse('2026-10-05T15:00:00Z');

test('the file is in the sandboxed data root, and an absent or odd file reads as empty', () => {
  assert.ok(ir.file().startsWith(SANDBOX), 'the debt file is outside the sandbox');
  assert.deepEqual(ir.readOwed(), {});
  fs.mkdirSync(path.dirname(ir.file()), { recursive: true });
  fs.writeFileSync(ir.file(), '[1,2]');
  assert.deepEqual(ir.readOwed(), {});
  fs.writeFileSync(ir.file(), JSON.stringify({ a: { at: T, sections: ['community', 'nonsense'] }, b: { at: 'x', sections: ['rules'] }, c: { at: T, sections: [] } }));
  assert.deepEqual(ir.readOwed(), { a: { at: T, n: 1, sections: ['community'] } });
});

test('owe adds a section once and keeps the first time; an unknown section is ignored', () => {
  let o = ir.owe({}, 'ann', 'community', T);
  o = ir.owe(o, 'ann', 'rules', T + 1000);
  o = ir.owe(o, 'ann', 'community', T + 2000);
  o = ir.owe(o, 'ann', 'bogus', T + 3000);
  assert.deepEqual(o, { ann: { at: T, n: 3, sections: ['community', 'rules'] } });
  assert.ok(ir.writeOwed(o));
  assert.deepEqual(ir.readOwed(), o);
  assert.ok(ir.oweNow('bea', 'rules', T));
  assert.deepEqual(ir.readOwed().bea, { at: T, n: 1, sections: ['rules'] });
});

test('settle: a line that landed clears the debt; a held, busy or refused one keeps it; past GIVE_UP_MS it is dropped', () => {
  const o = { ann: { at: T, sections: ['community'] } };
  assert.deepEqual(ir.settle(o, 'ann', { state: D.PLACED }, D, T), {});
  assert.deepEqual(ir.settle(o, 'ann', { state: D.UNCONFIRMED }, D, T), {});
  assert.deepEqual(ir.settle(o, 'ann', { state: D.COULD_NOT, held: true }, D, T), o, 'a quota-held refusal cleared the debt');
  assert.deepEqual(ir.settle(o, 'ann', { state: D.PLACED, busy: true }, D, T), o);
  assert.deepEqual(ir.settle(o, 'ann', null, D, T), o, 'a throw (no verdict) cleared the debt');
  assert.deepEqual(ir.settle(o, 'ann', { state: D.COULD_NOT }, D, T + ir.GIVE_UP_MS + 1), {});
});

test('lineFor names every owed section, the community one by its own heading', () => {
  const cb = require('./communityblock');
  const heading = cb.blockBody().split('\n')[0].replace(/^## /, '');
  assert.ok(ir.lineFor(['community']).includes('"' + heading + '"'));
  const both = ir.lineFor(['community', 'rules']);
  assert.ok(both.includes(heading) && both.includes('the working rules'));
  assert.equal(ir.lineFor([]), null);
  assert.equal(ir.lineFor(['bogus']), null);
});

test('review 2: startedSince ends a debt only on a session start AFTER it began; unknown history keeps it', () => {
  assert.equal(ir.startedSince([{ state: 'started', at: T - 1000 }, { state: 'working', at: T + 1000 }], T), false);
  assert.equal(ir.startedSince([{ state: 'started', at: T + 1000 }], T), true);
  assert.equal(ir.startedSince(null, T), null);
});

test('review 2: mergeCleared removes only the debt the pass ended; one owed again meanwhile (same section) survives', () => {
  const sent = ir.owe({}, 'ann', 'rules', T);                 // n 1: what the pass read and sent
  const reOwed = ir.owe(sent, 'ann', 'rules', T + 5000);      // n 2: owed again while the line was in flight
  assert.deepEqual(ir.mergeCleared(reOwed, { ann: sent.ann.n }), reOwed, 'a debt owed during the send was dropped');
  assert.deepEqual(ir.mergeCleared(sent, { ann: sent.ann.n }), {}, 'CONTROL: the debt the pass ended is removed');
  assert.deepEqual(ir.mergeCleared({ bea: { at: T, n: 1, sections: ['rules'] } }, { ann: 1 }), { bea: { at: T, n: 1, sections: ['rules'] } });
});

/* ---- passOnce, behaviourally (review 3), with real cards from the real producer ---- */
const fleet = require('../test-support/fleet');
const status = require('./status');
const CARDS = (() => {
  const board = fleet.install([fleet.agent('ida', { state: 'idle' }), fleet.agent('ned', { state: 'needs_you' }), fleet.agent('wes', { state: 'working' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
const nudgeable = require('./agentnudge').nudgeableCard;

function passArgs(over = {}) {
  let file = over.owed || {};
  const sent = [];
  return {
    sent, file: () => file,
    o: {
      roster: () => CARDS, isIdle: nudgeable, seenIdle: new Set(['ida', 'ned', 'wes']), now: T + 1000,
      history: () => [], allowed: () => true, DELIVERY: D,
      deliver: async (s, line) => { sent.push([s, line]); return { state: D.PLACED }; },
      read: () => file, write: (o) => { file = o; return true; },
      ...over.o,
    },
  };
}
const debt = (sections = ['community']) => ({ at: T, n: 1, sections });

test('fixture: real cards, ida idle, ned on a question, wes working', () => {
  for (const s of ['ida', 'ned', 'wes']) assert.equal((CARDS.find((c) => c.sessionName === s) || {}).isNamedOurs, true, s);
  assert.equal(nudgeable(CARDS.find((c) => c.sessionName === 'ida')), true);
  assert.equal(nudgeable(CARDS.find((c) => c.sessionName === 'ned')), false, 'fixture: a needs_you card reads idle');
});

test('review 3 BLOCKER: an agent on a question or permission prompt, or working, is never typed into; its debt is kept', async () => {
  const p = passArgs({ owed: { ned: debt(), wes: debt() } });
  const r = await ir.passOnce(p.o);
  assert.deepEqual(p.sent, [], 'a line was typed into an agent that is not idle');
  assert.deepEqual(r.map((x) => [x.session, x.act]).sort(), [['ned', 'not-idle'], ['wes', 'not-idle']]);
  assert.deepEqual(Object.keys(p.file()).sort(), ['ned', 'wes']);
});

test('passOnce: an idle agent seen idle at the previous pass gets the line once, and its debt ends; CONTROL: not seen before, it waits', async () => {
  const wait = passArgs({ owed: { ida: debt(['community', 'rules']) }, o: { seenIdle: new Set() } });
  await ir.passOnce(wait.o);
  assert.deepEqual(wait.sent, [], 'sent to an agent not idle at the previous pass');
  assert.ok(wait.o.seenIdle.has('ida'), 'this pass did not remember the idle card for the next');
  await ir.passOnce(wait.o);
  assert.equal(wait.sent.length, 1);
  assert.equal(wait.sent[0][1], ir.lineFor(['community', 'rules']));
  assert.deepEqual(wait.file(), {});
});

test('passOnce: a refused or held line keeps the debt; live execution off sends nothing', async () => {
  const held = passArgs({ owed: { ida: debt() }, o: { deliver: async () => ({ state: D.COULD_NOT, held: true }) } });
  assert.deepEqual((await ir.passOnce(held.o)).map((x) => x.act), ['kept']);
  assert.ok(held.file().ida);
  const off = passArgs({ owed: { ida: debt() }, o: { allowed: () => false } });
  await ir.passOnce(off.o);
  assert.deepEqual(off.sent, []);
  assert.ok(off.file().ida);
});

test('passOnce: restarted since, gone, and expired debts end without a line; an unreadable or empty roster changes nothing', async () => {
  const p = passArgs({ owed: { ida: debt(), zed: debt(), wes: { at: T - ir.GIVE_UP_MS - 1, n: 1, sections: ['rules'] } },
    o: { history: (s) => (s === 'ida' ? [{ state: 'started', at: T + 500 }] : []), allowed: () => false } });
  const r = await ir.passOnce(p.o);
  assert.deepEqual(r.map((x) => [x.session, x.act]).sort(), [['ida', 'restarted'], ['wes', 'expired'], ['zed', 'gone']]);
  assert.deepEqual(p.sent, []);
  assert.deepEqual(p.file(), {}, 'expiry waited for live execution');
  for (const roster of [() => null, () => []]) {
    const q = passArgs({ owed: { ida: debt() }, o: { roster } });
    await ir.passOnce(q.o);
    assert.deepEqual(q.file(), { ida: debt() });
    assert.deepEqual(q.sent, []);
  }
});

test('passOnce: a debt owed again while its line was being sent survives the write', async () => {
  const p = passArgs({ owed: { ida: debt(['rules']) } });
  p.o.deliver = async (s, line) => { p.sent.push([s, line]); p.o.write(ir.owe(p.file(), 'ida', 'rules', T + 2000)); return { state: D.PLACED }; };
  await ir.passOnce(p.o);
  assert.equal(p.sent.length, 1);
  assert.equal(p.file().ida && p.file().ida.n, 2, 'the debt owed during the send was cleared');
});

test('review 4: oweChanged owes a community re-read to exactly the agents whose rules changed', () => {
  const told = [{ agent: 'ann', changed: true, rulesChanged: true }, { agent: 'bea', changed: true, rulesChanged: false },
    { agent: 'cal', changed: false, rulesChanged: false }, { agent: null, state: 'could_not', rulesChanged: false }];
  const next = ir.oweChanged(told, { dot: { at: T - 5, n: 1, sections: ['rules'] } }, T);
  assert.deepEqual(next, { dot: { at: T - 5, n: 1, sections: ['rules'] }, ann: { at: T, n: 1, sections: ['community'] } });
  assert.deepEqual(ir.oweChanged(null, {}, T), {});
});

test('review 5: just before typing, the card is read again; one that stopped being idle is not typed into', async () => {
  // The same fleet a moment later, with ida now on a question (a real second snapshot, not a hand-built card).
  const ASKING = (() => {
    const board = fleet.install([fleet.agent('ida', { state: 'needs_you' }), fleet.agent('ned', { state: 'needs_you' }), fleet.agent('wes', { state: 'working' })]);
    try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
  })();
  assert.equal(nudgeable(ASKING.find((c) => c.sessionName === 'ida')), false, 'fixture: ida does not read as asking');
  let calls = 0;
  const flip = () => { calls += 1; return calls === 1 ? CARDS : ASKING; };
  const p = passArgs({ owed: { ida: debt() }, o: { roster: flip } });
  const r = await ir.passOnce(p.o);
  assert.deepEqual(p.sent, [], 'typed into a card that was no longer idle at the moment of sending');
  assert.deepEqual(r.map((x) => x.act), ['not-idle']);
  assert.ok(p.file().ida, 'the debt was lost');
});

test('review 5: an agent missing from one roster keeps its debt; missing at two passes ends it', async () => {
  const seenMissing = new Set();
  const p = passArgs({ owed: { zed: debt() }, o: { seenMissing } });
  assert.deepEqual((await ir.passOnce(p.o)).map((x) => x.act), ['missing']);
  assert.ok(p.file().zed);
  assert.ok(seenMissing.has('zed'));
  assert.deepEqual((await ir.passOnce(p.o)).map((x) => x.act), ['gone']);
  assert.deepEqual(p.file(), {});
});

test('review 5: a landed line is recorded with its time (the community turn reads it); a refused one is not', async () => {
  const rec = [];
  const ok = passArgs({ owed: { ida: debt() }, o: { recordSent: (s, at) => rec.push([s, at]) } });
  await ir.passOnce(ok.o);
  assert.deepEqual(rec.map((x) => x[0]), ['ida']);
  const no = passArgs({ owed: { ida: debt() }, o: { recordSent: (s, at) => rec.push([s, at]), deliver: async () => ({ state: D.COULD_NOT }) } });
  await ir.passOnce(no.o);
  assert.equal(rec.length, 1);
  assert.ok(ir.recordSent('ida', T));
  assert.ok(ir.sentTimes('ida').includes(T));
  assert.ok(ir.sentFile().startsWith(SANDBOX));
});
