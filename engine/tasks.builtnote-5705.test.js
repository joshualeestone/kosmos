'use strict';
/**
 * #5705 slice 2 (user feedback, 2026-10-09): a task stayed "built" though the work was never done. A task with
 * done-when checks (#5152) says what finished means, so an agent's built mark on it must carry a note saying how the
 * checks went; a bare one is refused and writes nothing. The person's mark (from the screen) is never refused, and a
 * task without checks takes a bare mark as before.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.builtnote-5705.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtnote-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtnote-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const tasks = require('./tasks');
const taskchat = require('./taskchat');

test.after(() => {
  for (const k of ['AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_PROJECTS']) fs.rmSync(process.env[k], { recursive: true, force: true });
});

const project = () => projects.create({ name: 'Notes ' + Math.random().toString(36).slice(2), agents: ['rex'] }).id;
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);

test('#5705: a bare agent mark on a task with one check is refused, writes nothing, and says what to do', () => {
  const id = project();
  const n = tasks.create(id, { sentence: 'Checked', who: 'rex', doneWhen: ['it works'] }).number;
  const out = tasks.setBuilt(id, n, { by: 'rex' });
  assert.equal(out.ok, false);
  assert.equal(out.needsNote, true);
  assert.equal(out.because, `this task has a done-when check, so mark it built with a note saying how it went: kosmos task built ${id} ${n} '1 met. 2 not met: <why>'`);
  assert.equal('builtAt' in stored(id, n), false);
  assert.ok(!taskchat.read(id, n).some((e) => e.kind === 'built'), 'a refused mark wrote a history line');
  assert.equal(tasks.setBuilt(id, n, { by: 'rex', note: '1 met.' }).ok, true);
  assert.equal(tasks.taskState(stored(id, n)), 'built');
});

test('#5705: the person never needs a note, an unnamed caller does, and an unchecked task never does', () => {
  const id = project();
  const a = tasks.create(id, { sentence: 'Checked A', who: 'rex', doneWhen: ['one', 'two'] }).number;
  assert.equal(tasks.setBuilt(id, a, { person: true }).ok, true);
  const b = tasks.create(id, { sentence: 'Checked B', who: 'rex', doneWhen: ['one'] }).number;
  assert.equal(tasks.setBuilt(id, b, { by: null }).ok, false, 'an unnamed caller is not the person');
  const c = tasks.create(id, { sentence: 'No checks', who: 'rex' }).number;
  assert.equal(tasks.setBuilt(id, c, { by: 'rex' }).ok, true, 'CONTROL: no checks, no note needed');
});

test('#5705: re-marking an already-built checked task bare is refused too, and the earlier note stays', () => {
  const id = project();
  const n = tasks.create(id, { sentence: 'Checked', who: 'rex', doneWhen: ['it works'] }).number;
  assert.equal(tasks.setBuilt(id, n, { by: 'rex', note: '1 met.' }).ok, true);
  assert.equal(tasks.setBuilt(id, n, { by: 'rex' }).ok, false);
  assert.equal(stored(id, n).builtNote, '1 met.');
});
