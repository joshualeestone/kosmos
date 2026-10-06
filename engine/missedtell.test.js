'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)

/**
 * kosmos#4787 slice 3: a repeating task's named reviewer is told once per missed slot (engine/missedtell.js).
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/missedtell.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mt-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mt-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');
const mt = require('../engine/missedtell');

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = at(2026, 10, 6, 10, 0);   // the 9am slot is missed (grace 15 minutes)
const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', NOT_FOUND: 'not-found' };

/* A project with one daily-9am task whose rule and reviewer were set two days ago, and no run since. */
function fixture(reviewer, extra = {}) {
  const p = projects.create({ name: 'Watch ' + Math.random().toString(36).slice(2) });
  const n = tasks.create(p.id, { sentence: 'Morning report' }).number;
  const ago = new Date(NOW - 2 * 86400000).toISOString();
  projects.mutate(p.id, (x) => ({
    ...x, agents: ['ada', 'rex'],
    tasks: x.tasks.map((t) => (t.number === n ? { ...t, repeat: { every: 'day', at: '09:00' }, repeatSetAt: ago, lastRunAt: ago,
      parts: [{ n: 1, sentence: 'Morning report', who: 'rex', createdAt: ago }],
      ...(reviewer === 'me' ? { repeatReviewerPerson: true } : reviewer ? { repeatReviewer: reviewer } : {}),
      ...(reviewer ? { repeatReviewerSetAt: ago } : {}), ...extra } : t)),
  }));
  return { id: p.id, n };
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);
const only = (id) => projects.readAll().filter((x) => x.id === id);
const roster = [{ sessionName: 'ada', name: 'Ada', isNamedOurs: true }, { sessionName: 'rex', name: 'Rex', isNamedOurs: true }];

test('#4787 slice 3: an agent reviewer is told once per missed slot, with the task, the run and its owner', () => {
  const { id, n } = fixture('ada');
  const sent = [];
  const deliver = (s, text) => { sent.push({ s, text }); return { state: 'placed' }; };
  const o = () => ({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(), deliver, DELIVERY, nameOf: (s) => (s === 'rex' ? 'Rex' : s) });
  mt.sweep(o());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].s, 'ada');
  assert.match(sent[0].text, /task #\d+ in Watch \w+, "Morning report", missed .*today at 9am\. You review its results; Rex runs it\./);
  assert.ok(stored(id, n).missToldAt, 'the told slot is stored');
  mt.sweep(o());
  assert.equal(sent.length, 1, 'the same slot is never told twice');
  const ev = taskchat.read(id, n).filter((e) => e.kind === 'missed');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].told, 'ada');
  assert.equal(ev[0].reached, true);
  // The next day's slot, missed too, is told once more.
  mt.sweep({ ...o(), projects: only(id), now: NOW + 86400000 });
  assert.equal(sent.length, 2, 'a newer missed slot is told');
});

test('#4787 slice 3: the person as reviewer is told by the task itself (history; Needs Your Decision while missed), nothing typed', () => {
  const { id, n } = fixture('me');
  const sent = [];
  const r = mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(), deliver: (s, t) => { sent.push(t); return { state: 'placed' }; }, DELIVERY });
  assert.equal(sent.length, 0);
  assert.equal(r.results[0].act, 'person');
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'missed' && e.person === true).length, 1);
  assert.equal(mt.personReviewMissed(stored(id, n), NOW), true);
  const ranYesterday = { ...stored(id, n), lastRunAt: new Date(at(2026, 10, 5, 9, 0)).toISOString() };
  assert.equal(mt.personReviewMissed(ranYesterday, at(2026, 10, 6, 9, 10)), false, 'ran yesterday, today\'s slot inside its grace: not yet');
  assert.equal(mt.personReviewMissed(ranYesterday, at(2026, 10, 6, 9, 15)), true, 'and at the grace, it is');
  const agentTask = fixture('ada');
  assert.equal(mt.personReviewMissed(stored(agentTask.id, agentTask.n), NOW), false, 'CONTROL: an agent reviewer never puts it on the person');
});

test('#4787 slice 3: nobody is told without a reviewer, before the reviewer was named, in a paused project or on a held task', () => {
  assert.equal(mt.owed(only(fixture(null).id), NOW).length, 0, 'no reviewer');
  const late = fixture('ada', { repeatReviewerSetAt: new Date(at(2026, 10, 6, 9, 30)).toISOString() });
  assert.equal(mt.owed(only(late.id), NOW).length, 0, 'the 9am slot passed before the reviewer was named');
  const paused = fixture('ada');
  projects.mutate(paused.id, (x) => ({ ...x, paused: true }));
  assert.equal(mt.owed(only(paused.id), NOW).length, 0, 'paused project');
  const held = fixture('ada', { onHold: true });
  assert.equal(tasks.isOnHold(stored(held.id, held.n)), true, 'precondition: the fixture is held the way tasks.isOnHold reads it');
  assert.equal(mt.owed(only(held.id), NOW).length, 0, 'held task');
  assert.equal(mt.owed(only(fixture('ada').id), NOW).length, 1, 'CONTROL: the same task otherwise is owed');
});

