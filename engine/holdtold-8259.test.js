'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#8259: a hold that waits on the person records when the person was TOLD, apart from when it was set, and the
 * person's answer prompts the holder to take it off hold.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/holdtold-8259.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ht-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ht-proj-'));
const FLEET_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ht-fleet-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_ROOT, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(FLEET_ROOT, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(FLEET_ROOT, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const tasks = require('./tasks');
const taskchat = require('./taskchat');
const holdtold = require('./holdtold');

let seq = 0;
/* A project with leo and mara on it, and a task leo holds, put on hold for the person (forYou false: an ordinary hold). */
function held(forYou = true, name) {
  const p = projects.create({ name: name || 'Told ' + (++seq), agents: ['leo', 'mara'] });
  const t = tasks.create(p.id, { sentence: 'pick a price', who: 'leo' });
  tasks.setOnHold(p.id, t.number, true, forYou ? { forPerson: true, because: 'needs your yes' } : {});
  return { id: p.id, n: t.number, name: p.name };
}
const read = (id, n) => tasks.byNumber(projects.get(id), n);

test('namedNumbers: #N and task N, never digits inside a longer number or a word', () => {
  assert.deepEqual([...holdtold.namedNumbers('see #12 and task 7, also Task #9')].sort((a, b) => a - b), [7, 9, 12]);
  assert.deepEqual([...holdtold.namedNumbers('#123, v12, a#12, &#12; and 12 alone')], [123], 'only #123 is a task number here');
  assert.equal(holdtold.namedNumbers('').size, 0);
  assert.equal(holdtold.namedNumbers(null).size, 0);
});

test('a holder writing in the task\'s conversation tells the person: told-at, apart from the hold', () => {
  const { id, n } = held();
  assert.equal(read(id, n).onHoldToldAt, undefined, 'set is not told');
  const marked = holdtold.noteTold('leo', { via: 'task', projectId: id, task: n, at: '2026-11-08T12:00:00.000Z' });
  assert.deepEqual(marked, [{ projectId: id, n, first: true }]);
  const t = read(id, n);
  assert.equal(t.onHoldToldAt, '2026-11-08T12:00:00.000Z');
  assert.equal(t.onHoldToldVia, 'task');
  assert.ok(taskchat.read(id, n).some((e) => e.kind === 'hold-told' && e.who === 'leo' && e.via === 'task'));
});

test('the first tell is the age of the ask; the latest tell moves on beside it', () => {
  const { id, n } = held();
  assert.equal(holdtold.noteTold('leo', { via: 'task', projectId: id, task: n, at: '2026-11-08T10:00:00.000Z' })[0].first, true);
  assert.equal(holdtold.noteTold('leo', { via: 'task', projectId: id, task: n, at: '2026-11-08T11:00:00.000Z' })[0].first, false);
  const t = read(id, n);
  assert.equal(t.onHoldToldAt, '2026-11-08T10:00:00.000Z');
  assert.equal(t.onHoldLastToldAt, '2026-11-08T11:00:00.000Z');
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'hold-told').length, 1, 'the history records the first ask once');
});

