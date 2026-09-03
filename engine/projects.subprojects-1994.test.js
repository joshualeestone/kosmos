'use strict';

/**
 * Sub-projects: a project can declare a parent, for organization (#1994).
 *
 * The card's four settled questions, each an arm here:
 *   1. Depth  -- a single `parent` field; a chain is allowed, a cycle is not.
 *   2. Parent deletion -- REFUSED while children exist (re-parent first).
 *   3. Who reads parent -- display only; describe exposes `parent` + the
 *      resolved `parentName`, and nothing inherits through it.
 *   4. Cycle attempt REFUSED; a missing/dangling parent RENDERS un-grouped
 *      (parentName null), it never vanishes.
 *
 * ⭐ The load-bearing correction from the build: a project's id is STABLE
 * across a rename (engine/projects.js: rename changes the name, never the id),
 * so a parent stored by id survives a parent rename. The rename arm proves it,
 * because my own earlier design wrongly assumed a rename would orphan the link.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-subprojects-'));
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
function mk(name) {
  // A real folder the record can point at; each unique so create never refuses
  // a duplicate. Folders live under the (temp) store root, which create allows.
  seq += 1;
  const dir = path.join(SANDBOX, `folder-${seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return projects.create({ name, folder: dir });
}

// Every test reads a fresh store: the module persists to the sandbox, so wipe
// the projects file between arms to keep them independent.
function reset() {
  try { projects.writeAll([]); } catch { /* first run: nothing to clear */ }
}

test('a new project starts ungrouped (parent null), and describe says so', () => {
  reset();
  const a = mk('Alpha');
  assert.equal(a.parent, null, 'the stored record defaults parent to null');
  const seen = projects.get(a.id, null);
  assert.equal(seen.parent, null);
  assert.equal(seen.parentName, null);
});

test('edit({parent}) groups a child; describe exposes parent id and the parent name', () => {
  reset();
  const parent = mk('Parent');
  const child = mk('Child');
  projects.edit(child.id, { parent: parent.id });
  const seen = projects.get(child.id, null);
  assert.equal(seen.parent, parent.id, 'the child stores the parent id');
  assert.equal(seen.parentName, 'Parent', 'and describe resolves the name for the board');
});

test('edit({parent:null}) and {parent:""} both un-group', () => {
  reset();
  const parent = mk('Parent');
  const child = mk('Child');
  projects.edit(child.id, { parent: parent.id });
  projects.edit(child.id, { parent: null });
  assert.equal(projects.get(child.id, null).parent, null);
  projects.edit(child.id, { parent: parent.id });
  projects.edit(child.id, { parent: '' });
  assert.equal(projects.get(child.id, null).parent, null, 'empty string un-groups too');
});

test('a project cannot be its own sub-project', () => {
  reset();
  const a = mk('Alpha');
  assert.throws(() => projects.edit(a.id, { parent: a.id }), /own sub-project/);
  // and the store is untouched -- the refusal happened before any write.
  assert.equal(projects.get(a.id, null).parent, null);
});

test('a parent that does not exist is refused', () => {
  reset();
  const a = mk('Alpha');
  assert.throws(() => projects.edit(a.id, { parent: 'no-such-project-id' }), /no project to group this one under/);
});

test('a direct cycle is refused (A under B, then B under A)', () => {
  reset();
  const a = mk('Alpha');
  const b = mk('Beta');
  projects.edit(b.id, { parent: a.id }); // B under A
  assert.throws(() => projects.edit(a.id, { parent: b.id }), /underneath one of its own sub-projects/);
});

test('a deeper cycle is refused (A<-B<-C, then A under C)', () => {
  reset();
  const a = mk('Alpha');
  const b = mk('Beta');
  const c = mk('Gamma');
  projects.edit(b.id, { parent: a.id }); // B under A
  projects.edit(c.id, { parent: b.id }); // C under B  => C's chain is C->B->A
  assert.throws(() => projects.edit(a.id, { parent: c.id }), /underneath one of its own sub-projects/);
  // A legal deep re-parent still works: a fresh D under C (no loop).
  const d = mk('Delta');
  projects.edit(d.id, { parent: c.id });
  assert.equal(projects.get(d.id, null).parent, c.id);
});

test('deleting a parent that still has sub-projects is refused, and the message names them', () => {
  reset();
  const parent = mk('Parent');
  const c1 = mk('One');
  const c2 = mk('Two');
  projects.edit(c1.id, { parent: parent.id });
  projects.edit(c2.id, { parent: parent.id });
  assert.throws(() => projects.remove(parent.id), (err) => {
    assert.match(err.message, /sub-projects/);
    assert.match(err.message, /One/);
    assert.match(err.message, /Two/);
    assert.equal(err.status, 409, 'a 409, not a 404 -- the project exists');
    return true;
  });
  // The parent is still there; the refusal did not half-delete it.
  assert.ok(projects.get(parent.id, null));
});

