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
const fleet = require('../test-support/fleet');

/* Real board cards from test-support/fleet (fixture-discipline: never a hand-built card). Each spec is a name, or
   [name, { displayName, role }] for a card whose pane is tied to a name and carries a live role. The fleet is
   restored before this returns, so no test leaves the pane seams installed. The board orders its cards itself, so the
   warning's names are asserted as a set, never as the order a test happened to list them in. */
const bothHave = (text, a, b) => typeof text === 'string'
  && (text.startsWith(a + ' and ' + b + ' both have') || text.startsWith(b + ' and ' + a + ' both have'));
function cards(...specs) {
  const f = fleet.install(specs.map((x) => (Array.isArray(x) ? fleet.agent(x[0], x[1]) : fleet.agent(x))), { strict: false });
  try { return f.agents.slice(); } finally { f.restore(); }
}

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

test('#4583 review: a person who writes done under the placeholder, leaving it in, has set done (badge, note and show agree)', () => {
  reset();
  const dir = folder('under');
  const made = projects.create({ name: 'Lease', folder: dir, description: 'Renew the lease' });
  const file = path.join(dir, projects.BRIEF_STUB_FILENAME);
  fs.writeFileSync(file, brief(dir).replace(projects.BRIEF_DONE_PLACEHOLDER, projects.BRIEF_DONE_PLACEHOLDER + '\n\nThe lease is signed.'));
  assert.equal(projects.doneIsPending(dir), false, 'the room note still asks');
  assert.equal(projects.get(made.id, []).doneSet, true, 'the board still badges it');
  assert.equal(require('./brief').readBrief(dir).done, 'The lease is signed.', 'show prints the placeholder');
});