test('round 1 W1: tell, answer, tell again, answer again: the second answer prompts too (directly and in the room)', () => {
  const p = projects.create({ name: 'Again ' + (++seq), agents: ['eve'] });
  const t = tasks.create(p.id, { sentence: 'price', who: 'eve' });
  tasks.setOnHold(p.id, t.number, true, { forPerson: true });
  holdtold.noteTold('eve', { via: 'reply', text: 'task ' + t.number + ': 40?', at: Date.now() - 4000 });
  const a1 = holdtold.noteAnswered({ via: 'reply', to: 'eve', text: 'maybe' });
  assert.equal(a1.length, 1);
  holdtold.markAnswered(a1, Date.now() - 3000);
  assert.deepEqual(holdtold.noteAnswered({ via: 'reply', to: 'eve', text: 'thinking' }), [], 'CONTROL: answered and not asked again: quiet');
  holdtold.noteTold('eve', { via: 'reply', text: 'task ' + t.number + ': I need a yes or no', at: Date.now() - 2000 });
  assert.equal(holdtold.noteAnswered({ via: 'reply', to: 'eve', text: 'yes' }).length, 1, 'asked again, so the next answer prompts');
  // Told in the room, then asked again directly: the direct answer prompts (the via follows the latest ask).
  // gus holds one for-you hold only (leo holds a task 1 in most projects here, which a direct reply cannot tell apart).
  const rp = projects.create({ name: 'Again Room ' + (++seq), agents: ['gus'] });
  const rt = tasks.create(rp.id, { sentence: 'price', who: 'gus' });
  tasks.setOnHold(rp.id, rt.number, true, { forPerson: true });
  holdtold.noteTold('gus', { via: 'room', projectId: rp.id, text: '#' + rt.number + '?', at: Date.now() - 2000 });
  holdtold.noteTold('gus', { via: 'reply', text: 'about task ' + rt.number + ', still need it', at: Date.now() - 1000 });
  assert.equal(read(rp.id, rt.number).onHoldToldVia, 'reply');
  assert.equal(holdtold.noteAnswered({ via: 'reply', to: 'gus', text: 'yes' }).length, 1);
});

test('round 1 NIT: directly, a bare #N is not a tell (it is more often a card number); task N is', () => {
  const p = projects.create({ name: 'Bare ' + (++seq), agents: ['fay'] });
  const t = tasks.create(p.id, { sentence: 'one', who: 'fay' });
  tasks.setOnHold(p.id, t.number, true, { forPerson: true });
  assert.deepEqual(holdtold.noteTold('fay', { via: 'reply', text: 'merged #' + t.number }), []);
  assert.equal(read(p.id, t.number).onHoldToldAt, undefined);
  assert.equal(holdtold.noteTold('fay', { via: 'reply', text: 'task #' + t.number + '?' }).length, 1, 'CONTROL: task #N is');
});

test('round 2: with two holders, one reached is not answered; both reached is', () => {
  const p = projects.create({ name: 'Two ' + (++seq), agents: ['hal', 'ivy'] });
  const t = tasks.create(p.id, { sentence: 'shared', who: 'hal' });
  const two = tasks.addPart(p.id, t.number, { sentence: 'other half', who: 'ivy' });
  assert.equal(two.ok, true, two.because || '');
  tasks.setOnHold(p.id, t.number, true, { forPerson: true });
  const ans = holdtold.noteAnswered({ via: 'room', projectId: p.id, text: '#' + t.number + ' yes', to: ['hal', 'ivy'] });
  assert.deepEqual(ans.map((x) => x.holders.slice().sort()), [['hal', 'ivy']]);
  holdtold.markAnswered(ans, Date.now(), (h) => h === 'hal');
  assert.equal(read(p.id, t.number).onHoldAnsweredAt, undefined, 'ivy never saw it, so it stays open');
  holdtold.markAnswered(ans, Date.now(), () => true);
  assert.equal(typeof read(p.id, t.number).onHoldAnsweredAt, 'string', 'CONTROL: both reached');
});

test('round 2: a clause names at most CLAUSE_SHOWN holds and counts the rest', () => {
  const xs = Array.from({ length: 15 }, (_, i) => ({ projectId: 'p', project: 'P', n: i + 1, holders: ['a'] }));
  const c = holdtold.clauseFor(xs, 'a');
  assert.equal((c.match(/kosmos task unhold/g) || []).length, holdtold.CLAUSE_SHOWN);
  assert.match(c, / and 12 more on hold/);
  assert.match(c, /the rest: kosmos task list/);
  assert.ok(c.length < 400, 'bounded: ' + c.length);
  assert.doesNotMatch(holdtold.clauseFor(xs.slice(0, 3), 'a'), /more/, 'CONTROL: three are all named');
});

