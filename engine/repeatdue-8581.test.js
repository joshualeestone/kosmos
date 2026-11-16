'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#8581: a repeating task that is due is told to its holder once per slot with the Prompter off
 * (engine/repeatdue.js). Each "not told" case has a control in the same test that IS told, so a sweep that tells
 * nobody at all cannot pass.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/repeatdue-8581.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rd-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rd-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rd-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');
const rd = require('../engine/repeatdue');
const phrase = require('../engine/taskactphrase');
const fleet = require('../test-support/fleet');
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(FLEET_ROOT, { recursive: true, force: true }); });
const cardsOf = (specs) => fleet.install(specs.map((s) => fleet.agent(s.name, { state: s.state || 'idle' }))).agents;
const BASE = cardsOf([{ name: 'ada' }, { name: 'rex' }]);
const sessionOf = (name) => (BASE.find((c) => (c.sessionName || '').startsWith(name)) || {}).sessionName;
const ADA = sessionOf('ada');
const REX = sessionOf('rex');

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = at(2026, 11, 16, 11, 0);   // today's 9:30am slot is due, and was not run
const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', NOT_FOUND: 'not-found' };

/* A project with one daily-9:30 task held by REX, last run 27 days ago (the card's case). */
function fixture(extra = {}, projExtra = {}) {
  const p = projects.create({ name: 'Daily ' + Math.random().toString(36).slice(2) });
  const n = tasks.create(p.id, { sentence: 'Community feed check' }).number;
  const ago = new Date(NOW - 27 * 86400000).toISOString();
  projects.mutate(p.id, (x) => ({
    ...x, agents: [ADA, REX], ...projExtra,
    tasks: x.tasks.map((t) => (t.number === n ? { ...t, repeat: { every: 'day', at: '09:30' }, repeatSetAt: ago, lastRunAt: ago,
      parts: [{ n: 1, sentence: 'Community feed check', who: REX, createdAt: ago }], ...extra } : t)),
  }));
  return { id: p.id, n };
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);
const only = (...ids) => projects.readAll().filter((x) => ids.includes(x.id));
const settled = () => new Map([[ADA, { since: NOW - 120000, at: NOW - 60000 }], [REX, { since: NOW - 120000, at: NOW - 60000 }]]);
function run(ids, over = {}) {
  const sent = [];
  const deliver = (s, text) => { sent.push({ s, text }); return { state: 'placed' }; };
  const o = { projects: only(...ids), roster: BASE, now: NOW, prompterOn: false, allowed: true, limit: { on: false }, sent: [], book: new Map(), deliver, DELIVERY, idleSeen: settled(), ...over };
  const r = rd.sweep(o);
  return { sent, r, o };
}

test('#8581: with the Prompter off, a due daily repeat is told to its holder once, with how to record it', () => {
  const { id, n } = fixture();
  const first = run([id]);
  assert.equal(first.sent.length, 1, 'told once');
  assert.equal(first.sent[0].s, REX, 'to the holder');
  assert.match(first.sent[0].text, new RegExp('your repeating task #' + n + ' in Daily \\w+, "Community feed check", is due: its run today at 9:30am .*kosmos task ran ' + id + ' ' + n));
  assert.ok(stored(id, n).repeatDueToldAt, 'the told slot is stored');
  const again = run([id]);   // a fresh process memory: only the stored mark stops it
  assert.equal(again.sent.length, 0, 'the same slot is never told twice');
  const ev = taskchat.read(id, n).filter((e) => e.kind === 'due-told');
  assert.equal(ev.length, 1, 'one history row');
  assert.equal(phrase.phrase(ev[0], (s) => (s === REX ? 'Rex' : s)), 'A run was due; Rex was told', 'the history words it');
  assert.equal(phrase.phrase({ ...ev[0], reached: false }, () => 'Rex'), 'A run was due; Kosmos could not reach Rex');
});