test('#4583 review round 2: done typed for a brief with an EMPTY Done section of its own fills that section, never a second one', () => {
  reset();
  const dir = folder('emptydone');
  const made = projects.create({ name: 'Lease', folder: dir, description: 'Renew the lease' });
  const file = path.join(dir, projects.BRIEF_STUB_FILENAME);
  fs.writeFileSync(file, '# Lease\n\n## Goal\n\nRenew the lease.\n\n## Done when\n\n## Notes\n\nCall the landlord.\n');
  assert.equal(projects.get(made.id, []).doneSet, false, 'an empty Done section read as set (fixture control)');
  assert.equal(projects.fillDone(dir, 'The lease is signed.'), true);
  const after = brief(dir);
  assert.equal((after.match(/^##\s+done\b/gim) || []).length, 1, 'a second Done section was appended: ' + after);
  assert.equal(require('./brief').readBrief(dir).done, 'The lease is signed.');
  assert.equal(projects.get(made.id, []).doneSet, true);
  assert.equal(projects.doneIsPending(dir), false);
  assert.ok(after.includes('## Notes\n\nCall the landlord.'), 'the section after it was disturbed');
});

test('#4583 review round 2: no BRIEF.md at all is still pending for the room note (the brief is to be written)', () => {
  reset();
  const dir = folder('gone');
  projects.create({ name: 'Lease', folder: dir });
  fs.rmSync(path.join(dir, projects.BRIEF_STUB_FILENAME));
  assert.equal(projects.doneIsPending(dir), true);
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
    const two = projects.coordinatorWarning({ agents: cards(['pm1', { displayName: 'Stranger' }], 'pm2', 'dev') }, null);
    assert.ok(bothHave(two, 'Ada', 'Bo') && two.includes('both have a coordinating role'), two);
    assert.ok(!two.includes('Stranger'), 'a saved role was paired with the read\'s card name, which an untied pane supplies: ' + two);
    assert.ok(two.includes('one owns the brief (BRIEF.md) and the other owns the task queue'), two);
    assert.equal(projects.coordinatorWarning({ agents: cards('pm1', 'dev') }, null), null);
    assert.equal(projects.coordinatorWarning({ agents: [] }, null), null);
  });
});

test('#4583: a live role is used before the saved profile; the joiner filter warns only when a coordinator joined', () => {
  withProfiles({ pm1: 'Project Manager', dev: 'Developer' }, () => {
    const agents = cards(['pm1', { displayName: 'Ada' }], ['dev', { displayName: 'Cy', role: 'Project Manager' }]);
    assert.ok(projects.coordinatorWarning({ agents }, null), 'the live role (Project Manager) was not read');
    assert.ok(projects.coordinatorWarning({ agents }, 'dev'), 'a coordinator joining must warn');
    const withDev = cards(['pm1', { displayName: 'Ada' }], ['dev', { displayName: 'Cy', role: 'Project Manager' }], ['ed', { displayName: 'Ed', role: 'Designer' }]);
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
    const warn = (...names) => projects.coordinatorWarning({ agents: cards(...names) }, null);
    assert.equal(warn('mk', 'sm'), null, 'two marketing roles are not two project coordinators');
    assert.equal(warn('tl', 'ld', 'rc'), null, 'leads and a recruiting coordinator are not project coordinators');
    assert.ok(warn('pm', 'pg'), 'CONTROL: a Project Manager and a Program Manager are');
    assert.ok(bothHave(warn('pm', 'pg', 'mk'), 'pm', 'pg'), warn('pm', 'pg', 'mk'));
  });
});

test('#4583 round 1: three coordinators read "all have"', () => {
  withProfiles({ a: 'Project Manager', b: 'Project Manager', c: 'Project Lead' }, () => {
    const three = projects.coordinatorWarning({ agents: cards('a', 'b', 'c') }, null);
    const m = /^(\w+), (\w+) and (\w+) all have/.exec(three || '');
    assert.deepEqual(m && [m[1], m[2], m[3]].sort(), ['a', 'b', 'c'], three);
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
  fs.writeFileSync(path.join(stub, projects.BRIEF_STUB_FILENAME), '# Old\n\n## Done looks like\n\n_How will everyone know this is finished? Replace this line._\n\n---\n\nMore.\n');
  projects.create({ name: 'Old stub', folder: stub, done: 'Filed.' });
  assert.equal(brief(stub), '# Old\n\n## Done looks like\n\nFiled.\n\n---\n\nMore.\n', 'Kosmos\'s own placeholder was not replaced');
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

test('#4583 review round 3: fillDone never merges into, or adds a second section after, a done the person wrote', () => {
  reset();
  const rb = require('./brief');
  for (const [name, mine, said] of [
    ['beside', '# Mine\n\n## Done looks like\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n\nThe lease is signed.\n', 'The lease is signed.'],
    ['donewhen', '# Mine\n\n## Done when\n\nThe lease is signed.\n', 'The lease is signed.'],
  ]) {
    const dir = folder(name);
    fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), mine);
    assert.equal(projects.fillDone(dir, 'TYPED'), false, name);
    assert.equal(brief(dir), mine, name + ': the person\'s brief was changed');
    assert.equal(rb.readBrief(dir).done, said, name);
  }
});

test('#4583 review: an empty Done section, or one holding only the placeholder, is filled in place and badged by the same rule', () => {
  reset();
  const rb = require('./brief');
  const dirs = {};
  for (const [name, text] of [
    ['empty', '# P\n\n## Goal\n\nG.\n\n## Done looks like\n\n## Notes\n\nN.\n'],
    ['rule', '# P\n\n## Done looks like\n---\nFooter.\n'],
    ['own', '# P\n\n## Goal\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n\n## Done looks like\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n'],
  ]) {
    const dir = folder(name);
    dirs[name] = dir;
    const made = projects.create({ name: name, folder: dir });
    fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), text);
    assert.equal(projects.get(made.id, []).doneSet, false, name + ': not badged before');
    assert.equal(projects.doneIsPending(dir), true, name);
    assert.equal(projects.fillDone(dir, 'TYPED'), true, name);
    assert.equal(rb.readBrief(dir).done, 'TYPED', name + ': show cannot see the filled done');
    assert.equal(projects.get(made.id, []).doneSet, true, name + ': still badged after');
    assert.equal(projects.doneIsPending(dir), false, name);
    assert.equal((brief(dir).match(/done looks like/gi) || []).length, 1, name + ': a second Done section');
  }
  // The typed done never becomes a setext heading over a rule directly under the heading.
  assert.ok(brief(dirs.rule).includes('## Done looks like\n\nTYPED\n\n---'), brief(dirs.rule));
  // Only the Done section's own placeholder is replaced; the one a person moved under Goal is theirs.
  assert.ok(brief(dirs.own).includes('## Goal\n\n' + projects.BRIEF_DONE_PLACEHOLDER), brief(dirs.own));
});

test('#4583 review round 4: a "Done" title or a ### "Done so far" note never captures the Done section', () => {
  const rb = require('./brief');
  const title = '# Done Deal\n\n## Goal\n\nSell it.\n\n## Done looks like\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n';
  assert.equal(rb.doneFrom(title), null);
  assert.equal(rb.doneSetFrom(title), false);
  const sofar = '# P\n\n## Progress\n\n### Done so far\n\nlogin page\n\n## Done looks like\n\nAll users can pay.\n';
  assert.equal(rb.doneFrom(sofar), 'All users can pay.');
});

test('#4583 review: a placeholder under a heading the person retitled is replaced; show says there is no Done section', () => {
  reset();
  const rb = require('./brief');
  const dir = folder('whatdone');
  const made = projects.create({ name: 'Retitled', folder: dir });
  fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), '# P\n\n## What done looks like\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n');
  assert.equal(projects.get(made.id, []).doneSet, false);
  assert.equal(projects.fillDone(dir, 'TYPED'), true);
  assert.equal(brief(dir), '# P\n\n## What done looks like\n\nTYPED\n');
  assert.equal(projects.get(made.id, []).doneSet, true);
  assert.deepEqual([rb.readBrief(dir).done, rb.readBrief(dir).doneSection], [null, false]);
});

