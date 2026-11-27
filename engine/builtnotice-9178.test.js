'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9178 review 1: tasks.droppedBuiltForWork answers from writeParts' own mark, on the task the write returned:
 * true only when new work (a part added, a part given open, a part put back) dropped a built mark, false otherwise.
 * The real engine on a sandboxed project, no stubs (server.built-notice-9178.test.js stubs this answer).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'builtnotice-9178-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const tasks = require('./tasks');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

let seq = 0;
/* A task with two parts (ada, bo), built by the person if `built`. */
function shared(built) {
  const proj = projects.create({ name: 'Built notice 9178 ' + (++seq), agents: ['ada', 'bo'] });
  const t = tasks.create(proj.id, { sentence: 'shared ' + seq, made: { via: 'screen' } });
  assert.ok(tasks.addPart(proj.id, t.number, { sentence: 'one', who: 'ada' }).ok);
  assert.ok(tasks.addPart(proj.id, t.number, { sentence: 'two', who: 'bo' }).ok);
  if (built) tasks.setBuilt(proj.id, t.number, { person: true, note: 'done' });
  return { id: proj.id, n: t.number };
}
const builtNow = (id, n) => !!tasks.byNumber(projects.readAll().find((p) => p.id === id), n).builtAt;

test('#9178: a part added to a built task drops the mark, and droppedBuiltForWork says so', () => {
  const s = shared(true);
  assert.ok(builtNow(s.id, s.n), 'fixture: the task is built');
  const out = tasks.addPart(s.id, s.n, { sentence: 'three', who: 'bo' });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(tasks.droppedBuiltForWork(out.task), true);
  assert.equal(builtNow(s.id, s.n), false, 'the mark is gone from the store');
});

test('#9178 control: a part added to a task that was not built drops nothing', () => {
  const s = shared(false);
  const out = tasks.addPart(s.id, s.n, { sentence: 'three', who: 'bo' });
  assert.ok(out.ok);
  assert.equal(tasks.droppedBuiltForWork(out.task), false);
});

test('#9178: an open part given to someone else drops the mark; a keepBuilt give (the Assigner\'s take-back) writes nothing', () => {
  const s = shared(true);
  // keepBuilt refuses a built task inside the write, so it never drops the mark (measured: ok false, still built).
  const kept = tasks.assignPart(s.id, s.n, 2, 'ada', { keepBuilt: true });
  assert.equal(kept.ok, false, 'a keepBuilt give to a built task is refused: ' + JSON.stringify(kept));
  assert.equal(tasks.droppedBuiltForWork(kept.task), false);
  assert.ok(builtNow(s.id, s.n), 'still built after the refused give');
  const given = tasks.assignPart(s.id, s.n, 2, 'bo');
  assert.ok(given.ok, JSON.stringify(given));
  assert.equal(tasks.droppedBuiltForWork(given.task), true);
  assert.equal(builtNow(s.id, s.n), false);
});

test('#9178: a part put back on a built task drops the mark (new work)', () => {
  const s = shared(false);
  assert.ok(tasks.setPartClosed(s.id, s.n, 1, new Date().toISOString()).ok, 'part 1 closed; part 2 keeps the task open');
  tasks.setBuilt(s.id, s.n, { person: true, note: 'done' });
  assert.ok(builtNow(s.id, s.n), 'fixture: built with one part closed');
  const back = tasks.setPartClosed(s.id, s.n, 1, null);
  assert.ok(back.ok, JSON.stringify(back));
  assert.equal(tasks.droppedBuiltForWork(back.task), true);
});

test('#9178: the answer belongs to the object the write returned, never to another read of the same task', () => {
  const s = shared(true);
  const out = tasks.addPart(s.id, s.n, { sentence: 'three', who: 'bo' });
  assert.equal(tasks.droppedBuiltForWork(out.task), true);
  const reread = tasks.byNumber(projects.readAll().find((p) => p.id === s.id), s.n);
  assert.equal(tasks.droppedBuiltForWork(reread), false, 'a fresh read carries no mark of a past write');
  assert.equal(tasks.droppedBuiltForWork(null), false);
});