test('#8581: the next day\'s slot is told again (the mark is per slot, not per task)', () => {
  const { id, n } = fixture();
  assert.equal(run([id]).sent.length, 1);
  const tomorrow = NOW + 86400000;
  assert.equal(run([id], { now: tomorrow, idleSeen: new Map([[REX, { since: tomorrow - 120000, at: tomorrow - 60000 }]]) }).sent.length, 1, 'a new slot is a new line');
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'due-told').length, 2);
});

test('#8581: with the Prompter ON nothing is sent (prompterTick nudges due runs), control: off sends', () => {
  const { id } = fixture();
  assert.equal(run([id], { prompterOn: true }).sent.length, 0);
  assert.equal(run([id]).sent.length, 1, 'control');
});

test('#8581: a paused project and a held task are not told; a live one beside them is', () => {
  /* Each filtered fixture is held by ADA and the live one by REX, so the one-line-per-agent rule cannot be what
     keeps the filtered ones quiet: a broken filter would send ADA a line. */
  const byAda = (ago) => ({ parts: [{ n: 1, sentence: 'Community feed check', who: ADA, createdAt: ago }] });
  const ago = new Date(NOW - 27 * 86400000).toISOString();
  const paused = fixture(byAda(ago), { paused: true });
  const held = fixture({ onHold: true, ...byAda(ago) });
  const live = fixture();
  const { sent } = run([paused.id, held.id, live.id]);
  assert.equal(sent.length, 1, 'only the live one');
  assert.equal(sent[0].s, REX);
  assert.match(sent[0].text, new RegExp('in ' + projects.readAll().find((x) => x.id === live.id).name));
  assert.equal(stored(paused.id, paused.n).repeatDueToldAt, undefined);
  assert.equal(stored(held.id, held.n).repeatDueToldAt, undefined);
});

test('#8581: a repeat already run for today\'s slot is not told; control: one not run is', () => {
  const ago = new Date(NOW - 27 * 86400000).toISOString();
  const ran = fixture({ lastRunAt: new Date(at(2026, 11, 16, 9, 35)).toISOString(), parts: [{ n: 1, sentence: 'Community feed check', who: ADA, createdAt: ago }] });
  const not = fixture();
  const { sent } = run([ran.id, not.id]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].s, REX, 'the not-run one (REX), never the run one (ADA)');
  assert.equal(stored(ran.id, ran.n).repeatDueToldAt, undefined);
  assert.ok(stored(not.id, not.n).repeatDueToldAt);
});

test('#8581: nothing is typed while Kosmos may not type into agents, and no slot is spent', () => {
  const { id, n } = fixture();
  assert.equal(run([id], { allowed: false }).sent.length, 0);
  assert.equal(stored(id, n).repeatDueToldAt, undefined, 'not marked while held');
  assert.equal(run([id]).sent.length, 1, 'control: told once allowed');
});

test('#8581: a busy holder is held with no try spent; told once idle', () => {
  const { id, n } = fixture();
  const busy = cardsOf([{ name: 'ada' }, { name: 'rex', state: 'working' }]);
  assert.equal(run([id], { roster: busy }).sent.length, 0);
  assert.equal(stored(id, n).repeatDueToldAt, undefined);
  cardsOf([{ name: 'ada' }, { name: 'rex' }]);
  assert.equal(run([id]).sent.length, 1, 'control');
});

test('#8581: a holder switched off in the project is not told; control: switched back on, told', () => {
  const { id } = fixture({}, { swarmOff: [REX] });
  assert.equal(run([id]).sent.length, 0);
  projects.mutate(id, (x) => ({ ...x, swarmOff: [] }));
  assert.equal(run([id]).sent.length, 1);
});

test('#8581: the Agent Communication limit holds the line', () => {
  const { id } = fixture();
  assert.equal(run([id], { limit: { on: true, perHour: 2 }, sent: [NOW - 1000, NOW - 2000] }).sent.length, 0);
  assert.equal(run([id], { limit: { on: true, perHour: 2 }, sent: [NOW - 1000] }).sent.length, 1, 'control: under the limit');
});

