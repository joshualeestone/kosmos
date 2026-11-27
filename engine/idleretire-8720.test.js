'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8720: engine/idleretire.js, retiring agents that have not run in N days (opt-in, off by default), through the
 * board's own Remove. Every protection has a control: the same agent without it is retired.
 *
 *   node --test engine/idleretire-8720.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* The data root BEFORE any store-using require (repo convention 2). */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'idleretire-8720-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const ir = require('./idleretire');
const store = require('./store');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const DAY = 86400000;
const NOW = Date.parse('2026-11-27T18:00:00Z');
const ago = (d) => new Date(NOW - d * DAY).toISOString();
function clean() { fs.mkdirSync(store.ROOT, { recursive: true }); for (const f of ['idleretire.json', 'idleretire-log.json']) fs.rmSync(path.join(store.ROOT, f), { force: true }); }

/* Readers over a plain table: { name: { at, state, task, project } }. */
function readersOf(table) {
  return {
    lastBeat: (n) => (table[n] && table[n].at ? { found: true, at: table[n].at } : { found: false }),
    latestState: (n) => (table[n] && table[n].state) || null,
    onOpenTask: (n) => !!(table[n] && table[n].task),
    activeProject: (n) => (table[n] && table[n].project) || null,
  };
}
const rows = (...names) => names.map((n) => ({ sessionName: n, displayName: n.toUpperCase() }));
const verdictOf = (list, name) => list.find((v) => v.name === name);

test('the setting is off by default, 30 days; a damaged file reads off; days outside 14/30/60/90 are refused', () => {
  clean();
  assert.deepEqual(ir.readSetting(), { on: false, days: 30, ok: true });
  fs.writeFileSync(path.join(store.ROOT, 'idleretire.json'), '{not json');
  assert.deepEqual(ir.readSetting(), { on: false, days: 30, ok: false });
  clean();
  assert.equal(ir.writeSetting({ days: 7 }).ok, false);
  assert.equal(ir.writeSetting({ on: 'yes' }).ok, false);
  assert.deepEqual(ir.writeSetting({ on: true }).setting, { on: true, days: 30 });
  assert.deepEqual(ir.writeSetting({ days: 60 }).setting, { on: true, days: 60 }, 'changing days turned it off');
  assert.deepEqual(ir.readSetting(), { on: true, days: 60, ok: true });
  clean();
});

test('assess: idle past N days is retire; under N is keep; no record at all is unknown, never retire', () => {
  const t = { old: { at: ago(31) }, edge: { at: ago(30) }, fresh: { at: ago(29) }, today: { at: ago(0) }, never: {} };
  const v = ir.assess(rows('old', 'edge', 'fresh', 'today', 'never'), readersOf(t), { days: 30, now: NOW });
  assert.equal(verdictOf(v, 'old').verdict, 'retire');
  assert.equal(verdictOf(v, 'old').days, 31);
  assert.equal(verdictOf(v, 'edge').verdict, 'retire', 'exactly N days is idle N days');
  assert.equal(verdictOf(v, 'fresh').verdict, 'keep');
  assert.match(verdictOf(v, 'today').why, /ran today/);
  assert.equal(verdictOf(v, 'never').verdict, 'unknown');
  assert.equal(verdictOf(v, 'never').days, null);
  assert.equal(verdictOf(v, 'old').shownAs, 'OLD');
  /* The days setting is what decides: at 14, the 29-day agent is retired too. */
  assert.equal(verdictOf(ir.assess(rows('fresh'), readersOf(t), { days: 14, now: NOW }), 'fresh').verdict, 'retire');
});

test('assess: each protection keeps an idle agent and says why; the same agent without it is retired (control)', () => {
  const idle = ago(90);
  const cases = [
    ['guide', { at: idle }, { isGuide: true }, /setup guide/],
    ['asking', { at: idle, state: 'needs_you' }, {}, /waits on you/],
    ['blocked', { at: idle, state: 'blocked' }, {}, /waits on you/],
    ['tasked', { at: idle, task: true }, {}, /open task/],
    ['member', { at: idle, project: 'Launch' }, {}, /on the project Launch/],
  ];
  for (const [name, rec, extra, why] of cases) {
    const kept = verdictOf(ir.assess([{ sessionName: name, ...extra }], readersOf({ [name]: rec }), { days: 30, now: NOW }), name);
    assert.equal(kept.verdict, 'keep', name);
    assert.match(kept.why, why, name);
    const bare = verdictOf(ir.assess([{ sessionName: name }], readersOf({ [name]: { at: idle, state: 'idle' } }), { days: 30, now: NOW }), name);
    assert.equal(bare.verdict, 'retire', name + ' control: without the protection it is retired');
  }
});

