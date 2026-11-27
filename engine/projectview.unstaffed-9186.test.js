'use strict';
require('../test-support/tmpscope'); // required first in every suite file (#9104)
/* kosmos#9186: `kosmos project show` says when open or on-hold tasks wait on a project with NO agent on it, beside
 * #8996's activity line, in words an agent can act on; a paused project says its tasks wait on purpose. */
process.env.TZ = 'America/Chicago';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'projectview-9186-'));
process.env.AGENT_WORKFORCE_DATA = path.join(DIR, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(DIR, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(DIR, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('./projectview');
const projects = require('./projects');

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const NOW = Date.parse('2026-11-24T17:00:00Z');
const DAY = 86400000;
const made = new Date(NOW - 3 * DAY).toISOString();
const act = (p) => v.activityOf(p, { now: NOW, lastPostAt: () => null, lastActivityOf: () => null });
const BUILT = { builtAt: '2026-11-23T12:00:00Z', builtBy: 'ada' };

test('#9186: open and on-hold tasks on a project with no agent are counted; built and closed ones are not', () => {
  const p = { id: 'empty', createdAt: made, agents: [], tasks: [
    { number: 1, sentence: 'open' }, { number: 2, sentence: 'held', onHold: true },
    { number: 3, sentence: 'built', ...BUILT }, { number: 4, sentence: 'done', closedAt: '2026-11-23T12:00:00Z' }] };
  assert.equal(act(p).unstaffed, 2);
});

test('#9186 CONTROL: the same tasks with an agent on the project count 0, and a project with no task counts 0', () => {
  assert.equal(act({ id: 'staffed', createdAt: made, agents: ['ada'], tasks: [{ number: 1, sentence: 'open' }] }).unstaffed, 0, 'a stored name');
  assert.equal(act({ id: 'staffed2', createdAt: made, agents: [{ sessionName: 'ada' }], tasks: [{ number: 1, sentence: 'open' }] }).unstaffed, 0, 'a described member');
  assert.equal(act({ id: 'blank', createdAt: made, agents: ['', { sessionName: '' }, null], tasks: [{ number: 1, sentence: 'open' }] }).unstaffed, 1, 'empty entries are nobody');
  assert.equal(act({ id: 'none', createdAt: made, agents: [], tasks: [] }).unstaffed, 0);
  assert.equal(act({ id: 'nofield', createdAt: made, tasks: [{ number: 1, sentence: 'open' }] }).unstaffed, 1, 'no agents field: nobody');
});

test('#9186: the line says nobody will move them, and that the person adds an agent (the + beside Members)', () => {
  const line = v.activityLine(act({ id: 'empty', createdAt: made, agents: [], tasks: [{ number: 1, sentence: 'open' }, { number: 2, sentence: 'two' }] }), 'empty');
  assert.match(line, /^Last activity: /, line);
  assert.match(line, / No agent is on this project, so nothing will move its 2 open or on-hold tasks\. Tell your person: they add an agent with the \+ beside Members on the project's page\.$/, line);
  // review 3: no agent command is offered; a reader is not on the project, and the assign route refuses non-members.
  assert.doesNotMatch(line, /task assign/, line);
  const one = v.activityLine(act({ id: 'empty', createdAt: made, agents: [], tasks: [{ number: 1, sentence: 'open' }] }), 'empty');
  assert.match(one, /its 1 open or on-hold task\./, one);
});

test('#9186: a paused project with no agent says its tasks wait on purpose; staffed or archived says nothing of it', () => {
  const paused = v.activityLine(act({ id: 'pz', createdAt: made, paused: true, agents: [], tasks: [{ number: 1, sentence: 'open' }] }), 'pz');
  assert.match(paused, / No agent is on this paused project, so when your person resumes it, its 1 open or on-hold task still needs someone added\.$/, paused);
  const staffed = v.activityLine(act({ id: 's', createdAt: made, agents: [{ sessionName: 'ada' }], tasks: [{ number: 1, sentence: 'open' }] }), 's');
  assert.doesNotMatch(staffed, /No agent is on/, 'CONTROL: a staffed project: ' + staffed);
  const archived = v.activityLine(act({ id: 'a', createdAt: made, archived: true, agents: [], tasks: [{ number: 1, sentence: 'open' }] }), 'a');
  assert.doesNotMatch(archived, /No agent is on/, 'an archived project: ' + archived);
});

test('#9186: project show prints it on the activity line, and overviewOf carries the count from the real project', () => {
  const o = v.overviewOf({ id: 'empty', name: 'Empty', folder: DIR, createdAt: made, agents: [], tasks: [{ number: 1, sentence: 'open' }] }, [],
    { now: NOW, lastPostAt: () => null, lastActivityOf: () => null, readBrief: () => ({ goal: null, done: null, found: false }),
      readReport: () => null, folderOf: () => null, allProjects: [] });
  assert.equal(o.activity.unstaffed, 1);
  const lines = v.renderShow({ project: { id: 'empty', name: 'Empty', folder: '/tmp/e', briefFound: false, tasks: { total: 1 }, members: [], activity: o.activity } });
  const line = lines.find((l) => l.startsWith('Last activity: ')) || '';
  assert.match(line, /No agent is on this project, so nothing will move its 1 open or on-hold task\./, lines.join('\n'));
});

test('#9186 review 1: on the real path (a project described by projects.describe, then overviewOf) a member counts', () => {
  const opts = { now: NOW, lastPostAt: () => null, lastActivityOf: () => null, readBrief: () => ({ goal: null, done: null, found: false }),
    readReport: () => null, folderOf: () => null, allProjects: [] };
  const raw = (agents) => ({ id: 'real', name: 'Real', folder: DIR, createdAt: made, agents, tasks: [{ number: 1, sentence: 'open' }] });
  const staffed = projects.describe(raw(['ada']), []);
  assert.equal(typeof staffed.agents[0], 'object', 'fixture: describe turns members into objects');
  const o = v.overviewOf(staffed, [], opts);
  assert.equal(o.activity.unstaffed, 0, 'a staffed project is not unstaffed: ' + JSON.stringify(staffed.agents));
  assert.doesNotMatch(v.activityLine(o.activity, 'real'), /No agent is on/);
  const empty = v.overviewOf(projects.describe(raw([]), []), [], opts);
  assert.equal(empty.activity.unstaffed, 1, 'CONTROL: no member');
});

test('#9186 review 2: a test project with no agent says nothing about staffing (its agents do only what they are asked)', () => {
  const a = act({ id: 't', createdAt: made, testOnly: true, agents: [], tasks: [{ number: 1, sentence: 'open' }] });
  assert.equal(a.expected, 'test', 'fixture: read as a test project');
  assert.equal(a.unstaffed, 1, 'fixture: it does have an unstaffed task');
  assert.doesNotMatch(v.activityLine(a, 't'), /No agent is on/);
});

test('#9186 review 3: the paused sentence names the pause itself, even when the line before it cannot (no date to give)', () => {
  const a = act({ id: 'pz', paused: true, agents: [], tasks: [{ number: 1, sentence: 'open' }] });   // no createdAt, no times
  const line = v.activityLine(a, 'pz');
  assert.match(line, /^Last activity: none Kosmos can date\. /, 'fixture: the core line with no date: ' + line);
  assert.match(line, /No agent is on this paused project/, line);
  assert.doesNotMatch(line, /either/, line);
});
