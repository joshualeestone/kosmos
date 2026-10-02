'use strict';

/**
 * #4896, second half: "every member shows the joining role whatever they joined to do."
 *
 * Read from source (origin/main a7cae2b3e), a membership stores only the agent's machine name, and
 * `describe` reads each member's role off that member's own card (`profileRole(card) || card.role`,
 * keyed by sessionName). Nothing in the code gives every member one role. The report could not be
 * reproduced from source, and its board is not on this machine. These tests pin the property the
 * report says broke, so a regression to "every member shows one role" goes red here instead of
 * reaching a person: on one project, each member shows its OWN role, before and after another agent
 * joins.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-roles4896-'));
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
const store = require('./store');
const fleet = require('../test-support/fleet');

/* Real board cards (fixture-discipline: never a hand-built card). [name, { displayName, role }]. */
function cards(...specs) {
  const f = fleet.install(specs.map((x) => fleet.agent(x[0], x[1])), { strict: false });
  try { return f.agents.slice(); } finally { f.restore(); }
}
let seq = 0;
function folder(sub) {
  seq += 1;
  const dir = path.join(SANDBOX, `folder-${seq}-${sub}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const rolesOf = (read) => Object.fromEntries(read.agents.map((m) => [m.sessionName, m.role]));

test('#4896: each member of one project shows its own role, and a joiner does not lend the others its role', () => {
  projects.writeAll([]);
  const before = cards(['pm', { displayName: 'Ada', role: 'Project Manager' }], ['cw', { displayName: 'Bo', role: 'Copywriter' }]);
  const made = projects.create({ name: 'Launch', folder: folder('launch'), agents: ['pm', 'cw'], roster: before });
  assert.deepEqual(rolesOf(projects.get(made.id, before)), { pm: 'Project Manager', cw: 'Copywriter' });

  // A third agent joins after the project exists, the path the report names.
  const after = cards(['pm', { displayName: 'Ada', role: 'Project Manager' }], ['cw', { displayName: 'Bo', role: 'Copywriter' }],
    ['ds', { displayName: 'Cy', role: 'Designer' }]);
  projects.addAgent(made.id, 'ds', after);
  const read = projects.get(made.id, after);
  assert.deepEqual(rolesOf(read), { pm: 'Project Manager', cw: 'Copywriter', ds: 'Designer' },
    'a member shows a role other than its own after another agent joined');
  // The report's exact symptom, stated as its own assertion so a failure names it.
  assert.equal(new Set(read.agents.map((m) => m.role)).size, 3, 'every member shows one role');
});

test('#4896: a role the person saved on one member wins for that member only', () => {
  projects.writeAll([]);
  store.writeProfile('cw', { role: 'Account Manager' });
  try {
    const roster = cards(['pm', { displayName: 'Ada', role: 'Project Manager' }], ['cw', { displayName: 'Bo', role: 'Copywriter' }]);
    const made = projects.create({ name: 'Saved', folder: folder('saved'), agents: ['pm', 'cw'], roster });
    assert.deepEqual(rolesOf(projects.get(made.id, roster)), { pm: 'Project Manager', cw: 'Account Manager' });
  } finally {
    store.writeProfile('cw', { role: null });
  }
});