test('#4787 slice 3: a line that reaches nothing is tried again, then recorded as not reached after MAX_TRIES', () => {
  const { id, n } = fixture('ada');
  const book = new Map();
  let calls = 0;
  const deliver = () => { calls += 1; return { state: 'not-found' }; };
  for (let i = 0; i < mt.MAX_TRIES; i += 1) mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book, deliver, DELIVERY });
  assert.equal(calls, mt.MAX_TRIES);
  const ev = taskchat.read(id, n).filter((e) => e.kind === 'missed');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].reached, false);
  mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book, deliver, DELIVERY });
  assert.equal(calls, mt.MAX_TRIES, 'given up on: never tried again for that slot');
});

test('#4787 slice 3: held, not spent, while Kosmos cannot type, the reviewer is not running, or the hour\'s limit is reached', () => {
  const { id, n } = fixture('ada');
  const deliver = () => { throw new Error('must not be called'); };
  const base = { projects: only(id), now: NOW, limit: { on: false }, book: new Map(), deliver, DELIVERY };
  assert.equal(mt.sweep({ ...base, roster, allowed: false, sent: [] }).results[0].act, 'held');
  assert.equal(mt.sweep({ ...base, roster: [{ sessionName: 'rex' }], allowed: true, sent: [] }).results[0].act, 'held');
  assert.equal(mt.sweep({ ...base, roster, allowed: true, limit: { on: true, perHour: 1 }, sent: [NOW - 1000] }).results[0].act, 'held');
  assert.equal(mt.sweep({ ...base, roster: [{ sessionName: 'ada', isNamedOurs: false }], allowed: true, sent: [] }).results[0].act, 'held', 'not ours');
  assert.equal(mt.sweep({ ...base, roster: [{ sessionName: 'ada', isNamedOurs: true, swarm: { active: false } }], allowed: true, sent: [] }).results[0].act, 'held', 'a switched-off swarm');
  assert.equal(stored(id, n).missToldAt, undefined, 'nothing is marked told while held');
  // CONTROL: the same task, allowed and running, is told.
  const r = mt.sweep({ ...base, roster, allowed: true, sent: [], deliver: () => ({ state: 'placed' }) });
  assert.equal(r.results[0].act, 'tell');
  assert.equal(r.results[0].reached, true);
});

test('#4787 slice 3: server.js runs the sweep on its own minute timer, outside the Prompter tick, with the board\'s typing path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const i = src.indexOf('const missedTellTick = setInterval(');
  assert.ok(i > 0, 'the timer is there');
  const body = src.slice(i, src.indexOf('}, 60000);', i));
  assert.match(body, /missedtell\.sweep\(/);
  assert.match(body, /deliver: \(session, text, ro\) => chat\.deliverAutomatic\(/);
  assert.match(body, /const allowed = agentnudge\.nudgeEnabled\(liveExecution\.liveExecutionAllowed\(\), process\.env\);/, 'the nudge\'s gate: live execution and the brake');
  assert.match(body, /missedtell\.sweep\(\{[\s\S]*\ballowed,/, 'and it is what the sweep is given');
  assert.match(body, /const r = allowed && owed\.some\(\(x\) => !x\.person && !x\.swarmOff && x\.members\.includes\(x\.reviewer\)\)/, 'reviews 6 to 8: no roster read while nothing can be typed');
  assert.equal((src.match(/missedtell\.sweep\(/g) || []).length, 1, 'and nowhere else');
});

test('#4787 slice 3 review 1: a quota hold or a busy pane spends no try; the slot is told once the reviewer can take it', () => {
  const { id, n } = fixture('ada');
  const book = new Map();
  let calls = 0;
  const run = (verdict) => mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book, DELIVERY,
    deliver: () => { calls += 1; return verdict; } });
  for (let i = 0; i < mt.MAX_TRIES + 2; i += 1) run({ state: 'could_not', held: true });
  for (let i = 0; i < mt.MAX_TRIES + 2; i += 1) run({ state: 'could_not', busy: true });
  assert.equal(calls, 2 * (mt.MAX_TRIES + 2), 'asked every minute');
  assert.equal(stored(id, n).missToldAt, undefined, 'never given up on while it could not take a line');
  run({ state: 'placed' });
  assert.ok(stored(id, n).missToldAt, 'told once it could');
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'missed' && e.reached === true).length, 1);
});

test('#4787 slice 3 review 1: a line placed but whose told mark cannot be saved is not typed again in this process', () => {
  const { id } = fixture('ada');
  const book = new Map();
  let calls = 0;
  const real = projects.mutate;
  projects.mutate = () => { throw new Error('disk full'); };
  try {
    for (let i = 0; i < 3; i += 1) mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book, DELIVERY, deliver: () => { calls += 1; return { state: 'placed' }; } });
  } finally { projects.mutate = real; }
  assert.equal(calls, 1);
});

