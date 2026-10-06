'use strict';
/* #5382: the Assigner's failover through its REAL write path, server.givePart with `from` (the rate-limited agent the
 * part is taken from). Same harness as server.assigner-give-3595.test.js: real projects, tasks and board cards, the
 * runner's interval inert under test.
 *  - a move is refused unless the part is still on `from`,
 *  - a move whose pane line reaches nobody goes BACK to `from`, not to nobody,
 *  - and if `from` has left the project since, it goes to nobody rather than staying on an agent never told.
 *
 *   node --test server.assigner-failover-5382.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asg-failover-'));
process.env.HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const chat = require('./engine/chat');
const { givePart } = require('./server');

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
/* Two agents on a fresh project; the task's one part is given to `holder` from the screen. */
function setup(holder, receiver) {
  const board = fleet.install([fleet.agent(holder, { state: 'rate_limited' }), fleet.agent(receiver, { state: 'idle' })]);
  const p = projects.create({ name: 'Failover Give ' + (++seq) });
  for (const n of [holder, receiver]) projects.addAgent(p.id, n, board.agents);
  const t = tasks.create(p.id, { sentence: 'write the release notes', made: { via: 'screen' } });
  const n = t.task ? t.task.number : t.number;
  const partOf = () => tasks.partsOf(tasks.byNumber(projects.readAll().find((x) => x.id === p.id), n))[0];
  const given = tasks.assignPart(p.id, n, 1, holder, { via: 'screen' });
  assert.ok(given.ok, 'fixture: the screen give failed');
  return { board, pid: p.id, n, partOf };
}

function withDelivery(state, fn) {
  const real = chat.deliver;
  chat.deliver = () => ({ state, because: null });
  try { return fn(); } finally { chat.deliver = real; }
}

test('a move whose pane line is PLACED is kept on the receiver, marked as the Assigner\'s', () => {
  const s = setup('fohold1', 'forecv1');
  try {
    const g = withDelivery(chat.DELIVERY.PLACED, () => givePart(s.pid, s.n, 1, 'forecv1', { assigner: true, roster: s.board.agents, from: 'fohold1' }));
    assert.equal(g.ok, true, 'a delivered move was refused: ' + g.because);
    assert.equal(s.partOf().who, 'forecv1');
    assert.equal(s.partOf().movedVia, 'assigner');
  } finally { s.board.restore(); }
});

test('a move is refused unless the part is still on `from`', () => {
  const s = setup('fohold2', 'forecv2');
  try {
    const g = withDelivery(chat.DELIVERY.PLACED, () => givePart(s.pid, s.n, 1, 'forecv2', { assigner: true, roster: s.board.agents, from: 'somebody-else' }));
    assert.equal(g.ok, false, 'moved a part off an agent it was not on');
    assert.equal(s.partOf().who, 'fohold2');
  } finally { s.board.restore(); }
});

test('a move whose pane line reaches nobody goes back to the agent it was taken from', () => {
  const s = setup('fohold3', 'forecv3');
  try {
    // An empty roster: the pane line cannot reach anyone, so delivery is COULD_NOT (the real deliver).
    const g = givePart(s.pid, s.n, 1, 'forecv3', { assigner: true, roster: [], from: 'fohold3' });
    assert.equal(g.ok, false);
    assert.equal(g.heard && g.heard.state, chat.DELIVERY.COULD_NOT, 'fixture: the pane line did not fail as arranged');
    assert.equal(s.partOf().who, 'fohold3', 'the part did not go back to the agent it was taken from');
  } finally { s.board.restore(); }
});

test('if the agent it was taken from has left the project, an unreached move goes to nobody, not the receiver', () => {
  const s = setup('fohold4', 'forecv4');
  try {
    projects.removeAgent(s.pid, 'fohold4', { via: 'screen' });
    assert.equal(s.partOf().who, 'fohold4', 'fixture: removal cleared the part, so this arm tests nothing');
    const g = givePart(s.pid, s.n, 1, 'forecv4', { assigner: true, roster: [], from: 'fohold4' });
    assert.equal(g.ok, false);
    assert.equal(s.partOf().who, null, 'the part stayed on an agent that was never told, or went back to one off the project');
  } finally { s.board.restore(); }
});

/* The receiver's pane line: captured from the deliver the real heardBy calls. */
function capturing(fn) {
  const real = chat.deliver;
  const lines = [];
  chat.deliver = (who, line) => { lines.push({ who, line }); return { state: chat.DELIVERY.PLACED, because: null }; };
  try { return { out: fn(), lines }; } finally { chat.deliver = real; }
}

test('a failover move tells the receiver where the part came from; an ordinary give does not', () => {
  const s = setup('fohold5', 'forecv5');
  try {
    const f = capturing(() => givePart(s.pid, s.n, 1, 'forecv5', { assigner: true, roster: s.board.agents, from: 'fohold5' }));
    assert.equal(f.out.ok, true, 'fixture: the move was refused: ' + f.out.because);
    assert.equal(f.lines.length, 1, 'fixture: the receiver was not paged exactly once');
    assert.equal(f.lines[0].who, 'forecv5');
    assert.ok(f.lines[0].line.includes('It was moved to you from fohold5'), f.lines[0].line);
    // Control: an ordinary Assigner give (no `from`) of a free part on another task of the same project.
    const t2 = tasks.create(s.pid, { sentence: 'write the changelog', made: { via: 'screen' } });
    const n2 = t2.task ? t2.task.number : t2.number;
    const g = capturing(() => givePart(s.pid, n2, 1, 'forecv5', { assigner: true, roster: s.board.agents }));
    assert.equal(g.out.ok, true, 'fixture: the ordinary give was refused: ' + g.out.because);
    assert.equal(g.lines.length, 1, 'fixture: the ordinary give paged nobody, so this arm tests nothing');
    assert.equal(g.lines[0].line.includes('It was moved to you from'), false, 'an ordinary give said it was moved: ' + g.lines[0].line);
  } finally { s.board.restore(); }
});
