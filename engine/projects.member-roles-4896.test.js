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

/* #5300 (10-05 user diagnostic R10): five agents made as Project Managers read as five Project Managers on every
   project. A member can say what it does on one project (roleHere). It is shown beside the member and changes
   nothing else: `role` (who a room opens on, the coordinators warning, a person-saved role winning) is untouched. */
test('#5300: a role set for one project is that member\'s roleHere there only; role itself is unchanged', () => {
  projects.writeAll([]);
  store.writeProfile('cw', { role: 'Account Manager' });
  try {
    const roster = cards(['pm', { displayName: 'Ada', role: 'Project Manager' }], ['cw', { displayName: 'Bo', role: 'Project Manager' }]);
    const a = projects.create({ name: 'Here', folder: folder('here'), agents: ['pm', 'cw'], roster });
    const b = projects.create({ name: 'Elsewhere', folder: folder('elsewhere'), agents: ['pm', 'cw'], roster });
    assert.deepEqual(projects.setRoleHere(a.id, 'pm', 'Researcher'), { role: 'Researcher' });
    const here = projects.get(a.id, roster);
    assert.deepEqual(rolesOf(here), { pm: 'Project Manager', cw: 'Account Manager' }, 'the role here replaced role (routing and the person-saved role)');
    assert.deepEqual(Object.fromEntries(here.agents.map((m) => [m.sessionName, m.roleHere])), { pm: 'Researcher', cw: null });
    // CONTROL: the other project carries no role here.
    assert.deepEqual(Object.fromEntries(projects.get(b.id, roster).agents.map((m) => [m.sessionName, m.roleHere])), { pm: null, cw: null });
    // Leaving takes it; joining again starts with none.
    projects.removeAgent(a.id, 'pm');
    projects.addAgent(a.id, 'pm', roster);
    assert.equal(projects.get(a.id, roster).agents.find((m) => m.sessionName === 'pm').roleHere, null, 'a role here outlived the membership');
    // project show prints both, the role here quoted (an agent's words), and the own role first.
    const view = require('./projectview');
    const shown = view.renderShow({ project: view.overviewOf(projects.list(roster).find((p) => p.id === b.id), roster, { allProjects: [] }) }).join('\n');
    assert.ok(shown.includes('Ada, Project Manager  |') || shown.includes('Ada, Project Manager; '), 'fixture: ' + shown);
    projects.setRoleHere(b.id, 'pm', 'Lead "boss"');
    const shown2 = view.renderShow({ project: view.overviewOf(projects.list(roster).find((p) => p.id === b.id), roster, { allProjects: [] }) }).join('\n');
    assert.match(shown2, /Ada, Project Manager; on this project: "Lead 'boss'"  \|/, shown2);
    // A session name of __proto__ cannot reach the prototype.
    const raw = projects.readAll();
    const pb = raw.find((p) => p.id === b.id); pb.agents.push('__proto__'); projects.writeAll(raw);
    projects.setRoleHere(b.id, '__proto__', 'x');
    const stored = projects.readAll().find((p) => p.id === b.id).rolesHere;
    assert.equal(Object.getPrototypeOf(stored), Object.prototype, 'the prototype moved');
    assert.ok(Object.prototype.hasOwnProperty.call(stored, '__proto__'), 'the role for __proto__ was not kept as its own key');
    // A non-member is refused; the role is one line.
    assert.throws(() => projects.setRoleHere(b.id, 'nobody', 'x'), /not on this project/);
    assert.deepEqual(projects.setRoleHere(b.id, 'pm', 'line one\nline\u202etwo'), { role: 'line one line two' });
  } finally { store.writeProfile('cw', {}); }
});