test('#4583 round 5: a done typed like a heading or a rule stays the done, in the stub and through fillDone', () => {
  reset();
  const rb = require('./brief');
  for (const done of ['# of signups hits 500', '---', '* * *', '## Launch', '\\#tag', '\\---', '\\*b*', '\\a', '\\\\x']) {
    const dir = folder('md');
    const made = projects.create({ name: 'Md', folder: dir, done });
    assert.equal(rb.readBrief(dir).done, done, 'stub: ' + done);
    assert.equal(projects.get(made.id, []).doneSet, true, 'stub: ' + done);
    assert.equal(projects.doneIsPending(dir), false, 'stub: ' + done);
    assert.equal(projects.doneWrittenIn(dir, done), true, 'stub: ' + done);
    const old = folder('mdfill');
    fs.writeFileSync(path.join(old, projects.BRIEF_STUB_FILENAME), '# Old\n\n## Done looks like\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n');
    assert.equal(projects.fillDone(old, done), true);
    assert.equal(rb.readBrief(old).done, done, 'fillDone: ' + done);
  }
  // CONTROL: an ordinary done is written exactly as typed, no escape.
  const plain = folder('plain');
  projects.create({ name: 'Plain', folder: plain, done: 'Ship v1' });
  assert.match(brief(plain), /## Done looks like\n\nShip v1\n/);
});

test('#4583 round 5: a Done heading of the person\'s own shape, at any level, empty or not, is left alone', () => {
  reset();
  for (const mine of ['# Mine\n\n### Done looks like\n\n## Notes\n\nN.\n', '# Mine\n\n### Done when\n\ntests pass\n', '# Mine\n\n# Done\n\nX.\n']) {
    const dir = folder('ownshape');
    fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), mine);
    assert.equal(projects.fillDone(dir, 'Ship v1'), false, mine);
    assert.equal(brief(dir), mine, mine);
    assert.equal(projects.doneWrittenIn(dir, 'Ship v1'), false, mine);
  }
});