test('#8581: a delivery that reached nothing is tried MAX_TRIES times, then recorded as not reached', () => {
  const { id, n } = fixture();
  const book = new Map();
  let tries = 0;
  const deliver = () => { tries += 1; return { state: 'not-found' }; };
  for (let i = 0; i < rd.MAX_TRIES + 2; i += 1) run([id], { book, deliver });
  assert.equal(tries, rd.MAX_TRIES);
  const ev = taskchat.read(id, n).filter((e) => e.kind === 'due-told');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].reached, false);
});

test('#8581: the due-run note is not activity (a stopped repeat keeps reading as stopped)', () => {
  const { id, n } = fixture();
  const p = () => projects.readAll().find((x) => x.id === id);
  const before = tasks.lastActivityOf(id, tasks.byNumber(p(), n));
  assert.equal(run([id]).sent.length, 1);
  assert.equal(tasks.lastActivityOf(id, tasks.byNumber(p(), n)), before, 'unchanged by the due-told row');
  // Control: an ordinary row does move it, so the comparison can fail.
  taskchat.record(id, n, { kind: 'said', text: 'hello' });
  assert.notEqual(tasks.lastActivityOf(id, tasks.byNumber(p(), n)), before);
});

test('#8581: a quota hold or a busy pane spends no try; told once the holder can take it', () => {
  const { id, n } = fixture();
  const book = new Map();
  let calls = 0;
  const go = (verdict) => run([id], { book, deliver: () => { calls += 1; return verdict; } });
  for (let i = 0; i < rd.MAX_TRIES + 2; i += 1) go({ state: 'could_not', held: true });
  for (let i = 0; i < rd.MAX_TRIES + 2; i += 1) go({ state: 'could_not', busy: true });
  assert.equal(calls, 2 * (rd.MAX_TRIES + 2), 'asked every minute');
  assert.equal(stored(id, n).repeatDueToldAt, undefined, 'never given up on while it could not take a line');
  go({ state: 'placed' });
  assert.ok(stored(id, n).repeatDueToldAt, 'told once it could');
});

test('#8581: a delivery that throws counts as told (the text may be in the pane) and is not typed again', () => {
  const { id, n } = fixture();
  const book = new Map();
  let calls = 0;
  const deliver = () => { calls += 1; throw new Error('pane went away'); };
  run([id], { book, deliver });
  run([id], { book, deliver });
  assert.equal(calls, 1);
  const ev = taskchat.read(id, n).filter((e) => e.kind === 'due-told');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].reached, true, 'unconfirmed is recorded as reached, as missedtell does');
});

test('#8581: a holder no longer on the project is recorded once as not reached and never typed into', () => {
  const { id, n } = fixture();
  projects.mutate(id, (x) => ({ ...x, agents: [ADA] }));
  const first = run([id]);
  assert.equal(first.sent.length, 0);
  assert.equal(first.r.results[0].act, 'unreachable');
  run([id]);
  const ev = taskchat.read(id, n).filter((e) => e.kind === 'due-told');
  assert.equal(ev.length, 1, 'one history row, not one a minute');
  assert.equal(ev[0].reached, false);
  // Control: back on the project, the NEXT slot is told.
  projects.mutate(id, (x) => ({ ...x, agents: [ADA, REX] }));
  const tomorrow = NOW + 86400000;
  assert.equal(run([id], { now: tomorrow, idleSeen: new Map([[REX, { since: tomorrow - 120000, at: tomorrow - 60000 }]]) }).sent.length, 1);
});