test('assess: a reader that throws protects the agent (never retire on a failed read)', () => {
  const base = readersOf({ x: { at: ago(90) } });
  for (const k of ['latestState', 'onOpenTask', 'activeProject']) {
    const r = { ...base, [k]: () => { throw new Error('boom'); } };
    assert.equal(verdictOf(ir.assess(rows('x'), r, { days: 30, now: NOW }), 'x').verdict, 'keep', k);
  }
  const noBeat = { ...base, lastBeat: () => { throw new Error('boom'); } };
  assert.equal(verdictOf(ir.assess(rows('x'), noBeat, { days: 30, now: NOW }), 'x').verdict, 'unknown');
});

test('makeTick: off or not allowed does nothing; on, it removes each retire verdict once a day, through remove()', () => {
  clean();
  const removed = [];
  const t = { old: { at: ago(40) }, fresh: { at: ago(2) }, never: {}, member: { at: ago(40), project: 'P' } };
  let allowed = true;
  let clock = NOW;
  const tick = ir.makeTick({ allowed: () => allowed, roster: () => rows('old', 'fresh', 'never', 'member'), readers: readersOf(t),
    remove: (n) => { removed.push(n); return { outcome: 'removed' }; }, now: () => clock });
  assert.equal(tick().because, 'off');
  ir.writeSetting({ on: true });
  allowed = false;
  assert.equal(tick().because, 'live execution is off');
  assert.deepEqual(removed, []);
  allowed = true;
  const first = tick();
  assert.equal(first.act, 'ran');
  assert.deepEqual(removed, ['old'], 'only the idle, unprotected, measured agent was removed');
  assert.equal(tick().because, 'already ran today');
  assert.deepEqual(removed, ['old']);
  const log = ir.readLog();
  assert.equal(log.retired.length, 1);
  assert.equal(log.retired[0].name, 'old');
  assert.equal(log.retired[0].outcome, 'removed');
  assert.equal(log.retired[0].days, 40);
  /* The next day it runs again. */
  clock = NOW + DAY;
  t.old = {};   // put back: no record until it reports, so it is not removed again
  assert.equal(tick().act, 'ran');
  assert.deepEqual(removed, ['old'], 'a put-back agent with no record was retired again');
  clean();
});

test('makeTick: a refused, partial or throwing remove is recorded as what happened, not as retired', () => {
  clean();
  ir.writeSetting({ on: true });
  const t = { a: { at: ago(40) }, b: { at: ago(40) }, c: { at: ago(40) } };
  const answers = { a: { outcome: 'refused', because: 'busy' }, b: { outcome: 'partial', because: 'the session did not stop' } };
  const tick = ir.makeTick({ allowed: () => true, roster: () => rows('a', 'b', 'c'), readers: readersOf(t), now: () => NOW,
    remove: (n) => { if (n === 'c') throw new Error('gone wrong'); return answers[n]; } });
  const r = tick();
  assert.deepEqual(r.did.map((d) => [d.name, d.outcome]), [['a', 'refused'], ['b', 'partial'], ['c', 'refused']]);
  assert.equal(r.did[0].because, 'busy');
  assert.match(r.did[2].because, /gone wrong/);
  clean();
});

test('the log keeps the newest 50 retirements', () => {
  clean();
  ir.writeSetting({ on: true });
  const names = Array.from({ length: 60 }, (_, i) => 'a' + i);
  const table = Object.fromEntries(names.map((n) => [n, { at: ago(40) }]));
  ir.makeTick({ allowed: () => true, roster: () => rows(...names), readers: readersOf(table), now: () => NOW, remove: () => ({ outcome: 'removed' }) })();
  const log = ir.readLog();
  assert.equal(log.retired.length, ir.KEEP_LOG);
  assert.equal(log.retired[0].name, 'a59', 'not newest first');
  clean();
});

test('realReaders read the board records: no liveness record is unknown; a fresh beat is kept', () => {
  clean();
  const liveness = require('./liveness');
  const r = ir.realReaders();
  assert.equal(r.lastBeat('nobody-8720').found, false);
  liveness.seen('someone-8720');
  const v = ir.assess(rows('someone-8720', 'nobody-8720'), r, { days: 14 });
  assert.equal(verdictOf(v, 'someone-8720').verdict, 'keep');
  assert.equal(verdictOf(v, 'nobody-8720').verdict, 'unknown');
  liveness.forget('someone-8720');
});
