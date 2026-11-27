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
const rows = (...names) => names.map((n) => ({ sessionName: n, name: n.toUpperCase(), state: 'idle', isNamedOurs: true }));
/* Every day from `from` days ago to today, as the running days a board that never closed would have recorded. */
const upFor = (from) => Array.from({ length: from + 1 }, (_, i) => ir.dayOf(NOW - (from - i) * DAY));
const UP = upFor(100);
const seedUp = (days) => { fs.mkdirSync(store.ROOT, { recursive: true }); fs.writeFileSync(path.join(store.ROOT, 'idleretire-log.json'), JSON.stringify({ up: days })); };
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
  const v = ir.assess(rows('old', 'edge', 'fresh', 'today', 'never'), readersOf(t), { days: 30, now: NOW, upDays: UP });
  assert.equal(verdictOf(v, 'old').verdict, 'retire');
  assert.equal(verdictOf(v, 'old').days, 31);
  assert.equal(verdictOf(v, 'edge').verdict, 'retire', 'exactly N days is idle N days');
  assert.equal(verdictOf(v, 'fresh').verdict, 'keep');
  assert.match(verdictOf(v, 'today').why, /ran today/);
  assert.equal(verdictOf(v, 'never').verdict, 'unknown');
  assert.equal(verdictOf(v, 'never').days, null);
  assert.equal(verdictOf(v, 'old').shownAs, 'OLD');
  /* The days setting is what decides: at 14, the 29-day agent is retired too. */
  assert.equal(verdictOf(ir.assess(rows('fresh'), readersOf(t), { days: 14, now: NOW, upDays: UP }), 'fresh').verdict, 'retire');
});

test('assess: each protection keeps an idle agent and says why; the same agent without it is retired (control)', () => {
  const idle = ago(90);
  const cases = [
    ['guide', { at: idle }, { isGuide: true }, /setup guide/],
    ['asking', { at: idle, state: 'needs_you' }, {}, /waits on you/],
    ['blocked', { at: idle, state: 'blocked' }, {}, /waits on you/],
    ['tasked', { at: idle, task: true }, {}, /open task/],
    ['member', { at: idle, project: 'Launch' }, {}, /on the project Launch/],
    ['busy', { at: idle }, { state: 'working' }, /shows it as working right now/],
    ['asking-now', { at: idle }, { state: 'needs_you' }, /shows it as needs you right now/],
    ['no-state', { at: idle }, { state: undefined }, /shows it as unknown right now/],
    ['restarting', { at: idle }, { state: 'restarting' }, /shows it as restarting right now/],
    ['foreign', { at: idle }, { isNamedOurs: false }, /not an agent Kosmos runs/],
  ];
  for (const [name, rec, extra, why] of cases) {
    const kept = verdictOf(ir.assess([{ sessionName: name, state: 'idle', ...extra }], readersOf({ [name]: rec }), { days: 30, now: NOW, upDays: UP }), name);
    assert.equal(kept.verdict, 'keep', name);
    assert.match(kept.why, why, name);
    for (const state of ['idle', 'stopped']) {
      const bare = verdictOf(ir.assess([{ sessionName: name, state }], readersOf({ [name]: { at: idle, state: 'idle' } }), { days: 30, now: NOW, upDays: UP }), name);
      assert.equal(bare.verdict, 'retire', name + ' control: without the protection it is retired, ' + state);
    }
  }
});

test('assess: a reader that throws protects the agent (never retire on a failed read)', () => {
  const base = readersOf({ x: { at: ago(90) } });
  for (const k of ['latestState', 'onOpenTask', 'activeProject']) {
    const r = { ...base, [k]: () => { throw new Error('boom'); } };
    assert.equal(verdictOf(ir.assess(rows('x'), r, { days: 30, now: NOW, upDays: UP }), 'x').verdict, 'keep', k);
  }
  assert.equal(verdictOf(ir.assess(rows('x'), base, { days: 30, now: NOW, upDays: UP }), 'x').verdict, 'retire', 'control: the same agent with readers that answer');
  const noBeat = { ...base, lastBeat: () => { throw new Error('boom'); } };
  assert.equal(verdictOf(ir.assess(rows('x'), noBeat, { days: 30, now: NOW, upDays: UP }), 'x').verdict, 'unknown');
});