test('#8581: with two holders, a busy first holder falls through to an idle second', () => {
  const ago = new Date(NOW - 27 * 86400000).toISOString();
  const { id } = fixture({ parts: [{ n: 1, sentence: 'a', who: REX, createdAt: ago }, { n: 2, sentence: 'b', who: ADA, createdAt: ago }] });
  const busyRex = cardsOf([{ name: 'ada' }, { name: 'rex', state: 'working' }]);
  const { sent } = run([id], { roster: busyRex });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].s, ADA, 'the idle holder answers the slot');
  cardsOf([{ name: 'ada' }, { name: 'rex' }]);
  // Control: both idle, the first holder is the one told.
  const other = fixture({ parts: [{ n: 1, sentence: 'a', who: REX, createdAt: ago }, { n: 2, sentence: 'b', who: ADA, createdAt: ago }] });
  assert.equal(run([other.id]).sent[0].s, REX);
});

test('#8581: a task every few minutes is told again in one stall only an hour past the last slot told', () => {
  const ago = new Date(NOW - 2 * 86400000).toISOString();
  const { id } = fixture({ repeat: { every: 'minutes', n: 15 }, lastRunAt: ago });
  const book = new Map();
  const idle = (t) => new Map([[REX, { since: t - 120000, at: t - 60000 }]]);
  const t0 = NOW + 5 * 60000;   // the 11:00 slot, past its grace (a quarter of 15 minutes)
  assert.equal(run([id], { book, now: t0, idleSeen: idle(t0) }).sent.length, 1, 'told once a slot is overdue');
  const in30 = NOW + 35 * 60000;
  assert.equal(run([id], { book, now: in30, idleSeen: idle(in30) }).sent.length, 0, 'not every slot while the stall lasts');
  const in75 = NOW + 80 * 60000;
  assert.equal(run([id], { book, now: in75, idleSeen: idle(in75) }).sent.length, 1, 'again about an hour on');
  // Control: a run since the last tell ends the stall, so the next due slot is told at once.
  projects.mutate(id, (x) => ({ ...x, tasks: x.tasks.map((t) => ({ ...t, lastRunAt: new Date(in75 + 60000).toISOString() })) }));
  const in95 = NOW + 100 * 60000;
  assert.equal(run([id], { book, now: in95, idleSeen: idle(in95) }).sent.length, 1, 'a new stall is told at its first due slot');
});