test('#4583 round 5: what is left of a seeded placeholder in an unset section is not printed with the done', () => {
  reset();
  const rb = require('./brief');
  for (const left of ['**Not set yet.**', '**Not set yet.** _How will everyone know\nthis is finished? Replace this line._']) {
    const dir = folder('remnant');
    fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), '# P\n\n## Done looks like\n\n' + left + '\n\n## Notes\n\nN.\n');
    assert.equal(rb.doneSetFrom(brief(dir)), false, 'fixture: the remnant reads unset');
    assert.equal(projects.fillDone(dir, 'Ship v1'), true);
    assert.equal(rb.readBrief(dir).done, 'Ship v1', left);
    assert.ok(brief(dir).includes('## Notes\n\nN.'), 'the next section was disturbed');
  }
});

test('#4583 round 9: the welcome home never writes Kosmos\'s own done into a brief the person already has', () => {
  reset();
  const home = path.join(SANDBOX, 'Getting started');
  fs.mkdirSync(home, { recursive: true });
  const mine = '# My notes\n\n## Goal\n\nLearn Kosmos.\n';
  fs.writeFileSync(path.join(home, projects.BRIEF_STUB_FILENAME), mine);
  const made = projects.create({ name: 'Adopted', folder: home, done: projects.WELCOME_DONE, seedDoneOnly: true });
  assert.ok(made, 'fixture: the project was made');
  assert.equal(brief(home), mine, 'Kosmos\'s own done was written into the person\'s brief');
  // CONTROL: the same done typed by a person (no seedDoneOnly) is written.
  const typed = folder('typed');
  fs.writeFileSync(path.join(typed, projects.BRIEF_STUB_FILENAME), mine);
  projects.create({ name: 'Typed', folder: typed, done: projects.WELCOME_DONE });
  assert.ok(brief(typed).includes(projects.WELCOME_DONE));
});

test('#4583 round 9: seedWelcomeHome itself adopts an existing "Getting started" folder without touching its brief', () => {
  reset();
  const home = path.join(process.env.AGENT_WORKFORCE_PROJECTS, projects.WELCOME_NAME);
  fs.mkdirSync(home, { recursive: true });
  const mine = '# My notes\n\n## Goal\n\nLearn Kosmos.\n';
  fs.writeFileSync(path.join(home, projects.BRIEF_STUB_FILENAME), mine);
  try {
    const made = projects.seedWelcomeHome({ roster: [] });
    assert.ok(made && made.folder === home, 'fixture: the welcome home adopted the folder: ' + JSON.stringify(made && made.folder));
    assert.equal(brief(home), mine);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('#4583 round 9: with no ## Done section, only the person\'s own Done heading can vouch that a done was written', () => {
  reset();
  const dir = folder('own-scope');
  fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), '# Mine\n\n## Goal\n\nShip\n\n### Done when\n\nbig thing\n');
  assert.equal(projects.doneWrittenIn(dir, 'Ship'), false, 'a Goal line vouched for the done');
  assert.equal(projects.doneWrittenIn(dir, 'big thing'), true);
});

test('#4583 round 2: a done with $& or $\' is written as typed, never as a replacement pattern', () => {
  reset();
  const dir = folder('dollar');
  fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), '# Old\n\n## Done looks like\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n\n## Notes\n\nMy notes.\n');
  projects.create({ name: 'Dollar', folder: dir, done: "Revenue passes $$10k, $& and $' stay" });
  assert.equal(brief(dir), "# Old\n\n## Done looks like\n\nRevenue passes $$10k, $& and $' stay\n\n## Notes\n\nMy notes.\n");
});