test('makeTick: off or not allowed removes nothing; on, it removes each retire verdict through remove(), each name once a day', () => {
  clean();
  seedUp(upFor(100));
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
  /* A later tick the same day does not try it again (the agent is still on this stub's roster). */
  assert.deepEqual(tick().did, []);
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
  t.old = { at: ago(40) };
  tick();
  assert.deepEqual(removed, ['old', 'old'], 'control: the next day the same idle agent is tried again');
  clean();
});

test('makeTick: a refused, partial or throwing remove is recorded as what happened, not as retired', () => {
  clean();
  seedUp(upFor(100));
  ir.writeSetting({ on: true });
  const t = { a: { at: ago(40) }, b: { at: ago(40) }, c: { at: ago(40) } };
  const answers = { a: { outcome: 'refused', because: 'busy' }, b: { outcome: 'partial', because: 'the session did not stop' } };
  const tick = ir.makeTick({ allowed: () => true, roster: () => rows('a', 'b', 'c'), readers: readersOf(t), now: () => NOW,
    remove: (n) => { if (n === 'c') throw new Error('gone wrong'); return answers[n]; } });
  const r = tick();
  assert.deepEqual(r.did.map((d) => [d.name, d.outcome]), [['a', 'refused'], ['b', 'partial'], ['c', 'partial']]);
  assert.equal(r.did[0].because, 'busy');
  assert.match(r.did[2].because, /gone wrong/);
  clean();
});

test('the log keeps the newest 50 retirements; each tick removes at most MAX_PER_TICK', () => {
  clean();
  seedUp(upFor(100));
  ir.writeSetting({ on: true });
  const names = Array.from({ length: 60 }, (_, i) => 'a' + i);
  const table = Object.fromEntries(names.map((n) => [n, { at: ago(40) }]));
  let left = names.slice();
  const tick = ir.makeTick({ allowed: () => true, roster: () => rows(...left), readers: readersOf(table), now: () => NOW,
    remove: (n) => { left = left.filter((x) => x !== n); return { outcome: 'removed' }; } });
  assert.equal(tick().did.length, ir.MAX_PER_TICK, 'one tick removed more than its cap');
  for (let i = 0; i < 30 && left.length; i += 1) tick();
  assert.equal(left.length, 0, 'the ticks did not get through every idle agent');
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
  const v = ir.assess(rows('someone-8720', 'nobody-8720'), r, { days: 14, upDays: UP });
  assert.equal(verdictOf(v, 'someone-8720').verdict, 'keep');
  assert.equal(verdictOf(v, 'nobody-8720').verdict, 'unknown');
  liveness.forget('someone-8720');
});

test('running days: a board closed for 40 days retires nobody on its first day back; the same gap with Kosmos running retires (control)', () => {
  const t = { old: { at: ago(40) } };
  const closed = [ir.dayOf(NOW - 41 * DAY), ir.dayOf(NOW - 40 * DAY), ir.dayOf(NOW)];
  const back = verdictOf(ir.assess(rows('old'), readersOf(t), { days: 30, now: NOW, upDays: closed }), 'old');
  assert.equal(back.verdict, 'keep');
  assert.match(back.why, /running on only 1 day since it last ran/);
  assert.equal(verdictOf(ir.assess(rows('old'), readersOf(t), { days: 30, now: NOW, upDays: upFor(40) }), 'old').verdict, 'retire');
  assert.equal(verdictOf(ir.assess(rows('old'), readersOf(t), { days: 30, now: NOW, upDays: 'not a list' }), 'old').verdict, 'keep', 'a missing list counted days');
});

