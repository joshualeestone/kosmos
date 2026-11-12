'use strict';

/**
 * #8464 item 2: an agent reports how each done-when check went (tasks.setCheckResult), into doneWhenResults, a list
 * aligned with doneWhen. A report is the agent's word, never a verification. It goes when what it describes goes.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.checkresults-8464.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkres-data-'));
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checkres-proj-'));
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_PROJECTS = PROJ;

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

test.after(() => {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(PROJ, { recursive: true, force: true });
});

const freshProject = () => projects.create({ name: 'Checks ' + Math.random().toString(36).slice(2) }).id;
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);
function withChecks(checks = ['the page loads', 'the test passes', 'the docs say so']) {
  const id = freshProject();
  const t = tasks.create(id, { sentence: 'Ship it', doneWhen: checks });
  return { id, n: t.number };
}
const status = (fn) => { try { fn(); } catch (e) { return [e.status || 400, e.message]; } return [200, '']; };

test('a report is stored aligned with its check, and the others stay unreported', () => {
  const { id, n } = withChecks();
  const out = tasks.setCheckResult(id, n, 2, true, '  node --test passed, 40 of 40  ', { by: 'mara-discord' });
  assert.equal(out.changed, true);
  const r = tasks.checkResultsOf(stored(id, n));
  assert.equal(r.length, 3);
  assert.equal(r[0], null);
  assert.equal(r[2], null);
  assert.equal(r[1].met, true);
  assert.equal(r[1].how, 'node --test passed, 40 of 40', 'trimmed');
  assert.equal(r[1].by, 'mara-discord');
  assert.ok(Number.isFinite(Date.parse(r[1].at)));
  assert.deepEqual(tasks.checkCounts(stored(id, n)), { total: 3, reported: 1, met: 0 + 1 });
  const row = taskchat.read(id, n).filter((x) => x.kind === 'check-reported').pop();
  assert.equal(row.check, 2); assert.equal(row.met, true); assert.equal(row.by, 'mara-discord');
});

test('unmet is stored as met false and counts as reported, not met', () => {
  const { id, n } = withChecks();
  tasks.setCheckResult(id, n, 1, false, 'the page still 500s', { by: 'mara-discord' });
  assert.deepEqual(tasks.checkCounts(stored(id, n)), { total: 3, reported: 1, met: 0 });
});

test('the same report again records nothing; a changed one replaces it', () => {
  const { id, n } = withChecks();
  tasks.setCheckResult(id, n, 1, false, 'not yet', { by: 'a-discord' });
  const rows = () => taskchat.read(id, n).filter((x) => x.kind === 'check-reported').length;
  assert.equal(tasks.setCheckResult(id, n, 1, false, 'not yet', { by: 'a-discord' }).changed, false);
  assert.equal(rows(), 1);
  assert.equal(tasks.setCheckResult(id, n, 1, true, 'now it loads', { by: 'a-discord' }).changed, true);
  assert.equal(rows(), 2);
  assert.equal(tasks.checkResultsOf(stored(id, n))[0].met, true);
});

test('refusals: bad number, no such check, no checks, closed, unnamed, bad how', () => {
  const { id, n } = withChecks(['one', 'two']);
  assert.equal(status(() => tasks.setCheckResult(id, n, 0, true, 'x', { by: 'a' }))[0], 400);
  assert.equal(status(() => tasks.setCheckResult(id, n, 1.5, true, 'x', { by: 'a' }))[0], 400);
  const [code, msg] = status(() => tasks.setCheckResult(id, n, 3, true, 'x', { by: 'a' }));
  assert.equal(code, 409); assert.match(msg, /has 2 done-when checks, so there is no check 3/);
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, 'yes', 'x', { by: 'a' }))[0], 400, 'met must be a boolean');
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, '   ', { by: 'a' }))[0], 400);
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, 'a\nb', { by: 'a' }))[0], 400, 'one line');
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, 'x'.repeat(201), { by: 'a' }))[0], 400);
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, 'x'.repeat(200), { by: 'a' }))[0], 200, 'the limit itself is allowed (control)');
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, 'y'.repeat(200) + '  ', { by: 'a' }))[0], 200, 'the limit is on the stored, trimmed words');
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, '<how you checked it>', { by: 'a' }))[0], 400, 'an unfilled placeholder is no report');
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, 'x', { by: null }))[0], 403);
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, 'x', { by: '  ' }))[0], 403);
  const bare = tasks.create(id, { sentence: 'No checks' }).number;
  assert.equal(status(() => tasks.setCheckResult(id, bare, 1, true, 'x', { by: 'a' }))[0], 409);
  tasks.close(id, n);
  assert.equal(status(() => tasks.setCheckResult(id, n, 1, true, 'x', { by: 'a' }))[0], 409);
});

test('changing one check drops only its report; a new list drops them all', () => {
  const { id, n } = withChecks();
  tasks.setCheckResult(id, n, 1, true, 'a', { by: 'x', person: true });
  tasks.setCheckResult(id, n, 2, true, 'b', { by: 'x', person: true });
  tasks.setDoneWhenCheck(id, n, 2, 'the test passes on Windows', { by: 'x', person: true });
  let r = tasks.checkResultsOf(stored(id, n));
  assert.equal(r[0].how, 'a', 'check 1 was not changed, so its report stays');
  assert.equal(r[1], null, 'check 2 changed, so its report went');
  // Control: the same wording again is no change, and keeps the report.
  tasks.setDoneWhenCheck(id, n, 1, 'the page loads', { by: 'x', person: true });
  assert.equal(tasks.checkResultsOf(stored(id, n))[0].how, 'a');
  tasks.setDoneWhen(id, n, ['something else'], { by: 'x', person: true });
  assert.equal('doneWhenResults' in stored(id, n), false);
  tasks.setCheckResult(id, n, 1, true, 'c', { by: 'x', person: true });
  tasks.setDoneWhen(id, n, null, { by: 'x', person: true });
  assert.equal('doneWhenResults' in stored(id, n), false, 'cleared checks take their reports');
});

test('a built mark keeps the reports; taking it off and a reopen drop them; closing keeps them', () => {
  const { id, n } = withChecks(['one']);
  tasks.setCheckResult(id, n, 1, true, 'done', { by: 'x' });
  assert.equal(tasks.setBuilt(id, n, { by: 'x', note: 'all met' }).ok, true);
  assert.equal(tasks.checkResultsOf(stored(id, n))[0].how, 'done', 'marking built must not wipe the reports');
  tasks.clearBuilt(id, n, { by: 'x' });
  assert.equal('doneWhenResults' in stored(id, n), false, 'the mark off says the work is not done');
  tasks.setCheckResult(id, n, 1, true, 'again', { by: 'x' });
  tasks.close(id, n);
  assert.equal(stored(id, n).doneWhenResults[0].how, 'again', 'closing keeps them');
  tasks.reopen(id, n);
  assert.equal('doneWhenResults' in stored(id, n), false, 'a reopen is new work');
});

test('built without a note: refused until EVERY check is reported, then allowed', () => {
  const { id, n } = withChecks(['one', 'two']);
  assert.equal(tasks.setBuilt(id, n, { by: 'x' }).needsNote, true, 'control: no reports, no note, refused');
  tasks.setCheckResult(id, n, 1, true, 'a', { by: 'x' });
  assert.equal(tasks.setBuilt(id, n, { by: 'x' }).needsNote, true, 'one of two reported is not enough');
  tasks.setCheckResult(id, n, 2, false, 'b fails on Linux', { by: 'x' });
  const unmet = tasks.setBuilt(id, n, { by: 'x' });
  assert.equal(unmet.needsNote, true, 'a check reported NOT met still needs the note, to say what is left');
  assert.match(unmet.because, /reported not met, so mark it built with a note saying what is left/);
  assert.equal(tasks.setBuilt(id, n, { by: 'x', note: 'b is left: Linux' }).ok, true, 'control: with a note it is marked');
  tasks.clearBuilt(id, n, { by: 'x' });
  tasks.setCheckResult(id, n, 1, true, 'a', { by: 'x' });
  tasks.setCheckResult(id, n, 2, true, 'b passes on Linux now', { by: 'x' });
  assert.equal(tasks.setBuilt(id, n, { by: 'x' }).ok, true, 'every check reported met: no note needed');
});
