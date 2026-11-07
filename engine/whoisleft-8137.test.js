'use strict';
/* kosmos#8137: on a task with several agents, who has finished and who has not. One rule (tasks.whoIsLeft), read by the
 * board, the iPhone, both CLIs and the nudge. It must agree with assigner.hasOpenWork, which decides who gets nudged:
 * a screen that disagreed with the nudge would be the confusion the card reports.
 *
 *   node --test engine/whoisleft-8137.test.js
 */

require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'whoisleft-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const tasks = require('./tasks');
const assigner = require('./assigner');
const nudge = require('./agentnudge');
const tasklist = require('./tasklist');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const at = '2026-11-06T10:00:00.000Z';
const two = (extra = {}) => ({
  number: 7, sentence: 'Spring catalogue', createdAt: at,
  parts: [{ id: 1, who: 'rex' }, { id: 2, who: 'amy' }],
  ...extra,
});

test('nobody has finished: both are still to finish', () => {
  assert.deepEqual(tasks.whoIsLeft(two()), { finished: [], left: ['rex', 'amy'] });
});

test('one marks it built: that one is finished, the other is not', () => {
  assert.deepEqual(tasks.whoIsLeft(two({ builtAt: at, builtBy: 'rex', builtWho: ['rex'] })), { finished: ['rex'], left: ['amy'] });
});

test('both mark it: everyone is finished, and the line still says so', () => {
  assert.deepEqual(tasks.whoIsLeft(two({ builtAt: at, builtWho: ['rex', 'amy'] })), { finished: ['rex', 'amy'], left: [] });
});

test('a closed part is finished, whoever is on it; an agent with one open part of two is not', () => {
  const closedOne = two({ parts: [{ id: 1, who: 'rex', closedAt: at }, { id: 2, who: 'amy' }] });
  assert.deepEqual(tasks.whoIsLeft(closedOne), { finished: ['rex'], left: ['amy'] });
  const mixed = two({ parts: [{ id: 1, who: 'rex', closedAt: at }, { id: 2, who: 'rex' }, { id: 3, who: 'amy', closedAt: at }] });
  assert.deepEqual(tasks.whoIsLeft(mixed), { finished: ['amy'], left: ['rex'] });
});

test('a task with one agent says nothing, however many parts it has', () => {
  assert.equal(tasks.whoIsLeft({ number: 1, sentence: 'x', who: 'rex' }), null);
  assert.equal(tasks.whoIsLeft(two({ parts: [{ id: 1, who: 'rex' }, { id: 2, who: 'rex' }] })), null);
  assert.equal(tasks.whoIsLeft(two({ parts: [{ id: 1, who: 'rex' }, { id: 2 }] })), null, 'a part with nobody on it is no second agent');
});

test('nothing to tell apart: a closed task, a repeating one, or one the person marked built', () => {
  assert.equal(tasks.whoIsLeft(two({ parts: [{ id: 1, who: 'rex', closedAt: at }, { id: 2, who: 'amy', closedAt: at }] })), null);
  assert.equal(tasks.whoIsLeft(two({ repeat: { every: 'day', at: '09:00' } })), null);
  assert.equal(tasks.whoIsLeft(two({ builtAt: at, builtByPerson: true, builtFreesAll: true, builtWho: [] })), null);
});

test('an agent who left the project is not counted; with one left there is nothing to tell apart', () => {
  assert.deepEqual(tasks.whoIsLeft(two({ parts: [{ id: 1, who: 'rex' }, { id: 2, who: 'amy' }, { id: 3, who: 'gone' }] }), new Set(['rex', 'amy'])),
    { finished: [], left: ['rex', 'amy'] });
  assert.equal(tasks.whoIsLeft(two(), new Set(['rex'])), null);
  assert.deepEqual(tasks.whoIsLeft(two()), { finished: [], left: ['rex', 'amy'] }, 'control: with no list of members, both count');
});

test('a stale builtWho on a task whose mark was taken off does not count', () => {
  assert.deepEqual(tasks.whoIsLeft(two({ builtWho: ['rex'] })), { finished: [], left: ['rex', 'amy'] });
});

test('THE AGREEMENT: on a live task, still to finish is exactly who hasOpenWork says still has work', () => {
  const shapes = [
    two(),
    two({ builtAt: at, builtBy: 'rex', builtWho: ['rex'] }),
    two({ builtAt: at, builtWho: ['rex', 'amy'] }),
    two({ parts: [{ id: 1, who: 'rex', closedAt: at }, { id: 2, who: 'amy' }] }),
    two({ parts: [{ id: 1, who: 'rex', closedAt: at }, { id: 2, who: 'rex' }, { id: 3, who: 'amy', closedAt: at }] }),
    two({ builtWho: ['rex'] }),
  ];
  let bothArms = { left: 0, finished: 0 };
  for (const t of shapes) {
    const p = { id: 'catalogue', name: 'Catalogue', agents: ['rex', 'amy'], tasks: [t] };
    const w = tasks.whoIsLeft(t, new Set(p.agents));
    for (const n of w.left) { assert.equal(assigner.hasOpenWork(n, [p]), true, n + ' is shown as still to finish: ' + JSON.stringify(t)); bothArms.left += 1; }
    for (const n of w.finished) { assert.equal(assigner.hasOpenWork(n, [p]), false, n + ' is shown as finished: ' + JSON.stringify(t)); bothArms.finished += 1; }
  }
  assert.ok(bothArms.left > 0 && bothArms.finished > 0, 'control: both arms ran: ' + JSON.stringify(bothArms));
});