test('makeTick records each running day, even while off, and a closed stretch is not one', () => {
  clean();
  let clock = NOW;
  const tick = ir.makeTick({ allowed: () => true, roster: () => [], readers: readersOf({}), now: () => clock, remove: () => ({ outcome: 'removed' }) });
  assert.equal(tick().because, 'off');
  tick();
  clock = NOW + 10 * DAY;
  tick();
  assert.deepEqual(ir.readLog().up, [ir.dayOf(NOW), ir.dayOf(NOW + 10 * DAY)]);
  const notAllowed = ir.makeTick({ allowed: () => false, roster: () => [], readers: readersOf({}), now: () => NOW + 11 * DAY, remove: () => ({}) });
  notAllowed();
  assert.equal(ir.readLog().up.length, 2, 'a tick before live execution counted a running day');
  clean();
});

test('makeTick: a dry-run REMOVED is recorded as refused; a refusal repeated next day is logged once; an unreadable roster does nothing', () => {
  clean();
  seedUp(upFor(100));
  ir.writeSetting({ on: true });
  let clock = NOW;
  let roster = rows('a', 'b');
  const removed = [];
  const tick = ir.makeTick({ allowed: () => true, roster: () => roster, readers: readersOf({ a: { at: ago(40) }, b: { at: ago(40) } }), now: () => clock,
    remove: (n) => { removed.push(n); return n === 'a' ? { outcome: 'removed', dryRun: true, because: 'Nothing actually happened' } : { outcome: 'refused', because: 'held' }; } });
  const r = tick();
  assert.deepEqual(r.did.map((d) => [d.name, d.outcome]), [['a', 'refused'], ['b', 'refused']]);
  clock = NOW + DAY;
  tick();
  assert.deepEqual(removed, ['a', 'b'], 'a refused agent was tried again the next day, not a week later');
  clock = NOW + 8 * DAY;
  tick();
  assert.deepEqual(removed, ['a', 'b', 'a', 'b'], 'control: a week later the refused agents are tried again');
  const bs = ir.readLog().retired.filter((x) => x.name === 'b');
  assert.equal(bs.length, 1, 'the same refusal was logged again');
  assert.equal(bs[0].tried, new Date(NOW + 8 * DAY).toISOString(), 'the repeat did not record when it was tried');
  clock = NOW + 9 * DAY;
  tick();
  assert.equal(removed.length, 4, 'a day after the weekly retry it was tried again');
  clock = NOW + 16 * DAY;
  roster = null;
  assert.equal(tick().because, 'the agent list could not be read');
  assert.equal(removed.length, 4);
  clean();
});

