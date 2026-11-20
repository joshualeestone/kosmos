'use strict';
/* kosmos#8832: a new agent could not tell its empty welcome project from an empty real project. Both rendered the same
   lines in its instructions ("No tasks set for this project yet. Add one with ..."), and an idle member of the welcome
   project was asked by the Assigner to draft tasks for its seeded goal, which is Kosmos's own sentence, not work.

   The welcome project now says what it is under its name, its empty list does not invite filling, and its goal is not
   put to anyone while it is still the seeded words. Each assertion has a control on a real project, so a change that
   described every project the same way (or skipped every goal) fails here. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-8832-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('../test-support/fleet');
const status = require('./status');
const projects = require('./projects');
const brief = require('./brief');
const commitments = require('./commitments');
const a = require('./assigner');
const { DELIVERY } = require('./chat');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* Seeded once for the file: the welcome project only seeds into an empty store that never had one. */
let home = null;
function welcome() {
  if (!home) home = projects.seedWelcomeHome({ roster: [] });
  assert.ok(home, 'fixture: the welcome project seeded');
  assert.ok(home.folder.startsWith(SANDBOX), 'fixture: its folder is in the sandbox');
  return home;
}

/* The lines under one project's name in a member's block. */
function linesFor(block, name) {
  const lines = block.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`- **${name}**:`));
  assert.ok(at >= 0, `fixture: ${name} is in the block`);
  const out = [];
  for (const l of lines.slice(at + 1)) { if (!l.startsWith('  ')) break; out.push(l); }
  return out.join('\n');
}

test('the welcome project says what it is and does not invite filling; control: a real empty project is unchanged', () => {
  const w = welcome();
  const real = projects.create({ name: 'Real empty 8832', made: { via: 'screen', by: null } });
  const block = projects.blockBody([w, real], 'newagent');
  const mine = linesFor(block, w.name);
  const theirs = linesFor(block, real.name);

  assert.ok(mine.includes(projects.STARTER_PROJECT_LINE), 'the welcome project does not say it is the starter project');
  assert.match(mine, /When your person gives you work here, add it with/);
  assert.doesNotMatch(mine, /No tasks set for this project yet\. Add one with/, 'the welcome project still invites a task');

  assert.ok(!theirs.includes(projects.STARTER_PROJECT_LINE), 'a real empty project was called the starter project');
  assert.match(theirs, /No tasks set for this project yet\. Add one with/, 'a real empty project lost its add line');
});

test('a renamed welcome project is the person\'s own, and a test project keeps its own line', () => {
  const w = welcome();
  const renamed = projects.blockBody([{ ...w, name: 'Q4 launch' }], 'newagent');
  assert.ok(!renamed.includes(projects.STARTER_PROJECT_LINE), 'a renamed welcome project is still called the starter project');
  assert.match(renamed, /No tasks set for this project yet\. Add one with/);

  // A project the person made and happened to call "Getting started" is theirs: only the seed's mark counts.
  const theirs = projects.blockBody([{ ...w, made: { via: 'screen', by: null } }], 'newagent');
  assert.ok(!theirs.includes(projects.STARTER_PROJECT_LINE), 'a person-made "Getting started" was called the starter project');
  assert.equal(projects.isStarter({ ...w, testOnly: true }), false, 'a test project still counts as the starter project');

  const tested = linesFor(projects.blockBody([{ ...w, testOnly: true }], 'newagent'), w.name);
  assert.ok(tested.includes('A test project: do only what you are asked here.'), 'the test line is gone');
  assert.ok(!tested.includes(projects.STARTER_PROJECT_LINE), 'a test project carries both lines');
});

test('the seeded goal is not put to an idle member; control: a goal the person wrote there is, and so is a real project\'s', () => {
  const w = welcome();
  const seededGoal = brief.readGoal(w.folder);
  assert.equal(seededGoal, projects.WELCOME_DESCRIPTION, 'fixture: the seeded brief\'s goal is the welcome sentence');

  const board = fleet.install([fleet.agent('starternew', { state: 'idle' })]);
  try {
    const card = board.agents.find((c) => (c.sessionName || '').startsWith('starternew'));
    projects.addAgent(w.id, card.sessionName, board.agents);
    const run = (readGoal) => {
      const asked = [];
      const o = {
        readSetting: () => ({ on: true }), readRoster: () => status.snapshot().agents,
        readRecords: () => projects.readAll().filter((p) => p.id === w.id),
        readCommitment: (s) => commitments.read(s), readGoal,
        give: () => ({ ok: true }), ask: (session) => { asked.push(session); return { state: DELIVERY.PLACED }; }, DELIVERY,
      };
      const T0 = Date.now();
      const first = a.tick({ prev: undefined, now: T0, ...o });
      a.tick({ prev: first.next, now: T0 + a.IDLE_MS, ...o });
      return asked;
    };
    // The real brief on disk, as the board reads it.
    assert.deepEqual(run((p) => brief.readGoal(p.folder)), [], 'an idle member was asked to draft tasks for the seeded goal');
    // Control: the person wrote a goal there, so it is real work.
    assert.deepEqual(run(() => 'plan the spring fundraiser'), [card.sessionName], 'a goal the person wrote was not asked');
  } finally { board.restore(); }

  // Control: the same seeded words on a project that is not the starter project are asked as usual.
  assert.equal(projects.isStarterGoal({ ...w, name: 'Q4 launch' }, seededGoal), false);
  assert.equal(projects.isStarterGoal(w, seededGoal), true);
  assert.equal(projects.isStarterGoal(w, '  ' + seededGoal.replace(/ /g, '\n') + ' '), true, 'spacing changed the match');
});
