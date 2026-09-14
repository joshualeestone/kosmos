'use strict';

/**
 * #2706: staffing a project scaffolds a short brief stub in the project folder.
 *
 * The card's root problem, measured by the Kosmos-Inside-Out dogfood: creating a
 * project and staffing agents onto it left the folder EMPTY - no brief, no goal, no
 * definition of done - so agents landed with nothing to read and defaulted to talking
 * (the "wall of questions -> Kosmos shut the room" episode). The fix drops a two-field
 * brief stub (Goal / Done-looks-like) in the folder on creation, so the operator and
 * the agents share one source of truth instead of a chat message that scrolls away.
 *
 * The load-bearing rule under test is NO-CLOBBER: Kosmos adopts existing folders, so a
 * folder that already holds the person's own BRIEF.md must survive untouched. The
 * write is also best-effort: a folder it cannot write to is not a reason to fail the
 * creation the person asked for.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-briefstub-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');

let seq = 0;
function folder(sub) {
  seq += 1;
  const dir = path.join(SANDBOX, `folder-${seq}${sub ? '-' + sub : ''}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function reset() {
  try { projects.writeAll([]); } catch { /* first run: nothing to clear */ }
}
function briefPathIn(dir) { return path.join(dir, projects.BRIEF_STUB_FILENAME); }

test('creating a project drops a BRIEF.md with Goal and Done-looks-like in the folder', () => {
  reset();
  const dir = folder('plain');
  projects.create({ name: 'Henderson lease', folder: dir });
  const brief = briefPathIn(dir);
  assert.ok(fs.existsSync(brief), 'no brief stub was written into the project folder');
  const text = fs.readFileSync(brief, 'utf8');
  assert.match(text, /^# Henderson lease/m, 'the brief does not title itself with the project name');
  assert.match(text, /^## Goal$/m, 'the brief has no Goal section');
  assert.match(text, /^## Done looks like$/m, 'the brief has no Done-looks-like section');
});

test('the description typed on the create form seeds the Goal (it does not scroll away)', () => {
  reset();
  const dir = folder('desc');
  const desc = 'Get the Q3 lease reviewed and countersigned.';
  projects.create({ name: 'Q3 lease', folder: dir, description: desc });
  const text = fs.readFileSync(briefPathIn(dir), 'utf8');
  assert.ok(text.includes(desc), 'the create-form description did not land in the Goal');
});

test('CONTROL: with no description the Goal carries a prompt, not a blank and not the description text', () => {
  reset();
  const dir = folder('nodesc');
  projects.create({ name: 'Bare', folder: dir });
  const text = fs.readFileSync(briefPathIn(dir), 'utf8');
  // The Goal section is non-empty (a prompt to fill in), so an agent never lands on a
  // blank Goal; and it must NOT accidentally read like a real filled-in goal.
  assert.match(text, /## Goal\s+_[^_]*Replace this line\._/, 'the empty-description Goal is not the fill-in prompt');
  // Discriminates from the seeded case: the prompt must differ from any real description.
  assert.ok(!text.includes('Get the Q3 lease'), 'control leaked the other test\'s description');
});

test('NO-CLOBBER: a folder that already holds a BRIEF.md is left completely untouched', () => {
  reset();
  const dir = folder('adopted');
  const mine = '# My own brief\n\nThis is the real thing, do not touch it.\n';
  fs.writeFileSync(briefPathIn(dir), mine, 'utf8');
  const before = fs.statSync(briefPathIn(dir)).mtimeMs;
  projects.create({ name: 'Adopted', folder: dir, description: 'a description that must NOT overwrite the brief' });
  assert.equal(fs.readFileSync(briefPathIn(dir), 'utf8'), mine, 'creation overwrote the person\'s own BRIEF.md');
  assert.equal(fs.statSync(briefPathIn(dir)).mtimeMs, before, 'the existing brief was rewritten (mtime changed)');
});

test('seedBriefStub reports true when it writes and false when it declines (no-clobber)', () => {
  const dir = folder('return');
  assert.equal(projects.seedBriefStub(dir, { name: 'X' }), true, 'a fresh folder should have been written');
  assert.equal(projects.seedBriefStub(dir, { name: 'X' }), false, 'a second call must not clobber, and must say so');
});

test('BEST-EFFORT: a folder the stub cannot be written into still creates the project', () => {
  reset();
  const dir = folder('unwritable');
  // BRIEF.md already exists AS A DIRECTORY, so the `wx` file write throws (EEXIST/EISDIR).
  // Portable stand-in for any write failure (read-only folder, races): the point is that
  // seedBriefStub swallows it and create still returns the project it just recorded.
  fs.mkdirSync(briefPathIn(dir), { recursive: true });
  let project = null;
  assert.doesNotThrow(() => { project = projects.create({ name: 'Resilient', folder: dir }); },
    'a failed brief write took down the whole creation');
  assert.ok(project && project.id, 'the project record was not returned despite a successful create');
  assert.ok(fs.statSync(briefPathIn(dir)).isDirectory(), 'the pre-existing BRIEF.md path was disturbed');
});

test('the filename is BRIEF.md at the folder root', () => {
  assert.equal(projects.BRIEF_STUB_FILENAME, 'BRIEF.md');
});