test('#8581: server.js runs the sweep on its own minute timer, only with the Prompter off, with the board\'s typing path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const i = src.indexOf('const repeatDueTick = setInterval(');
  assert.ok(i > 0, 'the timer is there');
  const body = src.slice(i, src.indexOf('}, 60000);', i));
  assert.match(body, /^const repeatDueTick = setInterval\(\(\) => \{\s*try \{\s*if \(heartbeatSetting\.read\(\)\.on === true\) return;/, 'stands down while the Prompter is on, first thing');
  assert.match(body, /prompterOn: false/);
  assert.match(body, /deliver: \(session, text, ro\) => chat\.deliverAutomatic\(/);
  assert.match(body, /const allowed = agentnudge\.nudgeEnabled\(liveExecution\.liveExecutionAllowed\(\), process\.env\);/);
  assert.match(body, /repeatdue\.sweep\(\{[\s\S]*\ballowed,/);
  assert.match(body, /book: REPEAT_DUE_BOOK, idleSeen: REPEAT_DUE_IDLE/, 'kept across passes (a fresh Map each minute would never settle)');
  assert.match(src, /const REPEAT_DUE_BOOK = new Map\(\);\s*const REPEAT_DUE_IDLE = new Map\(\);\s*const repeatDueTick/, 'made once, outside the timer');
  assert.equal((src.match(/repeatdue\.sweep\(/g) || []).length, 1, 'and nowhere else');
  assert.match(body, /recentTyped: TELL_TYPED/, 'reads when the missed-run tell typed');
  const m = src.slice(src.indexOf('const missedTellTick = setInterval('), i);
  assert.match(m, /log: \(x\) => \{ TELL_TYPED\.set\(x\.reviewer, Date\.now\(\)\);/, 'which the missed-run tell records');
  assert.match(m, /recentTyped: TELL_TYPED/, 'and reads, so the hold-off works both ways');
});

test('#8581: a stalled hourly repeat is told again every four hours, not every hour; a daily one each day', () => {
  assert.equal(rd.stallSlots({ every: 'minutes', n: 15 }, NOW), 4, 'every 15 minutes: hourly');
  assert.equal(rd.stallSlots({ every: 'minutes', n: 30 }, NOW), 4, 'every 30 minutes: every two hours');
  assert.equal(rd.stallSlots({ every: 'hour', minute: 0 }, NOW), 4);
  assert.equal(rd.stallSlots({ every: 'day', at: '09:30' }, NOW), 1, 'daily: each slot');
  assert.equal(rd.stallSlots({ every: 'week', day: 1, at: '09:00' }, NOW), 1, 'weekly: each slot');
  const ago = new Date(NOW - 2 * 86400000).toISOString();
  const { id } = fixture({ repeat: { every: 'hour', minute: 0 }, lastRunAt: ago });
  const book = new Map();
  const idle = (t) => new Map([[REX, { since: t - 120000, at: t - 60000 }]]);
  const t0 = NOW + 20 * 60000;   // past the hourly grace (15 minutes)
  assert.equal(run([id], { book, now: t0, idleSeen: idle(t0) }).sent.length, 1, 'told at the first due slot');
  let told = 1;
  for (let h = 1; h <= 4; h += 1) { const t = t0 + h * 60 * 60000; told += run([id], { book, now: t, idleSeen: idle(t) }).sent.length; }
  assert.equal(told, 2, 'once more, four hours on');
});

test('#8581: an agent another sweep typed into this minute is held; control: a minute later it is told', () => {
  const { id } = fixture();
  const recentTyped = new Map([[REX, NOW - 10000]]);
  assert.equal(run([id], { recentTyped }).sent.length, 0);
  assert.equal(run([id], { recentTyped: new Map([[REX, NOW - 70000]]) }).sent.length, 1);
});

test('#8581: the line carries the record-by guidance the Prompter nudge gives', () => {
  const { id } = fixture();
  const { sent } = run([id]);
  assert.match(sent[0].text, /record it before .*, ahead of the next one; if it is still going then, stop it, record it as it stands with what stopped it, and start the next\)/);
});

test('#8581: with the person as reviewer, the agent holder is still told', () => {
  const ago = new Date(NOW - 27 * 86400000).toISOString();
  const { id } = fixture({ repeatReviewerPerson: true, repeatReviewerSetAt: ago });
  assert.equal(run([id]).sent.length, 1);
});

test('#8581: a holder that is the task\'s named reviewer is left to the missed-run tell; control: another holder is told', () => {
  const ago = new Date(NOW - 27 * 86400000).toISOString();
  const self = fixture({ repeatReviewer: REX, repeatReviewerSetAt: ago });
  const other = fixture({ repeatReviewer: ADA, repeatReviewerSetAt: ago });
  const { sent } = run([self.id, other.id]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, new RegExp('in ' + projects.readAll().find((x) => x.id === other.id).name));
});

/* kosmos#8586 item 1: an unreachable holder is recorded once per STALL, not once per slot. */
test('#8586: a holder off the project is recorded once for the whole stall; a run or a rule change starts a new one', () => {
  const { id, n } = fixture();
  projects.mutate(id, (x) => ({ ...x, agents: [ADA] }));
  const rows = () => taskchat.read(id, n).filter((e) => e.kind === 'due-told').length;
  const day = (k) => NOW + k * 86400000;
  const first = run([id]);
  assert.equal(first.r.results[0].recorded, true, 'the first slot of the stall is recorded');
  for (const k of [1, 2, 3]) {
    const r = run([id], { now: day(k) });
    assert.equal(r.r.results[0].act, 'unreachable', 'day ' + k + ' is still unreachable');
    assert.equal(r.r.results[0].recorded, false, 'day ' + k + ' is not recorded again');
  }
  assert.equal(rows(), 1, 'one row for four missed slots of one stall');
  // A run ends the stall: the next missed slot is recorded again (the control that it can record at all).
  projects.mutate(id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, lastRunAt: new Date(day(3) + 3600000).toISOString() } : t)) }));
  assert.equal(run([id], { now: day(4) }).r.results[0].recorded, true, 'a run since: a new stall');
  assert.equal(run([id], { now: day(5) }).r.results[0].recorded, false);
  // A rule change ends it too.
  projects.mutate(id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, repeatSetAt: new Date(day(5) + 3600000).toISOString() } : t)) }));
  assert.equal(run([id], { now: day(6) }).r.results[0].recorded, true, 'a rule changed since: a new stall');
  assert.equal(rows(), 3);
});

