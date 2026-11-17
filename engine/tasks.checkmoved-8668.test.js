'use strict';

/**
 * #8668: a check report's evidence holds 1000 characters (the built note's room, #8352), and an unmet check can say
 * which task its part moved to (`movedTo`), shown on both tasks.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.checkmoved-8668.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkmoved-data-'));
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkmoved-proj-'));
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_PROJECTS = PROJ;

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');
const tasklist = require('../engine/tasklist');
const phrase = require('../engine/taskactphrase');

test.after(() => {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(PROJ, { recursive: true, force: true });
});

const project = () => projects.create({ name: 'Moved ' + Math.random().toString(36).slice(2) }).id;
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);
const status = (fn) => { try { fn(); } catch (e) { return [e.status || 400, e.message]; } return [200, '']; };
const twoTasks = () => {
  const id = project();
  const a = tasks.create(id, { sentence: 'Ship it', doneWhen: ['the page loads', 'it works on Windows'] }).number;
  const b = tasks.create(id, { sentence: 'Windows follow-up' }).number;
  return { id, a, b };
};

test('the cap is the built note\'s, counted in characters, so a 400-character line is kept whole', () => {
  assert.equal(tasks.CHECK_HOW_MAX, 1000);
  assert.equal(tasks.CHECK_HOW_MAX, tasks.BUILT_NOTE_MAX, 'the same room as the built note (#8352)');
  const { id, a } = twoTasks();
  const how = ('main 96273a9 reads 0.8.08 from latest.json; the download re-hashes to the pointer. ').repeat(5).trim();
  assert.ok(how.length >= 400, 'the card asks for 400');
  tasks.setCheckResult(id, a, 1, true, how, { by: 'mara' });
  assert.equal(tasks.checkResultsOf(stored(id, a))[0].how, how, 'stored whole, never cut');
  // Characters, not UTF-16 units: 1000 emoji (2000 units) are allowed, 1001 are not.
  assert.equal(status(() => tasks.setCheckResult(id, a, 1, true, '\u{1F600}'.repeat(1000), { by: 'mara' }))[0], 200);
  const [code, msg] = status(() => tasks.setCheckResult(id, a, 1, true, '\u{1F600}'.repeat(1001), { by: 'mara' }));
  assert.equal(code, 400); assert.match(msg, /1000 characters or fewer/);
  assert.doesNotMatch(msg, /"/, 'no double quote: install/kosmos lifts the refusal with a sed that stops at one');
  // Still one line of plain text, whatever its length.
  assert.match(status(() => tasks.setCheckResult(id, a, 1, true, 'a\u2028b', { by: 'mara' }))[1], /one line of plain text/);
  assert.equal(status(() => tasks.setCheckResult(id, a, 1, true, 'a\u200cb', { by: 'mara' }))[0], 200, 'the zero-width non-joiner a word needs (control)');
});

test('a check sentence keeps its own 200 (only the evidence grew)', () => {
  const id = project();
  assert.equal(status(() => tasks.create(id, { sentence: 'x', doneWhen: ['c'.repeat(201)] }))[0], 400);
  assert.equal(status(() => tasks.create(id, { sentence: 'x', doneWhen: ['c'.repeat(200)] }))[0], 200);
});

test('an unmet check moved to another task stores the link, and the activity says so', () => {
  const { id, a, b } = twoTasks();
  const out = tasks.setCheckResult(id, a, 2, false, 'no Windows box to run it on', { by: 'mara', movedTo: b });
  assert.equal(out.changed, true);
  const r = tasks.checkResultsOf(stored(id, a))[1];
  assert.equal(r.movedTo, b);
  assert.equal(tasks.checkResultsOf(stored(id, a))[0], null, 'the other check is untouched');
  const ev = taskchat.read(id, a).filter((x) => x.kind === 'check-reported').pop();
  assert.equal(ev.movedTo, b);
  assert.match(phrase.phrase(ev), new RegExp('is not met: .*no Windows box to run it on.*\\. Moved to task ' + b + '$'));
  assert.doesNotMatch(phrase.phrase({ ...ev, met: true }), /Moved to/, 'a met row never says it moved (control)');
  assert.match(phrase.phrase({ ...ev, how: 'done.' }), /done\. Moved to task /, 'words that end a sentence are not given a second full stop');
  // The same report again records nothing; the same words without the link are a change.
  assert.equal(tasks.setCheckResult(id, a, 2, false, 'no Windows box to run it on', { by: 'mara', movedTo: b }).changed, false);
  assert.equal(tasks.setCheckResult(id, a, 2, false, 'no Windows box to run it on', { by: 'mara' }).changed, true);
  assert.equal(tasks.checkResultsOf(stored(id, a))[1].movedTo, undefined, 'reported again without it, the link goes');
});

test('moved-to is refused on a met check, onto its own task, onto no task, and for a non-number', () => {
  const { id, a, b } = twoTasks();
  const [c1, m1] = status(() => tasks.setCheckResult(id, a, 1, true, 'x', { by: 'mara', movedTo: b }));
  assert.equal(c1, 400); assert.match(m1, /only an unmet check/);
  assert.match(status(() => tasks.setCheckResult(id, a, 1, false, 'x', { by: 'mara', movedTo: a }))[1], /its own task/);
  assert.equal(status(() => tasks.setCheckResult(id, a, 1, false, 'x', { by: 'mara', movedTo: 999 }))[0], 409);
  for (const bad of ['2', 0, -1, 1.5, true]) assert.equal(status(() => tasks.setCheckResult(id, a, 1, false, 'x', { by: 'mara', movedTo: bad }))[0], 400, String(bad));
  assert.equal(tasks.checkResultsOf(stored(id, a))[0], null, 'nothing was stored by any refusal');
  assert.equal(status(() => tasks.setCheckResult(id, a, 1, false, 'x', { by: 'mara', movedTo: b }))[0], 200, 'control: the same call with a good target');
});

test('a stored movedTo on a met report is not read back (only an unmet check moves)', () => {
  const t = { doneWhen: ['a'], doneWhenResults: [{ met: true, how: 'x', by: 'm', movedTo: 4 }] };
  assert.equal(tasks.checkResultsOf(t)[0].movedTo, undefined);
  const u = { doneWhen: ['a'], doneWhenResults: [{ met: false, how: 'x', by: 'm', movedTo: 4 }] };
  assert.equal(tasks.checkResultsOf(u)[0].movedTo, 4, 'control');
});

test('kosmos task show names the link on both tasks', () => {
  const { id, a, b } = twoTasks();
  tasks.setCheckResult(id, a, 2, false, 'no Windows box', { by: 'mara', movedTo: b });
  const p = projects.readAll().find((x) => x.id === id);
  const body = { tasks: p.tasks };
  const from = tasklist.showLines(body, a, 'proj').lines.join('\n');
  assert.match(from, /says not met: "no Windows box".*; moved to task 2/);
  const to = tasklist.showLines(body, b, 'proj').lines.join('\n');
  assert.match(to, /Moved here from other tasks:\n {4}check 2 of task 1, reported not met there: it works on Windows$/m);
  const control = tasklist.showLines(body, a, 'proj').lines.join('\n');
  assert.doesNotMatch(control, /Moved here/, 'the reporting task itself lists nothing moved here');
});
