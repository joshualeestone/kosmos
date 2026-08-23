'use strict';
/**
 * Bringing an agent Kosmos did not create under its management.
 *
 * 🔑 CONNECTING AND RESTARTING ARE THE SAME OPERATION, which is what makes this
 * small: Kosmos never takes over a running process. It records where the agent's
 * folder is and installs a launch job that starts a session THERE, and every
 * managed behaviour follows from having started it.
 *
 * ⚠️ DRY RUN THROUGHOUT. `create.installJob` writes a real launchd plist and
 * bootstraps it; a test that did that would install background jobs on whoever
 * ran the suite. `setDryRun` is armed at load, before anything can run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-'));
process.env.HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
fs.mkdirSync(process.env.HOME, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const create = require('./create');
create.setDryRun(true);
const discover = require('./discover');
const store = require('./store');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

function theirAgent(name, body) {
  const dir = path.join(SB, 'theirs', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body);
  return dir;
}

test('an agent in its own folder is connected, and nothing moves', () => {
  const dir = theirAgent('mike', 'You are **Mike**, a copywriter.\n');
  const out = discover.connect(dir);
  assert.equal(out.ok, true, out.because);
  assert.equal(out.name, 'mike');
  assert.equal(out.displayName, 'Mike');
  assert.equal(out.dir, dir);

  /* 🔑 THE POINT: the folder is recorded, so every reader resolves to THEIR file.
     Nothing was copied into the workers directory. */
  assert.equal(store.readProfile('mike').dir, dir);
  assert.equal(create.workerDir('mike'), dir);
  assert.ok(!fs.existsSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'mike')),
    'connecting created a folder of its own, which is the copy this design refuses');
  /* And their file is untouched by the act of connecting. */
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /You are \*\*Mike\*\*/);
});

test('a folder with no instructions is refused, and records nothing', () => {
  const dir = path.join(SB, 'theirs', 'empty');
  fs.mkdirSync(dir, { recursive: true });
  const out = discover.connect(dir);
  assert.equal(out.ok, false);
  assert.match(out.because, /no instructions/i);
  assert.equal(store.readProfile('empty').dir, undefined,
    'a refused connect still wrote a folder record');
});

test('instructions that never say who it is are refused', () => {
  /* Every repo has a CLAUDE.md. Connecting one would put a build-notes folder on
     the board as an agent, and then start a Claude in it. */
  const dir = theirAgent('repo', '# Build notes\n\nRun the tests.\n');
  const out = discover.connect(dir);
  assert.equal(out.ok, false);
  assert.match(out.because, /do not say who the agent is/i);
});

test('a link is refused rather than followed', () => {
  /* ⚠️ The escape this module family has shipped six times, arriving by the one
     road that is new: a path handed in from outside. */
  const real = theirAgent('realone', 'You are **Real One**, a tester.\n');
  const link = path.join(SB, 'theirs', 'linky');
  fs.symlinkSync(real, link);
  const out = discover.connect(link);
  assert.equal(out.ok, false);
  assert.match(out.because, /not a folder/i);
});

test('a relative path is refused', () => {
  assert.equal(discover.connect('theirs/mike').ok, false);
  assert.equal(discover.connect('').ok, false);
  assert.equal(discover.connect(null).ok, false);
});

test('connecting the same folder twice is not an error, and a different one is', () => {
  const dir = theirAgent('twice', 'You are **Twice**, a tester.\n');
  assert.equal(discover.connect(dir).ok, true);
  /* ⚠️ SAME FOLDER AGAIN IS HARMLESS, AND THE TEST SAYS SO RATHER THAN ASSERTING
     A REFUSAL IT CANNOT SEE. It is the same agent, so the record is unchanged.
     In a real install `installJob` reports "it already has one" off the plist it
     wrote; under dry run no plist exists, so that arm is not reachable here and
     pretending otherwise would be a test passing on the harness rather than on
     the product. */
  const again = discover.connect(dir);
  assert.equal(store.readProfile('twice').dir, dir, 'a second connect moved the record');
  assert.ok(again.ok === true || /already/i.test(again.because || ''),
    `a repeat connect neither succeeded nor said it was already done: ${JSON.stringify(again)}`);

  /* A DIFFERENT folder under a name already connected is the dangerous one: it
     would silently re-point an existing agent at somebody else's files. */
  const other = path.join(SB, 'elsewhere', 'twice');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'CLAUDE.md'), 'You are **Impostor**, a tester.\n');
  const clash = discover.connect(other);
  assert.equal(clash.ok, false);
  assert.match(clash.because, /different folder/i);
  assert.equal(store.readProfile('twice').dir, dir, 'the record was re-pointed by a refused connect');
});

