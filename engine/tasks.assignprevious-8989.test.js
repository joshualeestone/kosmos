'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8989: assignPart says who held the part before a real move (`previous`), read inside the same write, so the
   board can tell the agent a part was taken from (server.js givePart). Not on a resubmit of the same holder, nor on a
   refused move. */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'assignprevious-8989-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const tasks = require('./tasks');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function fresh(name) {
  const folder = path.join(SANDBOX, 'projects', name);
  fs.mkdirSync(folder, { recursive: true });
  const p = projects.create({ name, folder, agents: ['otto', 'mara'] });
  const t = tasks.create(p.id, { sentence: 'file the lease', made: { via: 'screen', by: null } });
  return { p, t };
}

test('a real move names the agent the part was taken from', () => {
  const { p, t } = fresh('prev-move');
  const first = tasks.assignPart(p.id, t.number, 1, 'otto', { via: 'screen' });
  assert.equal(first.ok, true, first.because);
  assert.equal(first.previous, null, 'a part that had nobody names nobody');
  const moved = tasks.assignPart(p.id, t.number, 1, 'mara', { via: 'screen' });
  assert.equal(moved.ok, true, moved.because);
  assert.equal(moved.changed, true);
  assert.equal(moved.previous, 'otto');
});

test('CONTROL: giving it to the agent that already holds it is no move, and names nobody', () => {
  const { p, t } = fresh('prev-same');
  tasks.assignPart(p.id, t.number, 1, 'otto', { via: 'screen' });
  const again = tasks.assignPart(p.id, t.number, 1, 'otto', { via: 'screen' });
  assert.equal(again.ok, true, again.because);
  assert.equal(again.changed, false);
  assert.equal('previous' in again, false);
});

test('taking someone off (to nobody) names who it was', () => {
  const { p, t } = fresh('prev-off');
  tasks.assignPart(p.id, t.number, 1, 'otto', { via: 'screen' });
  const off = tasks.assignPart(p.id, t.number, 1, null, { via: 'screen' });
  assert.equal(off.ok, true, off.because);
  assert.equal(off.previous, 'otto');
});