test('after re-parenting the children away, the parent can be deleted', () => {
  reset();
  const parent = mk('Parent');
  const child = mk('Child');
  projects.edit(child.id, { parent: parent.id });
  projects.edit(child.id, { parent: null }); // re-parent away (un-group)
  const gone = projects.remove(parent.id);
  assert.equal(gone.id, parent.id);
  assert.equal(projects.get(parent.id, null), null);
});

test('renaming a parent keeps the child grouped -- the id is stable across a rename', () => {
  reset();
  const parent = mk('Parent');
  const child = mk('Child');
  projects.edit(child.id, { parent: parent.id });
  projects.rename(parent.id, 'Parent Renamed');
  const seen = projects.get(child.id, null);
  assert.equal(seen.parent, parent.id, 'the stored link is unchanged');
  assert.equal(seen.parentName, 'Parent Renamed', 'and it now resolves to the new name');
});

test('parentArchived is published so the board can decide how to render a hidden group', () => {
  reset();
  const parent = mk('Parent');
  const child = mk('Child');
  projects.edit(child.id, { parent: parent.id });
  // A live parent reports archived false.
  assert.equal(projects.get(child.id, null).parentArchived, false);
  // Archiving a parent that still has children is allowed; the child keeps
  // naming it and now reports parentArchived true, so the board can hide or
  // badge the group rather than showing a child under an invisible parent.
  projects.edit(parent.id, { archived: true });
  const seen = projects.get(child.id, null);
  assert.equal(seen.parentName, 'Parent', 'the name still resolves');
  assert.equal(seen.parentArchived, true, 'and the board is told the group is archived');
  // A project with no parent has nothing to be archived: null, not false.
  assert.equal(projects.get(parent.id, null).parentArchived, null);
});

test('a dangling parent id renders the child at top level (parentName null), never vanishing', () => {
  reset();
  const child = mk('Child');
  // Simulate a hand-edited store: a parent id pointing at no project. (The
  // normal path refuses this; describe must still degrade gracefully.)
  const all = projects.readAll();
  const at = all.findIndex((p) => p.id === child.id);
  all[at].parent = 'ghost-parent-id';
  projects.writeAll(all);
  const seen = projects.get(child.id, null);
  assert.equal(seen.parent, 'ghost-parent-id', 'the raw id is still carried');
  assert.equal(seen.parentName, null, 'but it resolves to no name, so the board groups it nowhere');
});

test('the cycle walk terminates over a store that ALREADY holds a loop (the seen-set is load-bearing)', () => {
  reset();
  const a = mk('Alpha');
  const b = mk('Beta');
  const c = mk('Gamma');
  // Hand-build a loop the engine would never allow: A<->B. Without the seen-set
  // in cleanParent, walking either node's chain runs A->B->A->B... forever.
  const all = projects.readAll();
  all.find((p) => p.id === a.id).parent = b.id;
  all.find((p) => p.id === b.id).parent = a.id;
  projects.writeAll(all);
  // Parenting C under A does not close a cycle THROUGH C (C is not in the loop),
  // so it must COMPLETE rather than hang, and succeed. If this test hangs, the
  // seen-set was dropped.
  projects.edit(c.id, { parent: a.id });
  assert.equal(projects.get(c.id, null).parent, a.id, 'C is grouped under A and the walk terminated');
  // And a re-parent that WOULD close a loop through the child is still refused,
  // terminating the same way: B under A reaches B (the child) up A's chain.
  assert.throws(() => projects.edit(b.id, { parent: a.id }), /underneath one of its own sub-projects/);
});

test('a non-string parent is refused as a type error, not silently coerced', () => {
  reset();
  const a = mk('Alpha');
  // String([]) is '' (would silently un-group); String({})/String(123) become
  // literal ids. All are refused as a type error instead.
  assert.throws(() => projects.edit(a.id, { parent: [] }), /a project id, or null/);
  assert.throws(() => projects.edit(a.id, { parent: {} }), /a project id, or null/);
  assert.throws(() => projects.edit(a.id, { parent: 123 }), /a project id, or null/);
  assert.equal(projects.get(a.id, null).parent, null, 'and the store is untouched');
});

test('edit applies name and parent atomically: an invalid parent refuses the whole save', () => {
  reset();
  const a = mk('Alpha');
  const b = mk('Beta');
  projects.edit(b.id, { parent: a.id }); // B under A
  // Try to rename A AND put it under B in one edit -- the cycle must refuse the
  // whole thing, leaving the name unchanged (apply whole or not at all).
  assert.throws(() => projects.edit(a.id, { name: 'Alpha Two', parent: b.id }), /underneath one of its own sub-projects/);
  const seen = projects.get(a.id, null);
  assert.equal(seen.name, 'Alpha', 'the name did not move because the parent was invalid');
  assert.equal(seen.parent, null);
});
