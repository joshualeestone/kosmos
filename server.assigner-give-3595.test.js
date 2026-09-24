'use strict';
/* #3595 phase 2: the Assigner's REAL write path, server.givePart in its assigner mode, the same
 * function the part-assign route calls. The runner's interval is inert under test (live execution
 * is off), so this drives the write the runner would make, against real projects, tasks and board
 * cards:
 *  - an agent that cannot be reached is not left on a task it was never told about,
 *  - a part somebody took since the Assigner's read is never moved off them,
 *  - the Assigner's writes are its own provenance and never charge the agents' shared valve.
 *
 *   node --test server.assigner-give-3595.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asg-give-'));
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
function setup(names) {
  const board = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle' })));
  const p = projects.create({ name: 'Give Test ' + (++seq) });
  for (const n of names) projects.addAgent(p.id, n, board.agents);
  const t = tasks.create(p.id, { sentence: 'write the release notes', made: { via: 'screen' } });
  const n = t.task ? t.task.number : t.number;
  const partOf = () => tasks.partsOf(tasks.byNumber(projects.readAll().find((x) => x.id === p.id), n))[0];
  return { board, pid: p.id, n, partOf };
}

test('an agent that cannot be reached is not left on the task (the give is taken back)', () => {
  const s = setup(['givegone']);
  try {
    const before = tasks.processPartWrites().count;
    // An empty roster: the pane line cannot reach anyone, so delivery is COULD_NOT.
    const g = givePart(s.pid, s.n, 1, 'givegone', { assigner: true, roster: [] });
    assert.equal(g.ok, false, 'a give nobody was told about counted as given');
    assert.equal(g.heard && g.heard.state, chat.DELIVERY.COULD_NOT, 'fixture: the pane line did not fail as arranged');
    assert.equal(s.partOf().who, null, 'the agent was left on a task it was never told about');
    assert.equal(tasks.processPartWrites().count, before, 'the Assigner charged the agents\' parts valve');
  } finally { s.board.restore(); }
});

test('a part somebody took since the read is never moved off them', () => {
  const s = setup(['giveme', 'giveperson']);
  try {
    // A person gives the part to giveperson between the Assigner's read and its write.
    const person = givePart(s.pid, s.n, 1, 'giveperson', { screen: true, roster: s.board.agents });
    assert.equal(person.ok, true, 'fixture: the screen give failed');
    const g = givePart(s.pid, s.n, 1, 'giveme', { assigner: true, roster: s.board.agents });
    assert.equal(g.ok, false, 'the Assigner took a part off a person');
    assert.match(g.because, /already on that part/);
    assert.equal(s.partOf().who, 'giveperson');
  } finally { s.board.restore(); }
});

/* The pane is this path's external boundary, and a real PLACED needs the whole tmux probe script
   chat.test.js owns, so these arms stub chat.deliver for the one call and put it back. The
   unreachable arm above uses the REAL deliver and its real refusal. */
function withDelivery(state, fn) {
  const real = chat.deliver;
  chat.deliver = () => ({ state, because: null });
  try { return fn(); } finally { chat.deliver = real; }
}

for (const state of [chat.DELIVERY.PLACED, chat.DELIVERY.UNCONFIRMED]) {
  test('a give whose pane line is ' + state + ' is kept, marked as the Assigner\'s, and charges no agent budget', () => {
    const s = setup(['givehere' + state]);
    try {
      const before = tasks.processPartWrites().count;
      const g = withDelivery(state, () => givePart(s.pid, s.n, 1, 'givehere' + state, { assigner: true, roster: s.board.agents }));
      assert.equal(g.ok, true, 'a delivered give was refused: ' + g.because);
      assert.equal(g.heard.state, state);
      const part = s.partOf();
      assert.equal(part.who, 'givehere' + state);
      assert.equal(part.movedVia, 'assigner', 'the write is not marked as the Assigner\'s');
      assert.equal(tasks.processPartWrites().count, before, 'the Assigner charged the agents\' parts valve');
    } finally { s.board.restore(); }
  });
}

test('control: a process (agent) give still charges the parts valve', () => {
  const s = setup(['giveagent']);
  try {
    const before = tasks.processPartWrites().count;
    givePart(s.pid, s.n, 1, 'giveagent', { screen: false, roster: s.board.agents });
    assert.equal(tasks.processPartWrites().count, before + 1, 'the valve count cannot see a process write, so the arms above prove nothing');
  } finally { s.board.restore(); }
});
