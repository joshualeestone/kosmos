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
  const paused = fixture({}, { paused: true });
  const held = fixture({ onHold: true });
  const live = fixture();
  const { sent } = run([paused.id, held.id, live.id]);
  assert.equal(sent.length, 1, 'only the live one');
  assert.match(sent[0].text, new RegExp('in ' + projects.readAll().find((x) => x.id === live.id).name));
  assert.equal(stored(paused.id, paused.n).repeatDueToldAt, undefined);
  assert.equal(stored(held.id, held.n).repeatDueToldAt, undefined);
});

test('#8581: a repeat already run for today\'s slot is not told; control: one not run is', () => {
  const ran = fixture({ lastRunAt: new Date(at(2026, 11, 16, 9, 35)).toISOString() });
  const not = fixture();
  const { sent } = run([ran.id, not.id]);
  assert.equal(sent.length, 1);
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