test('#8586: a holder who came back and was told, then left again, starts a new stall', () => {
  const { id, n } = fixture();
  const day = (k) => NOW + k * 86400000;
  const idle = (t) => new Map([[REX, { since: t - 120000, at: t - 60000 }], [ADA, { since: t - 120000, at: t - 60000 }]]);
  projects.mutate(id, (x) => ({ ...x, agents: [ADA] }));
  assert.equal(run([id]).r.results[0].recorded, true);
  projects.mutate(id, (x) => ({ ...x, agents: [ADA, REX] }));
  assert.equal(run([id], { now: day(1), idleSeen: idle(day(1)) }).sent.length, 1, 'back on the project: told');
  assert.equal(stored(id, n).repeatDueQuiet, undefined, 'a real delivery clears the stall');
  projects.mutate(id, (x) => ({ ...x, agents: [ADA] }));
  assert.equal(run([id], { now: day(2) }).r.results[0].recorded, true, 'left again: recorded again');
});

/* kosmos#8586 item 2: a holder who is also the reviewer is left to the missed-run tell only when that tell takes the
   slot. A slot missed before the reviewer was named is not the missed-run tell's, so it is told here. */
test('#8586: a reviewer-holder named AFTER the slot is told here; control: named before it, left to the missed-run tell', () => {
  const ago = new Date(NOW - 27 * 86400000).toISOString();
  const late = fixture({ repeatReviewer: REX, repeatReviewerSetAt: new Date(NOW - 60000).toISOString() });
  const early = fixture({ repeatReviewer: REX, repeatReviewerSetAt: ago });
  const mt = require('../engine/missedtell');
  assert.equal(mt.owed(only(late.id), NOW).length, 0, 'precondition: the missed-run tell does not take the late one');
  assert.equal(mt.owed(only(early.id), NOW).length, 1, 'precondition: it does take the early one');
  const { sent } = run([late.id, early.id]);
  assert.equal(sent.length, 1, 'only one is told here');
  assert.match(sent[0].text, new RegExp('in ' + projects.readAll().find((x) => x.id === late.id).name));
});

test('#8586: another set of holders is another stall (CONTROL: the same set, next day, is not recorded)', () => {
  const { id, n } = fixture();
  const day = (k) => NOW + k * 86400000;
  projects.mutate(id, (x) => ({ ...x, agents: [] }));
  assert.equal(run([id]).r.results[0].recorded, true);
  assert.equal(run([id], { now: day(1) }).r.results[0].recorded, false, 'control: same holders, same stall');
  projects.mutate(id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n
    ? { ...t, parts: [...t.parts, { n: 2, sentence: 'Second half', who: ADA, createdAt: new Date(day(1)).toISOString() }] } : t)) }));
  assert.equal(run([id], { now: day(2) }).r.results[0].recorded, true, 'ADA joined the holders: a new stall');
});