test('on hold it still says whose part is open: true, and the row says it is on hold; nobody is nudged about it', () => {
  const held = two({ onHold: true });
  assert.deepEqual(tasks.whoIsLeft(held), { finished: [], left: ['rex', 'amy'] });
  const p = { id: 'catalogue', name: 'Catalogue', agents: ['rex', 'amy'], tasks: [held] };
  assert.equal(tasks.isOnHold(held), true, 'premise: this is what a held task looks like');
  assert.deepEqual(nudge.openParts('rex', [p]), [], 'so the nudge never names anyone on it');
  assert.equal(assigner.hasOpenWork('rex', [p]), false, 'and the screen line is about the work, not about who is busy');
});

test('everyone counted has finished but a part with nobody on it, or a departed agent\'s, is open: no line, so it cannot read as all done', () => {
  const nobody = two({ parts: [{ id: 1, who: 'rex', closedAt: at }, { id: 2, who: 'amy', closedAt: at }, { id: 3 }] });
  assert.equal(tasks.whoIsLeft(nobody), null);
  const departed = two({ parts: [{ id: 1, who: 'rex', closedAt: at }, { id: 2, who: 'amy', closedAt: at }, { id: 3, who: 'gone' }] });
  assert.equal(tasks.whoIsLeft(departed, new Set(['rex', 'amy'])), null);
  const stillOwed = two({ parts: [{ id: 1, who: 'rex', closedAt: at }, { id: 2, who: 'amy' }, { id: 3 }] });
  assert.deepEqual(tasks.whoIsLeft(stillOwed), { finished: ['rex'], left: ['amy'] }, 'control: with someone left it says so');
});

test('the task page\'s read drops an agent who left, as the row\'s does: both are given stored names', () => {
  const projects = require('./projects');
  const t = two({ parts: [{ id: 1, who: 'rex' }, { id: 2, who: 'amy' }, { id: 3, who: 'gone' }] });
  const [joined] = projects.joinTaskClaims([t], [], ['rex', 'amy'], [], { name: 'Catalogue', id: 'catalogue' });
  assert.deepEqual(joined.whoIsLeft, { finished: [], left: ['rex', 'amy'] });
});

test('allTasks carries it on a several-agent row only, and drops an agent who left', () => {
  const p = {
    id: 'catalogue', name: 'Catalogue', agents: ['rex', 'amy'],
    tasks: [two(), { number: 8, sentence: 'one agent', who: 'rex', createdAt: at }, { number: 9, sentence: 'one left', createdAt: at, parts: [{ id: 1, who: 'rex' }, { id: 2, who: 'gone' }] }],
  };
  const rows = tasks.allTasks([p]);
  assert.deepEqual(rows.find((r) => r.number === 7).whoIsLeft, { finished: [], left: ['rex', 'amy'] });
  assert.equal('whoIsLeft' in rows.find((r) => r.number === 8), false);
  assert.equal('whoIsLeft' in rows.find((r) => r.number === 9), false);
});

test('the compact list says who is still to finish, and a one-agent row reads as before', () => {
  const body = {
    listState: 'open',
    tasks: [
      { number: 7, sentence: 'Spring catalogue', whoNames: ['rex', 'amy'], whoIsLeft: { finished: ['rex'], left: ['amy'] } },
      { number: 8, sentence: 'one agent', whoNames: ['rex'] },
    ],
  };
  const { lines } = tasklist.compactLines(body, 'open', 'catalogue');
  assert.equal(lines[0], '#7  open  rex, amy  Spring catalogue  (reported finished: rex; still to finish: amy)');
  assert.equal(lines[1], '#8  open  rex  one agent');
});

test('the --all, --mine and --stale lists say it too, beside a stale line', () => {
  const body = { all: true, listState: 'open', tasks: [
    { projectId: 'p1', number: 7, sentence: 'Spring catalogue', whoNames: ['rex', 'amy'], whoIsLeft: { finished: ['rex'], left: ['amy'] } },
    { projectId: 'p1', number: 8, sentence: 'one agent', whoNames: ['rex'] },
  ] };
  const { lines } = tasklist.acrossLines(body, 'open', { project: '' });
  assert.match(lines.find((l) => l.includes('Spring')), /\(reported finished: rex; still to finish: amy\)$/);
  assert.doesNotMatch(lines.find((l) => l.includes('one agent')), /still to finish/, 'control');
});

test('the nudge names the others still to finish, and only them', () => {
  const p = { id: 'catalogue', name: 'Catalogue', agents: ['rex', 'amy', 'lee'], tasks: [two({ parts: [{ id: 1, who: 'rex' }, { id: 2, who: 'amy' }, { id: 3, who: 'lee' }], builtAt: at, builtBy: 'lee', builtWho: ['lee'] })] };
  const [part] = nudge.openParts('rex', [p]);
  assert.deepEqual(part.alsoLeft, ['amy']);
  assert.match(nudge.nudgeText(part), /Each agent on it marks its own part; also still to finish: amy\./);
  const alone = { id: 'solo', name: 'Solo', agents: ['rex'], tasks: [{ number: 1, sentence: 'x', who: 'rex', createdAt: at }] };
  const [solo] = nudge.openParts('rex', [alone]);
  assert.equal('alsoLeft' in solo, false);
  assert.doesNotMatch(nudge.nudgeText(solo), /also still to finish/, 'control: one agent, no line');
});