test('round 2: a drained reply with an old send time never moves the marks back in time', () => {
  const p = projects.create({ name: 'Drain ' + (++seq), agents: ['jo'] });
  const t = tasks.create(p.id, { sentence: 'one', who: 'jo' });
  tasks.setOnHold(p.id, t.number, true, { forPerson: true });
  holdtold.noteTold('jo', { via: 'reply', text: 'task ' + t.number + '?', at: '2026-11-08T12:00:00.000Z' });
  holdtold.noteTold('jo', { via: 'reply', text: 'task ' + t.number + ' again', at: '2026-11-08T09:00:00.000Z' });
  const after = read(p.id, t.number);
  assert.equal(after.onHoldToldAt, '2026-11-08T12:00:00.000Z', 'the first ask stays');
  assert.ok(Date.parse(after.onHoldLastToldAt) >= Date.parse('2026-11-08T12:00:00.000Z'), 'not moved back: ' + after.onHoldLastToldAt);
});

test('round 1 W4: markAnswered marks only holds it reached', () => {
  const { id, n } = held();
  holdtold.markAnswered([{ projectId: id, n, holders: ['leo'] }], Date.now(), (h) => h === 'mara');
  assert.equal(read(id, n).onHoldAnsweredAt, undefined, 'not typed to leo, so the answer stays open');
  holdtold.markAnswered([{ projectId: id, n, holders: ['leo'] }], Date.now(), (h) => h === 'leo');
  assert.equal(typeof read(id, n).onHoldAnsweredAt, 'string', 'CONTROL: typed to leo');
});

test('controls: an ordinary hold and a non-holder are never told', () => {
  const a = held(false);
  assert.deepEqual(holdtold.noteTold('leo', { via: 'task', projectId: a.id, task: a.n }), []);
  assert.equal(read(a.id, a.n).onHoldToldAt, undefined);
  const b = held();
  assert.deepEqual(holdtold.noteTold('mara', { via: 'task', projectId: b.id, task: b.n }), []);
  assert.equal(read(b.id, b.n).onHoldToldAt, undefined);
});

test('a room post tells only when it names the task', () => {
  const { id, n } = held();
  assert.deepEqual(holdtold.noteTold('leo', { via: 'room', projectId: id, text: 'can you decide the price?' }), []);
  assert.equal(read(id, n).onHoldToldAt, undefined);
  assert.deepEqual(holdtold.noteTold('leo', { via: 'room', projectId: id, text: 'on #' + n + ': can you decide?', id: 'm42' }), [{ projectId: id, n, first: true }]);
  assert.equal(read(id, n).onHoldToldVia, 'room');
  assert.equal(read(id, n).onHoldToldId, 'm42');
});

test('a room post in another project does not tell', () => {
  const a = held();
  const other = projects.create({ name: 'Elsewhere ' + (++seq), agents: ['leo'] });
  assert.deepEqual(holdtold.noteTold('leo', { via: 'room', projectId: other.id, text: 'task ' + a.n + ' please' }), []);
  assert.equal(read(a.id, a.n).onHoldToldAt, undefined);
});