test('#8586: a delivery given up after MAX_TRIES also clears the stall mark', () => {
  const { id, n } = fixture();
  const day = (k) => NOW + k * 86400000;
  projects.mutate(id, (x) => ({ ...x, agents: [ADA] }));
  assert.equal(run([id]).r.results[0].recorded, true);
  assert.ok(stored(id, n).repeatDueQuiet, 'precondition: the stall mark is on the task');
  projects.mutate(id, (x) => ({ ...x, agents: [ADA, REX] }));
  const book = new Map();
  const t = day(1);
  const idle = () => new Map([[REX, { since: t - 120000, at: t - 60000 }]]);
  for (let i = 0; i < rd.MAX_TRIES; i += 1) {
    assert.ok(stored(id, n).repeatDueQuiet, 'still marked before try ' + (i + 1));
    run([id], { now: t, book, idleSeen: idle(), deliver: () => ({ state: 'not-found' }) });
  }
  assert.equal(stored(id, n).repeatDueQuiet, undefined, 'given up after MAX_TRIES: the mark is cleared');
});

test('#8586: a minutes repeat\'s reviewer-holder is never told here while the missed-run tell throttles it (CONTROL: another holder is)', () => {
  const ago = new Date(NOW - 2 * 86400000).toISOString();   // as the #8581 minutes test
  const rule = { repeat: { every: 'minutes', n: 15 }, lastRunAt: ago, repeatSetAt: ago };
  const rev = fixture({ ...rule, repeatReviewer: REX, repeatReviewerSetAt: ago });
  const other = fixture({ ...rule, repeatReviewer: ADA, repeatReviewerSetAt: ago });
  const mt = require('../engine/missedtell');
  const t0 = NOW + 5 * 60000;   // the 11:00 slot, past its grace
  // The missed-run tell told a slot 20 minutes before, so its hourly throttle holds the slot due now.
  const earlier = new Date(t0 - 20 * 60000).toISOString();
  projects.mutate(rev.id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === rev.n ? { ...t, missToldAt: earlier } : t)) }));
  assert.equal(mt.owed(only(rev.id), t0).length, 0, 'precondition: the missed-run tell holds this slot by its throttle');
  const { sent } = run([rev.id, other.id], { now: t0, idleSeen: new Map([[REX, { since: t0 - 120000, at: t0 - 60000 }]]) });
  assert.equal(sent.length, 1, 'only the other task\'s holder is told');
  assert.match(sent[0].text, new RegExp('in ' + projects.readAll().find((x) => x.id === other.id).name));
});

test('#8586: a minutes repeat\'s holder back after an unrecorded slot is told at once (where recording every slot would wait an hour)', () => {
  const ago = new Date(NOW - 2 * 86400000).toISOString();
  const { id } = fixture({ repeat: { every: 'minutes', n: 15 }, lastRunAt: ago });
  projects.mutate(id, (x) => ({ ...x, agents: [ADA] }));
  const at = (min) => NOW + min * 60000;
  const idle = (t) => new Map([[REX, { since: t - 120000, at: t - 60000 }]]);
  assert.equal(run([id], { now: at(5) }).r.results[0].recorded, true, '11:05: the stall is recorded (11:00 slot)');
  assert.equal(run([id], { now: at(25) }).r.results.length, 0, '11:25: the stall throttle from 11:00 holds; nothing offered');
  const noon = run([id], { now: at(65) }).r.results[0];
  assert.equal(noon.act, 'unreachable');
  assert.equal(noon.recorded, false, '12:05: still away, the 12:00 slot is NOT recorded (the old code recorded it)');
  projects.mutate(id, (x) => ({ ...x, agents: [ADA, REX] }));
  // Had 12:00 been recorded, the told mark would be 12:00 and the throttle would hold until 13:00.
  assert.equal(run([id], { now: at(70), idleSeen: idle(at(70)) }).sent.length, 1, '12:10: back on the project, told at once');
});
