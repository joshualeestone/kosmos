'use strict';

/**
 * kosmos#7869, two small items from one agent's feedback:
 * 1. An agent's give of an open part on a BUILT task is refused, so one agent never silently undoes another's built
 *    mark and the work is not handed (and then nudged) as if it were still to do. The person's give from the screen
 *    still reopens it (#3951), and taking an agent off a part is not new work.
 * 2. Reacting to a colleague's direct note says plainly that only room posts take a reaction, to the two agents the
 *    note is between; to anyone else it stays "no post by that id", so a private note is never shown to exist.
 *
 *   node --test engine/builtgive-react-7869.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

// Sandboxed BEFORE any engine require: both modules write under these roots.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-builtgive-7869-'));
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'Projects');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const tasks = require('./tasks');
const messages = require('./messages');

const stored = (p, n) => tasks.byNumber(projects.readAll().find((x) => x.id === p.id), n);
function builtTask(name) {
  const p = projects.create({ name });
  for (const a of ['april', 'mikey', 'mara']) projects.addAgent(p.id, a);
  const t = tasks.create(p.id, { sentence: 'Ship it' });
  assert.equal(tasks.assignPart(p.id, t.number, 1, 'april', { via: 'process', by: 'april' }).ok, true);
  const b = tasks.setBuilt(p.id, t.number, { by: 'april' });
  assert.ok(b && (b.ok !== false), 'the fixture could not mark the task built: ' + JSON.stringify(b));
  assert.ok(stored(p, t.number).builtAt, 'the fixture task is not built, so these tests would not test the case');
  return { p, t };
}

test('#7869: an agent giving an open part of a built task is refused, and the built mark stays', () => {
  const { p, t } = builtTask('Built give');
  const out = tasks.assignPart(p.id, t.number, 1, 'mikey', { via: 'process', by: 'mara' });
  assert.equal(out.ok, false, 'an agent gave a built task to another agent');
  assert.equal(out.builtRefused, true);
  assert.equal(out.because, `task ${t.number} is marked built, so mikey was not put on it. If there is more to do on it, add it as a task under it (kosmos task add ${p.id} 'what is left' --parent ${t.number})`);
  // The Mac CLI reads the answer with sed, which stops at the first double quote: none may be in it.
  assert.equal(out.because.includes('"'), false, 'a double quote would cut the sentence short in the Mac CLI');
  const after = stored(p, t.number);
  assert.ok(after.builtAt, 'the refused give still dropped the built mark');
  assert.equal(tasks.partsOf(after)[0].who, 'april', 'the refused give still moved the part');
});

test('#7869: an agent taking a built task for itself is refused too (it would undo the mark)', () => {
  const { p, t } = builtTask('Built take');
  const out = tasks.assignPart(p.id, t.number, 1, 'mara', { via: 'process', by: 'mara' });
  assert.equal(out.ok, false);
  assert.match(out.because, /^task \d+ is marked built, so mara was not put on it\./);
  assert.ok(stored(p, t.number).builtAt);
});

test('#7869 CONTROL: the person giving it from the screen still reopens it (#3951), so the refusal is the agent arm only', () => {
  const { p, t } = builtTask('Screen give');
  const out = tasks.assignPart(p.id, t.number, 1, 'mikey', { via: 'screen' });
  assert.equal(out.ok, true, out.because);
  assert.equal(stored(p, t.number).builtAt || null, null, 'a person giving the work no longer reopens it');
  assert.equal(tasks.partsOf(stored(p, t.number))[0].who, 'mikey');
});

test('#7869: a give to an agent not on the project is told that first, not the built sentence', () => {
  const { p, t } = builtTask('Built outsider');
  assert.throws(() => tasks.assignPart(p.id, t.number, 1, 'stranger', { via: 'process', by: 'mara' }), /not on this project/);
});

test('#7869: the suggested command makes an open task under the built one, which stays built', () => {
  const { p, t } = builtTask('Built follow');
  const sub = tasks.create(p.id, { sentence: 'what is left', parent: t.number });
  assert.ok(sub && typeof sub.number === 'number', 'the suggested command did not make a task: ' + JSON.stringify(sub));
  const kid = stored(p, sub.number);
  assert.equal(tasks.parentOf(projects.readAll().find((x) => x.id === p.id), kid), t.number, 'the new task is not under the built one');
  assert.equal(kid.builtAt || null, null, 'the new work was born built');
  assert.ok(stored(p, t.number).builtAt, 'adding a task under it changed the built one (the sentence would then be wrong)');
});

test('#7869 CONTROL: a person giving it from the CLI (no agent card) still reopens it, and an agent re-giving its own part is no move', () => {
  const { p, t } = builtTask('Person cli give');
  const same = tasks.assignPart(p.id, t.number, 1, 'april', { via: 'process', by: 'april' });
  assert.equal(same.ok, true, same.because);
  assert.equal(same.changed, false);
  assert.ok(stored(p, t.number).builtAt, 'a re-give of the same agent dropped the built mark');
  const person = tasks.assignPart(p.id, t.number, 1, 'mikey', { via: 'process', by: null });
  assert.equal(person.ok, true, person.because);
  assert.equal(stored(p, t.number).builtAt || null, null, "a person's give from the CLI no longer reopens it");
});

test('#7869 CONTROL: an agent taking someone OFF a built task, and an agent giving an unbuilt one, still work', () => {
  const { p, t } = builtTask('Built take off');
  const off = tasks.assignPart(p.id, t.number, 1, null, { via: 'process', by: 'mara' });
  assert.equal(off.ok, true, off.because);
  assert.ok(stored(p, t.number).builtAt, 'taking an agent off a part dropped the built mark');
  const open = projects.create({ name: 'Open give' });
  for (const a of ['april', 'mikey']) projects.addAgent(open.id, a);
  const u = tasks.create(open.id, { sentence: 'Not built yet' });
  const give = tasks.assignPart(open.id, u.number, 1, 'mikey', { via: 'process', by: 'april' });
  assert.equal(give.ok, true, give.because);
  assert.equal(tasks.partsOf(stored(open, u.number))[0].who, 'mikey');
});

/* ── item 2: reacting to a direct note ─────────────────────────────────────── */