test('#4583 round 2: a placeholder quoted inside other text is neither "not set" nor replaced', () => {
  reset();
  const dir = folder('quoted');
  const mine = '# Mine\n\nKosmos writes "' + projects.BRIEF_DONE_PLACEHOLDER + '" in new briefs.\n\n## Done looks like\n\nShipped.\n';
  fs.writeFileSync(path.join(dir, projects.BRIEF_STUB_FILENAME), mine);
  assert.equal(projects.doneIsPending(dir), false);
  projects.create({ name: 'Quoted', folder: dir, done: 'Other.' });
  assert.equal(brief(dir), mine, 'the quote was rewritten');
});

test('#4583 round 2: a Done heading the person titled their own way is theirs; CRLF briefs stay CRLF', () => {
  reset();
  const own = folder('ownheading');
  const mine = '# Mine\n\n### done looks like (draft)\n\nWhen it ships.\n';
  fs.writeFileSync(path.join(own, projects.BRIEF_STUB_FILENAME), mine);
  projects.create({ name: 'Own heading', folder: own, done: 'Else.' });
  assert.equal(brief(own), mine, 'a second Done section was appended');
  const crlf = folder('crlf');
  fs.writeFileSync(path.join(crlf, projects.BRIEF_STUB_FILENAME), '# Win\r\n\r\nGoal.\r\n');
  projects.create({ name: 'Crlf', folder: crlf, done: 'Done.' });
  assert.equal(brief(crlf), '# Win\r\n\r\nGoal.\r\n\r\n## Done looks like\r\n\r\nDone.\r\n');
});

test('#4583 round 2: a BRIEF.md that is a symlink or too big is not read or written; the read says nothing', () => {
  reset();
  const outside = path.join(SANDBOX, 'outside-target.md');
  fs.writeFileSync(outside, '# Not yours\n\n' + projects.BRIEF_DONE_PLACEHOLDER + '\n');
  const linked = folder('linked');
  const made = projects.create({ name: 'Linked', folder: linked });
  fs.rmSync(path.join(linked, projects.BRIEF_STUB_FILENAME));
  fs.symlinkSync(outside, path.join(linked, projects.BRIEF_STUB_FILENAME));
  assert.equal(projects.get(made.id, []).doneSet, null);
  assert.equal(projects.fillDone(linked, 'Through the link.'), false);
  assert.ok(!fs.readFileSync(outside, 'utf8').includes('Through the link.'), 'fillDone wrote through a symlink');
  const big = folder('big');
  const madeBig = projects.create({ name: 'Big', folder: big });
  fs.writeFileSync(path.join(big, projects.BRIEF_STUB_FILENAME), projects.BRIEF_DONE_PLACEHOLDER + '\n' + 'x'.repeat(300 * 1024));
  assert.equal(projects.get(madeBig.id, []).doneSet, null);
});

test('#4583 round 2: "PM" counts only as a whole role word; spelled-out forms count', () => {
  const r = projects.PROJECT_COORDINATOR;
  for (const yes of ['PM', 'Senior PM', 'Project Management Lead', 'Project-Manager', 'Program Manager', 'PM (delivery)']) assert.ok(r.test(yes), yes);
  for (const no of ['AM/PM Shift Lead', 'Post-PM Analyst', 'Marketing Manager', 'Product Manager', 'Tech Lead']) assert.ok(!r.test(no), no);
});

test('#4583 round 5: the create form routes EXACTLY cleanDone\'s refusals to the done box (coupled to the engine)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const m = page.match(/else if \(err && err\.message && (\/\^\(what done looks like[^\n]*?\$\/i)\.test\(err\.message\)\)/);
  assert.ok(m, 'the done-box route was not found on the page');
  const route = new Function('return ' + m[1])();
  const thrown = [() => projects.cleanDone({}), () => projects.cleanDone('x'.repeat(1001))].map((f) => { try { f(); } catch (e) { return e.message; } return null; });
  for (const said of thrown) assert.ok(said && route.test(said), 'an engine done refusal would miss the done box: ' + said);
  assert.ok(!route.test('that folder is already the project "What done looks like for Q4"'), 'a refusal quoting a project name was routed to the done box');
});
