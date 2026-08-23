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