const THUMB = '\u{1F44D}';
function seed(row) {
  fs.mkdirSync(nodePath.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n', 'utf8');
}

test('#7869: reacting to a direct note says it is not a room post, and how to answer it', () => {
  seed({ kind: 'message', id: 'm9001', from: 'angel', to: 'april', text: 'thanks, seen', in_reply_to: null, state: 'placed' });
  seed({ kind: 'post', id: 'm9002', project: 'room7869', from: 'angel', to: ['april'], text: 'a room post', outcomes: {} });
  const r = messages.react({ project: 'room7869', of: 'm9001', emoji: THUMB, from: 'april', members: ['april', 'angel'] });
  assert.equal(r.ok, false);
  assert.equal(r.because, 'm9001 is a direct message, not a room post, and only room posts take a reaction or a claim; to answer it, use kosmos msg angel \'your answer\' instead');
  assert.equal(r.because.includes('"'), false, 'a double quote would cut the sentence short in the Mac CLI');
  // The sender of the note gets the same plain sentence, naming the other party.
  const s = messages.react({ project: 'room7869', of: 'm9001', emoji: THUMB, from: 'angel', members: ['april', 'angel'] });
  assert.match(s.because, /^m9001 is a direct message, not a room post\b.*kosmos msg april 'your answer' instead$/);
  // CONTROL: a real room post still takes the reaction, so the refusal above is about the id's kind.
  assert.equal(messages.react({ project: 'room7869', of: 'm9002', emoji: THUMB, from: 'april', members: ['april', 'angel'] }).ok, true);
});

test('#7869: to an agent the note is not between, it stays "no post by that id" (a private note is never shown to exist)', () => {
  seed({ kind: 'message', id: 'm9003', from: 'angel', to: 'april', text: 'private', in_reply_to: null, state: 'placed' });
  const r = messages.react({ project: 'room7869', of: 'm9003', emoji: THUMB, from: 'mikey', members: ['april', 'angel', 'mikey'] });
  assert.equal(r.ok, false);
  assert.equal(r.because, 'there is no post by that id in this room');
  // And an id that is nothing at all reads the same.
  assert.equal(messages.react({ project: 'room7869', of: 'm999999', emoji: THUMB, from: 'april', members: ['april', 'angel'] }).because,
    'there is no post by that id in this room');
});

test('#7869: a note that never reached its recipient (still held, or not delivered) is not shown to them', () => {
  const cases = [['m9004', { state: 'held', heldUntil: null }], ['m9006', { state: 'could_not' }]];
  for (const [id, extra] of cases) {
    seed({ kind: 'message', id, from: 'angel', to: 'april', text: 'not reached', in_reply_to: null, ...extra });
    const r = messages.react({ project: 'room7869', of: id, emoji: THUMB, from: 'april', members: ['april', 'angel'] });
    assert.equal(r.because, 'there is no post by that id in this room', `${JSON.stringify(extra)} was shown to its recipient`);
  }
  // CONTROL: a note that did reach them is said plainly: unconfirmed, typed behind a working turn (queued), and held then
  // typed later (its held-delivered row).
  seed({ kind: 'message', id: 'm9007', from: 'angel', to: 'april', text: 'reached', in_reply_to: null, state: 'unconfirmed' });
  seed({ kind: 'message', id: 'm9005', from: 'angel', to: 'april', text: 'typed behind a turn', in_reply_to: null, state: 'placed', queued: true });
  seed({ kind: 'message', id: 'm9008', from: 'angel', to: 'april', text: 'held then typed', in_reply_to: null, state: 'held', heldUntil: null });
  seed({ kind: 'held-delivered', of: 'm9008', from: 'angel', to: 'april', state: 'placed' });
  for (const id of ['m9007', 'm9005', 'm9008']) {
    assert.match(messages.react({ project: 'room7869', of: id, emoji: THUMB, from: 'april', members: ['april', 'angel'] }).because,
      new RegExp('^' + id + ' is a direct message'), id + ' reached its recipient but was not said plainly');
  }
});