test('realReaders: an open task and a live project protect; a closed task and an archived project do not; an unreadable report protects', () => {
  clean();
  const projects = require('./projects');
  const selfreport = require('./selfreport');
  const name = 'idler-8720';
  const task = (closed) => ({ number: 1, sentence: 's', parts: [{ id: 1, sentence: 's', who: name, ...(closed ? { closedAt: ago(1) } : {}) }], ...(closed ? { closedAt: ago(1) } : {}) });
  const verdict = () => verdictOf(ir.assess(rows(name), { ...ir.realReaders(), lastBeat: () => ({ found: true, at: ago(40) }) }, { days: 30, now: NOW, upDays: UP }), name);
  projects.writeAll([{ id: 'p1', name: 'Atlas', agents: [], tasks: [task(false)] }]);
  assert.match(verdict().why, /open task/);
  projects.writeAll([{ id: 'p1', name: 'Atlas', agents: [], tasks: [task(true)] }]);
  assert.equal(verdict().verdict, 'retire', 'a closed task protected it');
  projects.writeAll([{ id: 'p1', name: 'Atlas', agents: [name], tasks: [] }]);
  assert.match(verdict().why, /on the project Atlas/);
  projects.writeAll([{ id: 'p1', name: 'Atlas', agents: [name], tasks: [], archived: true }]);
  assert.equal(verdict().verdict, 'retire', 'an archived project protected it');
  /* An unreadable self-report: the file exists and cannot be read. */
  const f = selfreport.fileFor(name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.mkdirSync(f, { recursive: true });   // a folder where the file belongs reads as an error, not as never reported
  const unreadable = selfreport.read(name);
  assert.equal(unreadable.because, selfreport.NO_READING.UNREADABLE, 'CONTROL: the fixture reads as unreadable');
  assert.match(verdict().why, /last report could not be read/);
  fs.rmSync(f, { recursive: true, force: true });
  assert.equal(verdict().verdict, 'retire', 'control: with no report file it is retired');
  projects.writeAll([]);
  clean();
});

test('a damaged log is set aside, not overwritten, and reads as no running days', () => {
  clean();
  const f = path.join(store.ROOT, 'idleretire-log.json');
  fs.writeFileSync(f, '{damaged');
  const log = ir.readLog();
  assert.deepEqual(log.up, []);
  const aside = fs.readdirSync(store.ROOT).filter((n) => n.startsWith('idleretire-log.json.damaged-'));
  assert.equal(aside.length, 1, 'the damaged file was not set aside');
  assert.equal(fs.readFileSync(path.join(store.ROOT, aside[0]), 'utf8'), '{damaged');
  assert.equal(fs.existsSync(f), false);
  /* CONTROL: a missing file is not "damaged", so nothing is set aside. */
  ir.readLog();
  assert.equal(fs.readdirSync(store.ROOT).filter((n) => n.startsWith('idleretire-log.json.damaged-')).length, 1);
  for (const n of aside) fs.rmSync(path.join(store.ROOT, n), { force: true });
  clean();
});

test('a log that cannot be READ is left alone and the tick does nothing; one that does not parse is set aside (control)', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () => {
  clean();
  seedUp(upFor(100));
  ir.writeSetting({ on: true });
  const f = path.join(store.ROOT, 'idleretire-log.json');
  const before = fs.readFileSync(f, 'utf8');
  fs.chmodSync(f, 0o000);
  const removed = [];
  let r;
  try {
    assert.equal(ir.readLog().unreadable, true);
    r = ir.makeTick({ allowed: () => true, roster: () => rows('x'), readers: readersOf({ x: { at: ago(40) } }), now: () => NOW, remove: (n) => { removed.push(n); return { outcome: 'removed' }; } })();
  } finally { fs.chmodSync(f, 0o600); }
  assert.equal(r.because, 'its record could not be read, so it did nothing');
  assert.deepEqual(removed, []);
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'an unreadable log was overwritten');
  assert.equal(fs.readdirSync(store.ROOT).filter((n) => n.includes('.damaged-')).length, 0, 'an unreadable log was renamed aside');
  clean();
});

test('view: a retire verdict the tick is holding (refused under a week ago) shows as kept, with the day it is tried again', () => {
  clean();
  const at = new Date(NOW - 2 * DAY).toISOString();
  fs.writeFileSync(path.join(store.ROOT, 'idleretire-log.json'), JSON.stringify({ up: upFor(100), retired: [{ name: 'held', shownAs: 'HELD', at, outcome: 'refused', because: 'busy' }, null, 'junk'] }));
  const v = ir.view(rows('held', 'free'), readersOf({ held: { at: ago(40) }, free: { at: ago(40) } }), NOW).verdicts;
  assert.equal(verdictOf(v, 'held').verdict, 'keep');
  assert.match(verdictOf(v, 'held').why, new RegExp('tries again on ' + ir.dayOf(NOW + 5 * DAY)));
  assert.equal(verdictOf(v, 'free').verdict, 'retire', 'control: an agent with no refusal is shown as retiring');
  assert.equal(ir.readLog().retired.length, 1, 'a junk entry in the log was kept');
  clean();
});
