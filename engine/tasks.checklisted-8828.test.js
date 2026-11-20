'use strict';

/**
 * kosmos#8828 item 3: a check number the task does not have is refused with the checks it does have, numbered and in
 * their own words, both when reporting a check (setCheckResult) and when changing one (setDoneWhenCheck).
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.checklisted-8828.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checklisted-data-'));
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-checklisted-proj-'));
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

test('kosmos#8828: reporting a check the task does not have names the checks it has', () => {
  const { id, n } = withChecks(['the page loads', 'the test passes']);
  const [code, msg] = status(() => tasks.setCheckResult(id, n, 3, true, 'ran it', { by: 'checker' }));
  assert.equal(code, 409);
  assert.match(msg, /has 2 done-when checks, so there is no check 3: 1\. 'the page loads'; 2\. 'the test passes'$/);
});

test('kosmos#8828: changing a check the task does not have names the checks it has, whole, with no double quote', () => {
  const long = 'x'.repeat(200);
  const { id, n } = withChecks(['the page says "Saved"', long]);
  const [code, msg] = status(() => tasks.setDoneWhenCheck(id, n, 3, 'new words', { by: 'x', person: true }));
  assert.equal(code, 409);
  assert.match(msg, /so there is no check 3: 1\. 'the page says 'Saved''; 2\. 'x{200}'$/);
  // install/kosmos reads the refusal with a sed that stops at the first double quote (doneWhenProblem).
  assert.ok(!msg.includes('"'), 'a double quote in the error cuts the CLI\'s reading of it: ' + msg);
  // CONTROL: a check the task has is changed, with no error.
  assert.equal(status(() => tasks.setDoneWhenCheck(id, n, 1, 'the page loads fast', { by: 'x', person: true }))[0], 200);
});
