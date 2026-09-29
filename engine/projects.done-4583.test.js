'use strict';

/**
 * #4583 (#4580 items 3 and 4): a project asks what done looks like at creation, and warns when two agents with a
 * coordinating role are on it.
 *
 * Engine half: the create form's `done` reaches BRIEF.md; a blank one leaves a "Not set yet" placeholder that
 * doneIsPending reads (and so do briefs written before #4583); the project read carries doneSet and the current
 * coordinator warning. The routes are covered in server.projects-done-4583.test.js.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-done4583-'));
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

let seq = 0;
function folder(sub) {
  seq += 1;
  const dir = path.join(SANDBOX, `folder-${seq}-${sub}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function reset() { try { projects.writeAll([]); } catch { /* first run */ } }
const brief = (dir) => fs.readFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), 'utf8');

test('#4583: done typed at creation is written under "Done looks like" and the project is not pending on done', () => {
  reset();
  const dir = folder('done');
  const made = projects.create({ name: 'Lease', folder: dir, description: 'Renew the lease', done: 'The new lease is signed and filed.' });
  assert.match(brief(dir), /## Done looks like\n\nThe new lease is signed and filed\.\n/);
  assert.ok(!brief(dir).includes('Not set yet'), 'a given done left the placeholder too');
  assert.equal(projects.doneIsPending(dir), false);
  assert.equal(projects.get(made.id, []).doneSet, true);
});

test('#4583: done left blank writes the "Not set yet" placeholder, and the read says doneSet false', () => {
  reset();
  const dir = folder('blank');
  const made = projects.create({ name: 'Lease', folder: dir, description: 'Renew the lease' });
  assert.ok(brief(dir).includes(projects.BRIEF_DONE_PLACEHOLDER));
  assert.equal(projects.doneIsPending(dir), true);
  assert.equal(projects.get(made.id, []).doneSet, false);
});

test('#4583: a brief written before #4583 (the old placeholder) is still read as done not set', () => {
  const dir = folder('old');
  fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME),
    '# Old\n\n## Goal\n\nA goal\n\n## Done looks like\n\n_How will everyone know this is finished? Replace this line._\n');
  assert.equal(projects.doneIsPending(dir), true);
});

test('#4583: a brief the person wrote (no placeholder) is done; an unreadable brief never contradicts it; no brief is pending', (t) => {
  const dir = folder('own');
  fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), '# Mine\n\nDone when the tests pass.\n');
  assert.equal(projects.doneIsPending(dir), false);
  const none = folder('none');
  assert.equal(projects.doneIsPending(none), true, 'no brief at all: done is not set');
  const locked = folder('locked');
  fs.writeFileSync(path.join(locked, projects.BRIEF_STUB_FILENAME), 'x');
  fs.chmodSync(path.join(locked, projects.BRIEF_STUB_FILENAME), 0o000);
  try {
      if (process.getuid && process.getuid() === 0) { t.skip('running as root: an unreadable file is readable, so this arm cannot be tested'); return; }
    assert.equal(projects.doneIsPending(locked), false);
  } finally { fs.chmodSync(path.join(locked, projects.BRIEF_STUB_FILENAME), 0o644); }
});

test('#4583: done is one line, capped at 1000 characters, and must be words; the refusal names the done box', () => {
  assert.equal(projects.cleanDone('  signed\nand  filed '), 'signed and filed');
  assert.equal(projects.cleanDone(undefined), '');
  assert.throws(() => projects.cleanDone({}), /done looks like/);
  assert.throws(() => projects.cleanDone('x'.repeat(1001)), /done looks like to 1000/);
  assert.equal(projects.cleanDone('x'.repeat(1000)).length, 1000);
  reset();
  const dir = folder('bad');
  assert.throws(() => projects.create({ name: 'Bad', folder: dir, done: 'x'.repeat(1001) }), /done looks like/);
  assert.equal(fs.existsSync(path.join(dir, projects.BRIEF_STUB_FILENAME)), false, 'a refused create wrote a brief');
});

/* roles: { machineName: role } or { machineName: [role, savedName] }. */
function withProfiles(roles, fn) {
  for (const [name, r] of Object.entries(roles)) store.writeProfile(name, Array.isArray(r) ? { role: r[0], name: r[1] } : { role: r });
  try { return fn(); } finally { for (const name of Object.keys(roles)) store.writeProfile(name, { role: null, name: null }); }
}

test('#4583: two coordinators warn, naming both and the split; one coordinator, or none, does not (control)', () => {
  withProfiles({ pm1: ['Project Manager', 'Ada'], pm2: ['Project Manager', 'Bo'], dev: 'Developer' }, () => {
    const two = projects.coordinatorWarning({ agents: [{ sessionName: 'pm1', name: 'Stranger' }, { sessionName: 'pm2' }, { sessionName: 'dev' }] }, null);
    assert.ok(two && two.startsWith('Ada and Bo both have a coordinating role'), two);
    assert.ok(!two.includes('Stranger'), 'a saved role was paired with the read\'s card name, which an untied pane supplies: ' + two);
    assert.ok(two.includes('one owns the brief (BRIEF.md) and the other owns the task queue'), two);
    assert.equal(projects.coordinatorWarning({ agents: [{ sessionName: 'pm1' }, { sessionName: 'dev' }] }, null), null);
    assert.equal(projects.coordinatorWarning({ agents: [] }, null), null);
  });
});

