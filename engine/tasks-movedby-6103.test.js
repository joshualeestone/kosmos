'use strict';

/**
 * #6103: a part records WHICH agent moved it (`movedBy`), beside how (`movedVia`) and when (`movedAt`), when a
 * process caller was named, as `addedBy` is for an add. Data only: nothing on the page reads it yet.
 *
 *   node --test engine/tasks-movedby-6103.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-movedby-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-movedby-data-'));
process.on('exit', () => {
  for (const d of [process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_DATA]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
const projects = require('./projects');
const tasks = require('./tasks');
const taskchat = require('./taskchat');

function setup(name) {
  const p = projects.create({ name });
  for (const a of ['april', 'mikey', 'mara']) projects.addAgent(p.id, a);
  const t = tasks.create(p.id, { sentence: 'Ship it' });
  return { p, t };
}
// From the STORE, not the returned task: proves it was written and survives the next read.
const storedPart = (p, n) => tasks.partsOf(tasks.byNumber(projects.readAll().find((x) => x.id === p.id), n))[0];
const assignedRows = (p, n) => taskchat.read(p.id, n).filter((r) => r.kind === 'assigned');

test('#6103: a named process move records movedBy in the store and in the activity log', () => {
  const { p, t } = setup('Named move');
  const m = tasks.assignPart(p.id, t.number, 1, 'april', { via: 'process', by: 'mara' });
  assert.equal(m.ok && m.changed, true);
  const part = storedPart(p, t.number);
  assert.equal(part.who, 'april');
  assert.equal(part.movedVia, 'process');
  assert.equal(part.movedBy, 'mara', 'the agent that made the move is not recorded');
  const rows = assignedRows(p, t.number);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].who, 'april');
  assert.equal(rows[0].by, 'mara', 'the activity line does not say who handed it over');
});

test('#6103: movedBy survives a later write to the same task (partsOf carries it)', () => {
  const { p, t } = setup('Carried');
  tasks.assignPart(p.id, t.number, 1, 'april', { via: 'process', by: 'mara' });
  // Another write rewrites every part through partsOf; a field it does not carry is erased here.
  assert.equal(tasks.addPart(p.id, t.number, { sentence: 'Second half' }).ok, true);
  assert.equal(storedPart(p, t.number).movedBy, 'mara', 'the next write to the task erased movedBy');
});

test('#6103: no agent is named for the screen, the Assigner, or a caller nobody named', () => {
  for (const [why, made] of [
    ['the screen', { via: 'screen', by: 'mara' }],
    ['the Assigner', { via: 'assigner', by: 'mara' }],
    ['no made at all (the screen)', undefined],
    ['a process with no by', { via: 'process' }],
    ['a process with a null by', { via: 'process', by: null }],
    ['a blank by', { via: 'process', by: '   ' }],
    ['a by that is not a string', { via: 'process', by: 42 }],
    ['a by longer than any name', { via: 'process', by: 'x'.repeat(tasks.WHO_MAX + 1) }],
  ]) {
    const { p, t } = setup('Unnamed ' + why);
    assert.equal(tasks.assignPart(p.id, t.number, 1, 'april', made).changed, true, why);
    assert.equal(storedPart(p, t.number).movedBy, undefined, why + ': recorded an agent');
    assert.equal(assignedRows(p, t.number)[0].by, undefined, why + ': the activity line names an agent');
  }
});

test('#6103: a later move clears the last movedBy, so it never names an agent that did not make the current move', () => {
  const { p, t } = setup('Cleared');
  tasks.assignPart(p.id, t.number, 1, 'april', { via: 'process', by: 'mara' });
  assert.equal(storedPart(p, t.number).movedBy, 'mara');
  tasks.assignPart(p.id, t.number, 1, 'mikey', { via: 'screen' });
  assert.equal(storedPart(p, t.number).movedBy, undefined, 'a screen move kept the previous agent as its mover');
  tasks.assignPart(p.id, t.number, 1, 'april', { via: 'process', by: 'mikey' });
  assert.equal(storedPart(p, t.number).movedBy, 'mikey', 'a second named move did not replace the first');
});

test('#6103: a resubmit of the current holder is not a move, and leaves movedBy as it was', () => {
  const { p, t } = setup('Resubmit');
  tasks.assignPart(p.id, t.number, 1, 'april', { via: 'process', by: 'mara' });
  const again = tasks.assignPart(p.id, t.number, 1, 'april', { via: 'process', by: 'mikey' });
  assert.equal(again.changed, false);
  assert.equal(storedPart(p, t.number).movedBy, 'mara', 'a no-op resubmit renamed the mover');
  assert.equal(assignedRows(p, t.number).length, 1, 'a no-op resubmit wrote an activity line');
});