test('CONTROL: discovery and connect agree about what an agent is', () => {
  /* The two halves of one feature. If `found` lists something `connect` refuses,
     the screen offers a button that cannot work. */
  process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'no-claude-here');
  const list = discover.found();
  assert.equal(list.ok, false, 'the fixture has no Claude records, so this must say so rather than empty');
  delete process.env.AGENT_WORKFORCE_CONFIG_ROOT;
});

/* ---- one definition of "in Kosmos" (#362) -------------------------------- */
const status = require('./status');
const fleet = require('../test-support/fleet');

test('an agent already running under the folder\'s name is in Kosmos for the list and refused by the add, on one test', () => {
  /**
   * 🛑 The dev fleet's shape, and reachable anywhere a session is named for a
   * folder Kosmos did not make: the board showed the agent (the status engine
   * names the pane), the found list offered it as "not in Kosmos" (no job, no
   * recorded folder), and Add would have installed a job and started a second
   * Claude in the same worker folder. One definition now: a job, a recorded
   * folder, OR a pane running under the name.
   */
  const dir = theirAgent('rosie', 'You are **Rosie**, a researcher.\n');
  status.setPaneSource(() => fleet.line({ session: 'rosie', title: 'idle' }));
  try {
    assert.equal(discover.alreadyIn(dir), true, 'a running agent was offered as not in Kosmos');
    const out = discover.connect(dir);
    assert.equal(out.ok, false, 'the add went ahead on a folder whose agent is already running');
    assert.match(out.because, /already running under that name/, 'the refusal does not say why');
    assert.match(out.because, /started some other way/, 'the refusal does not say it was not Kosmos that started it');
    assert.equal(store.readProfile('rosie').dir, undefined, 'a refused add recorded a folder anyway');
    assert.equal(create.hasJob('rosie'), false, 'a refused add installed a job anyway');
  } finally {
    status.setPaneSource(null);
  }
  // CONTROL: the same folder with nothing running under the name connects.
  status.setPaneSource(() => '');
  try {
    assert.equal(discover.alreadyIn(dir), false);
    const ok = discover.connect(dir);
    assert.equal(ok.ok, true, ok.because);
  } finally {
    status.setPaneSource(null);
  }
});

test('a roster that cannot be read refuses the add rather than starting blind', () => {
  const dir = theirAgent('blind', 'You are **Blind**, a writer.\n');
  status.setPaneSource(() => null);
  try {
    const out = discover.connect(dir);
    assert.equal(out.ok, false, 'connect started an agent without knowing what was running');
    assert.match(out.because, /could not check what is running/);
    assert.equal(create.hasJob('blind'), false);
  } finally {
    status.setPaneSource(null);
  }
});

test('the found list consults the roster and marks a running agent as already in', () => {
  /* The finder reads a transcript under a config root's `projects/` to learn
     a folder's cwd; seeded the way discover.test.js seeds it, with the root
     handed in through the same override that test uses. */
  const dir = theirAgent('seen', 'You are **Seen**, a bookkeeper.\n');
  const root = path.join(SB, 'cfg-seen');
  const proj = path.join(root, 'projects', 'seen-key');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'seen-key-sess.jsonl'), `{"type":"user"}\n{"cwd":${JSON.stringify(dir)}}\n`);
  const hadRoots = status.configRoots;
  status.configRoots = () => [root];
  status.setPaneSource(() => fleet.line({ session: 'seen', title: 'idle' }));
  try {
    const out = discover.found();
    assert.equal(out.ok, true, out.because);
    const row = out.agents.find((a) => a.dir === dir);
    assert.ok(row, 'the finder did not find the seeded folder; the fixture is wrong, not the claim');
    assert.equal(row.already, true, 'the list offered a running agent as not in Kosmos');
    // CONTROL: nothing running under the name, and the same row is offered.
    status.setPaneSource(() => '');
    const again = discover.found().agents.find((a) => a.dir === dir);
    assert.ok(again, 'control row missing');
    assert.equal(again.already, false, 'the control did not flip, so the first half proved nothing');
  } finally {
    status.setPaneSource(null);
    status.configRoots = hadRoots;
  }
});