test('a direct reply tells when exactly one of the agent\'s for-you holds has that number, never on a guess', () => {
  const lone = projects.create({ name: 'Solo ' + (++seq), agents: ['ada'] });
  const t = tasks.create(lone.id, { sentence: 'one', who: 'ada' });
  tasks.setOnHold(lone.id, t.number, true, { forPerson: true });
  assert.deepEqual(holdtold.noteTold('ada', { via: 'reply', text: 'about task ' + t.number + ': yes or no?' }), [{ projectId: lone.id, n: t.number, first: true }]);
  assert.equal(read(lone.id, t.number).onHoldToldVia, 'reply');
  // Two projects whose for-you holds share a number: the reply names neither for certain, so neither is marked.
  const p1 = projects.create({ name: 'Twin A ' + (++seq), agents: ['bo'] });
  const p2 = projects.create({ name: 'Twin B ' + (++seq), agents: ['bo'] });
  const t1 = tasks.create(p1.id, { sentence: 'x', who: 'bo' });
  const t2 = tasks.create(p2.id, { sentence: 'y', who: 'bo' });
  assert.equal(t1.number, t2.number);
  tasks.setOnHold(p1.id, t1.number, true, { forPerson: true });
  tasks.setOnHold(p2.id, t2.number, true, { forPerson: true });
  assert.deepEqual(holdtold.noteTold('bo', { via: 'reply', text: 'see task ' + t1.number }), []);
  assert.equal(read(p1.id, t1.number).onHoldToldAt, undefined);
  assert.equal(read(p2.id, t2.number).onHoldToldAt, undefined);
});

test('the marks go with the hold: off, unmarked, closed, newly marked or a new reason; a re-hold keeps them', () => {
  const marked = (id, n) => { holdtold.noteTold('leo', { via: 'task', projectId: id, task: n }); holdtold.markAnswered([{ projectId: id, n, holders: ['leo'] }]); };
  const has = (t) => tasks.HOLD_TOLD_FIELDS.filter((k) => k in t);
  const ALL = ['onHoldToldAt', 'onHoldLastToldAt', 'onHoldToldVia', 'onHoldAnsweredAt'];
  const a = held(); marked(a.id, a.n);
  assert.deepEqual(has(read(a.id, a.n)), ALL, 'control: both marks are there');
  assert.deepEqual(has(tasks.setOnHold(a.id, a.n, true)), ALL, 'a bare re-hold is the same ask');
  assert.deepEqual(has(tasks.setOnHold(a.id, a.n, true, { because: 'needs your yes' })), ALL, 'the same reason restated is the same ask');
  // Round 1 NIT: a new reason is a new question, not yet asked.
  assert.deepEqual(has(tasks.setOnHold(a.id, a.n, true, { because: 'now: which supplier?' })), []);
  marked(a.id, a.n);
  assert.deepEqual(has(tasks.setOnHold(a.id, a.n, false)), []);
  const b = held(); marked(b.id, b.n);
  assert.deepEqual(has(tasks.setOnHold(b.id, b.n, true, { forPerson: false })), []);
  // Newly marked on an existing hold: a new ask, not yet told.
  const c = held(false);
  projects.mutate(c.id, (p) => ({ ...p, tasks: p.tasks.map((x) => (x.number === c.n ? { ...x, onHoldToldAt: '2026-01-01T00:00:00.000Z' } : x)) }));
  assert.deepEqual(has(tasks.setOnHold(c.id, c.n, true, { forPerson: true })), []);
  const d = held(); marked(d.id, d.n);
  assert.deepEqual(has(tasks.close(d.id, d.n)), []);
});

test('the person in the task\'s conversation answers every time; directly or in the room, once per tell', () => {
  const { id, n, name } = held();
  const inTask = holdtold.noteAnswered({ via: 'task', projectId: id, task: n });
  assert.deepEqual(inTask, [{ projectId: id, project: name, n, holders: ['leo'] }]);
  holdtold.markAnswered(inTask, '2026-11-08T13:00:00.000Z');
  assert.equal(read(id, n).onHoldAnsweredAt, '2026-11-08T13:00:00.000Z');
  assert.equal(holdtold.noteAnswered({ via: 'task', projectId: id, task: n }).length, 1, 'in the task, again');
  // Room: not told there and not named: no prompt. Named: once, then not again.
  const r = held();
  assert.deepEqual(holdtold.noteAnswered({ via: 'room', projectId: r.id, text: 'lunch?' }), []);
  const once = holdtold.noteAnswered({ via: 'room', projectId: r.id, text: 'for #' + r.n + ': yes', to: ['leo', 'mara'] });
  assert.equal(once.length, 1);
  holdtold.markAnswered(once);
  assert.deepEqual(holdtold.noteAnswered({ via: 'room', projectId: r.id, text: 'and #' + r.n + ' again' }), []);
  // Room, told there: the next post of the person's answers it even with no number.
  const rt = held();
  holdtold.noteTold('leo', { via: 'room', projectId: rt.id, text: '#' + rt.n + '?' });
  assert.equal(holdtold.noteAnswered({ via: 'room', projectId: rt.id, text: 'yes, go ahead' }).length, 1);
  // A room post that does not reach the holder prompts nobody.
  assert.deepEqual(holdtold.noteAnswered({ via: 'room', projectId: rt.id, text: 'yes', to: ['mara'] }), []);
});

