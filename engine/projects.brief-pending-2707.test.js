'use strict';

/**
 * #2707: a brief-less project shows one shared "brief pending" state so seven agents
 * staffed at once do not each ask "what is the goal?" and buzz the operator seven times.
 *
 * This file pins the DETECTION half - `briefIsPending` - which decides whether the shared
 * room note (#2707) fires. A project is pending when its folder has no brief at all, OR it
 * has the #2706 stub but the Goal was never filled in (still the placeholder). A project the
 * person gave a description to at creation is NOT pending, because its stub Goal was seeded
 * from that description: the operator already said what it is for. The server-route half
 * (posting the note) is covered in server.projects.test.js.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-briefpending-'));
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

test('a folder with no brief at all is pending', () => {
  const dir = folder('nobrief');
  assert.equal(projects.briefIsPending(dir), true);
});

test('a project created with NO description has an unfilled stub Goal and is pending', () => {
  reset();
  const dir = folder('nodesc');
  projects.create({ name: 'No goal yet', folder: dir });
  // The stub was written (#2706) but its Goal is the placeholder, so it is still pending.
  assert.ok(fs.existsSync(briefPathIn(dir)), 'the #2706 stub should have been written');
  assert.equal(projects.briefIsPending(dir), true);
});

test('a project created WITH a description has a seeded Goal and is NOT pending', () => {
  reset();
  const dir = folder('desc');
  projects.create({ name: 'Has a goal', folder: dir, description: 'Review and countersign the Q3 lease.' });
  assert.equal(projects.briefIsPending(dir), false);
});

test('a brief whose Goal placeholder has been replaced is NOT pending', () => {
  const dir = folder('filled');
  fs.writeFileSync(briefPathIn(dir), '# Filled\n\n## Goal\n\nDo the actual thing.\n\n## Done looks like\n\nIt is shipped.\n', 'utf8');
  assert.equal(projects.briefIsPending(dir), false);
});

test('CONTROL: detection is tied to the SAME placeholder briefStubContent writes', () => {
  // If the two drift, a stub written with no description would no longer read as pending.
  assert.ok(projects.briefStubContent({ name: 'X' }).includes(projects.BRIEF_GOAL_PLACEHOLDER),
    'the no-description stub does not contain the placeholder the detector looks for');
  assert.ok(!projects.briefStubContent({ name: 'X', description: 'a real goal' }).includes(projects.BRIEF_GOAL_PLACEHOLDER),
    'a described stub still carries the placeholder, so pending detection would false-positive');
});

test('the absolute-path guard rejects a non-absolute or empty path as NOT pending, never throws', () => {
  assert.equal(projects.briefIsPending('relative/path'), false);
  assert.equal(projects.briefIsPending(''), false);
  assert.equal(projects.briefIsPending(undefined), false);
});

test('FAIL-SAFE: a brief that EXISTS but cannot be READ is NOT pending (never contradicts a real brief)', () => {
  // The dangerous case: a real brief is there but a read error hides it. Only a genuinely
  // ABSENT brief (ENOENT) is pending; any other error (here EISDIR, a directory where the
  // file should be) must fail toward NOT pending, or the room note would say "no brief yet"
  // over a brief that is actually present. This arm exercises the readFileSync catch that the
  // absolute-path guard above never reaches.
  const dir = folder('unreadable');
  fs.mkdirSync(briefPathIn(dir), { recursive: true });   // BRIEF.md occupied -> readFileSync EISDIR
  assert.equal(projects.briefIsPending(dir), false, 'an unreadable brief was wrongly reported pending');
});

test('the shared note names the coordination the card asks for', () => {
  // One asks, the rest hold, one ping not seven - and it points at the shared BRIEF.md.
  assert.match(projects.BRIEF_PENDING_NOTE, /BRIEF\.md/);
  assert.match(projects.BRIEF_PENDING_NOTE, /not seven/i);
});