test('#4787 slice 3 review 1: a reviewer taken off the project is not typed into; a held task or paused project is never on the person', () => {
  const gone = fixture('ada');
  projects.mutate(gone.id, (x) => ({ ...x, agents: ['rex'] }));
  const r = mt.sweep({ projects: only(gone.id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(), DELIVERY, deliver: () => { throw new Error('typed'); } });
  assert.equal(r.results[0].act, 'held');
  assert.match(r.results[0].because, /no longer on the project/);
  const me = fixture('me');
  assert.equal(mt.personReviewMissed(stored(me.id, me.n), NOW), true, 'precondition: missed and the person reviews it');
  assert.equal(mt.personReviewMissed({ ...stored(me.id, me.n), onHold: true }, NOW), false, 'held');
  assert.equal(mt.personReviewMissed({ ...stored(me.id, me.n), projectPaused: true }, NOW), false, 'paused project');
});

test('#4787 slice 3 review 1: the history entry names the slot that was missed', () => {
  const { id, n } = fixture('me');
  mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(), DELIVERY, deliver: () => ({ state: 'placed' }) });
  const ev = taskchat.read(id, n).find((e) => e.kind === 'missed');
  assert.equal(Date.parse(ev.slot), at(2026, 10, 6, 9, 0));
});

test('#4787 slice 3 review 5: a reviewer who also runs the task IS told (the nudge needs the Prompter on and the agent idle), in its own words', () => {
  const { id, n } = fixture('rex');   // rex holds the open part and reviews it
  let text = null;
  const r = mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(), DELIVERY, deliver: (s, x) => { text = x; return { state: 'placed' }; } });
  assert.equal(r.results[0].act, 'tell');
  assert.match(text, /You run it and review its results\./);
  assert.doesNotMatch(text, /Rex runs it/);
  assert.equal(mt.owed(only(id), NOW).length, 0, 'once');
});

test('#4787 slice 3 review 4: an agent whose part is done is not its owner, so as reviewer it is told', () => {
  const { id, n } = fixture('rex');
  const done = new Date(NOW - 86400000 * 3).toISOString();
  projects.mutate(id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, parts: [{ n: 1, sentence: 'Morning report', who: 'rex', createdAt: done, closedAt: done }, { n: 2, sentence: 'Morning report', who: 'ada', createdAt: done }] } : t)) }));
  let typed = null;
  const r = mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(), DELIVERY, deliver: (s) => { typed = s; return { state: 'placed' }; } });
  assert.equal(r.results[0].act, 'tell');
  assert.equal(typed, 'rex');
});

test('#4787 slice 3 review 6: a capped count is recorded as more, so the history matches the line', () => {
  const { id, n } = fixture('me', { repeat: { every: 'hour', minute: 0 } });
  projects.mutate(id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, repeatSetAt: new Date(NOW - 10 * 86400000).toISOString(), lastRunAt: new Date(NOW - 10 * 86400000).toISOString() } : t)) }));
  mt.sweep({ projects: only(id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(), DELIVERY, deliver: () => ({ state: 'placed' }) });
  const ev = taskchat.read(id, n).find((e) => e.kind === 'missed');
  assert.equal(ev.count, 99);
  assert.equal(ev.more, true);
});

test('#4787 slice 3 review 8: a reviewer switched off in this project is held; a miss before the person asked is not put on them', () => {
  const off = fixture('ada');
  projects.mutate(off.id, (x) => ({ ...x, swarmOff: ['ada'] }));
  assert.equal(projects.isSwarmOff(projects.readAll().find((x) => x.id === off.id), 'ada'), true, 'precondition: the fixture switches ada off the way projects reads it');
  const r = mt.sweep({ projects: only(off.id), roster, now: NOW, allowed: true, limit: { on: false }, sent: [], book: new Map(), DELIVERY, deliver: () => { throw new Error('typed'); } });
  assert.equal(r.results[0].act, 'held');
  assert.match(r.results[0].because, /switched off/);
  const me = fixture('me', { repeatReviewerSetAt: new Date(at(2026, 10, 6, 9, 30)).toISOString() });
  assert.equal(mt.personReviewMissed(stored(me.id, me.n), NOW), false, 'the 9am miss came before "Me" was chosen at 9:30');
  assert.equal(mt.personReviewMissed(stored(me.id, me.n), at(2026, 10, 7, 10, 0)), true, 'CONTROL: the next day\'s miss is theirs');
});