test('#4583: a live role is used before the saved profile; the joiner filter warns only when a coordinator joined', () => {
  withProfiles({ pm1: 'Project Manager', dev: 'Developer' }, () => {
    const agents = [{ sessionName: 'pm1', name: 'Ada' }, { sessionName: 'dev', name: 'Cy', role: 'Project Manager' }];
    assert.ok(projects.coordinatorWarning({ agents }, null), 'the live role (Project Manager) was not read');
    assert.ok(projects.coordinatorWarning({ agents }, 'dev'), 'a coordinator joining must warn');
    const withDev = [...agents, { sessionName: 'ed', name: 'Ed', role: 'Designer' }];
    assert.equal(projects.coordinatorWarning({ agents: withDev }, 'ed'), null, 'a non-coordinator joining must not re-warn');
  });
});

test('#4583: the project read carries the current warning from saved roles (members not running)', () => {
  reset();
  withProfiles({ pm1: 'Project Manager', pm2: 'Project Manager' }, () => {
    const made = projects.create({ name: 'Two PMs', folder: folder('pms'), agents: ['pm1', 'pm2'], roster: [] });
    const read = projects.get(made.id, []);
    assert.ok(read.coordinators && read.coordinators.includes('coordinating role'), JSON.stringify(read.coordinators));
    const one = projects.create({ name: 'One PM', folder: folder('pm'), agents: ['pm1'], roster: [] });
    assert.equal(projects.get(one.id, []).coordinators, null);
  });
});

test('#4583 round 1: only a role that coordinates the PROJECT counts, not any "Manager" or "Lead"', () => {
  withProfiles({ mk: 'Marketing Manager', sm: 'Social Media Manager', tl: 'Tech Lead', ld: 'Lead Developer', rc: 'Recruiting Coordinator', pm: 'Project Manager', pg: 'Program Manager (PM)' }, () => {
    const warn = (...names) => projects.coordinatorWarning({ agents: names.map((n) => ({ sessionName: n })) }, null);
    assert.equal(warn('mk', 'sm'), null, 'two marketing roles are not two project coordinators');
    assert.equal(warn('tl', 'ld', 'rc'), null, 'leads and a recruiting coordinator are not project coordinators');
    assert.ok(warn('pm', 'pg'), 'CONTROL: a Project Manager and a Program Manager are');
    assert.ok(warn('pm', 'pg', 'mk').startsWith('pm and pg both have'), warn('pm', 'pg', 'mk'));
  });
});

test('#4583 round 1: three coordinators read "all have"', () => {
  withProfiles({ a: 'Project Manager', b: 'Project Manager', c: 'Project Lead' }, () => {
    assert.ok(projects.coordinatorWarning({ agents: [{ sessionName: 'a' }, { sessionName: 'b' }, { sessionName: 'c' }] }, null).startsWith('a, b and c all have'));
  });
});

test('#4583 round 1: a project whose folder has no BRIEF.md says nothing about done (null), not "Done not set"', () => {
  reset();
  const dir = folder('nobrief');
  const made = projects.create({ name: 'Adopted', folder: dir });
  fs.rmSync(path.join(dir, projects.BRIEF_STUB_FILENAME));
  assert.equal(projects.get(made.id, []).doneSet, null);
});

test('#4583 round 1: the welcome project is not badged: its brief says what done is', () => {
  reset();
  const made = projects.seedWelcomeHome({ roster: [] });
  assert.ok(made, 'the welcome home was not seeded (fixture control)');
  assert.equal(projects.get(made.id, []).doneSet, true);
  assert.ok(brief(made.folder).includes(projects.WELCOME_DONE));
});

test('#4583 round 1: done typed for a folder that already has a brief is not dropped', () => {
  reset();
  const stub = folder('oldstub');
  fs.writeFileSync(path.join(stub, projects.BRIEF_STUB_FILENAME), '# Old\n\n## Done looks like\n\n_How will everyone know this is finished? Replace this line._\n\nMore.\n');
  projects.create({ name: 'Old stub', folder: stub, done: 'Filed.' });
  assert.equal(brief(stub), '# Old\n\n## Done looks like\n\nFiled.\n\nMore.\n', 'Kosmos\'s own placeholder was not replaced');
  const nodone = folder('nodone');
  fs.writeFileSync(path.join(nodone, projects.BRIEF_STUB_FILENAME), '# Mine\n\nMy goal.\n');
  projects.create({ name: 'No done section', folder: nodone, done: 'Shipped.' });
  assert.equal(brief(nodone), '# Mine\n\nMy goal.\n\n## Done looks like\n\nShipped.\n');
  const own = folder('owndone');
  const mine = '# Mine\n\n## Done looks like\n\nWhen I say so.\n';
  fs.writeFileSync(path.join(own, projects.BRIEF_STUB_FILENAME), mine);
  projects.create({ name: 'Own done', folder: own, done: 'Something else.' });
  assert.equal(brief(own), mine, 'the person\'s own Done section was overwritten');
});