test('a direct message answers holds told there, or named, for that agent only', () => {
  const p = projects.create({ name: 'Direct ' + (++seq), agents: ['cy', 'dee'] });
  const t = tasks.create(p.id, { sentence: 'one', who: 'cy' });
  tasks.setOnHold(p.id, t.number, true, { forPerson: true });
  assert.deepEqual(holdtold.noteAnswered({ via: 'reply', to: 'cy', text: 'hello' }), [], 'not told by reply and not named');
  holdtold.noteTold('cy', { via: 'reply', text: 'task ' + t.number + ': yes or no?' });
  assert.deepEqual(holdtold.noteAnswered({ via: 'reply', to: 'dee', text: 'yes' }), [], 'another agent');
  assert.equal(holdtold.noteAnswered({ via: 'reply', to: 'cy', text: 'yes' }).length, 1);
});

test('clauseFor: one sentence for the holder it names, nothing for anyone else, a typed command per task', () => {
  const one = [{ projectId: 'fleet', project: 'Fleet "x"', n: 12, holders: ['leo'] }];
  const c = holdtold.clauseFor(one, 'leo');
  assert.match(c, /^ \[kosmos\] you have task #12 in Fleet x on hold waiting on this person\./);
  assert.match(c, /kosmos task unhold fleet 12\./);
  assert.doesNotMatch(c, /"/);
  assert.equal(holdtold.clauseFor(one, 'mara'), '');
  assert.equal(holdtold.clauseFor([], 'leo'), '');
  const two = holdtold.clauseFor([...one, { projectId: 'bad id', project: 'B', n: 3, holders: ['leo'] }], 'leo');
  assert.match(two, /kosmos task unhold fleet 12, kosmos task unhold <project-id> 3/);
});

test('the agent\'s task show says whether the person was told, and how to tell them', () => {
  const tasklist = require('./tasklist');
  const { id, n } = held();
  const words = () => {
    const out = tasklist.showLines({ tasks: [{ ...read(id, n), projectId: id, isClosed: false }] }, n, id);
    return out.lines.join('\n');
  };
  assert.match(words(), new RegExp('Kosmos has not seen you tell them: ask them in the task, or name task ' + n));
  holdtold.noteTold('leo', { via: 'task', projectId: id, task: n });
  assert.match(words(), /waiting on the person \(you told them /);
  holdtold.markAnswered([{ projectId: id, n, holders: ['leo'] }], Date.now() + 1000);
  assert.match(words(), /\(they answered [^)]*: if that settles it, take it off hold\)/);
});

test('noteTold and noteAnswered never throw on nonsense', () => {
  assert.deepEqual(holdtold.noteTold('', { via: 'task' }), []);
  assert.deepEqual(holdtold.noteTold('leo', { via: 'carrier pigeon' }), []);
  assert.deepEqual(holdtold.noteTold('leo', null), []);
  assert.deepEqual(holdtold.noteAnswered({ via: 'task', projectId: 'no-such', task: 1 }), []);
  assert.doesNotThrow(() => holdtold.markAnswered([{ projectId: 'no-such', n: 1, holders: ['leo'] }]));
});
