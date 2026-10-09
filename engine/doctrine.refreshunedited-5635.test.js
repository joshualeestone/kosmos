'use strict';

/**
 * kosmos#5635 F1: an existing agent's working rules are brought current at board start, with no click, when what they
 * hold is Kosmos's own text, unedited (a span holding a known earlier block, or a plain unedited copy of one). Josh's
 * 2026-10-07 feedback found every agent on a test project still carrying a line fixed on main five days earlier,
 * because the refresh waited on a click nobody made. Everything else still waits for the click: a span the person
 * edited, a file with no rules block, and an agent whose person said Not now to this version.
 *
 *   node --test engine/doctrine.refreshunedited-5635.test.js
 */

// Both sandbox knobs BEFORE any require, travelling together per #527.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-doctrine-5635-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const defaults = require('./defaults');
const doctrine = require('./doctrine');
const store = require('./store');
const fleet = require('../test-support/fleet');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 8);
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const BLOCK = defaults.block();
// An earlier copy of the rules: today's with one sentence changed under an EXISTING heading, the shape of #5635's
// stale "reply has no --stdin" line (fixed on main, never reaching agents born before the fix).
const LINE = defaults.sections()[1].text.split('\n').find((l) => l.length > 20);
const OLD = BLOCK.replace(LINE, () => LINE + ' (an older wording)');   // a function: the rules contain `$`
const OLD_TABLE = [{ version: 1, length: OLD.length, sha256: sha(OLD) }];

function rosterOf(name) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const roster = board.agents;
  board.restore();
  return roster;
}
function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  return path.join(dir, 'CLAUDE.md');
}
const read = (f) => fs.readFileSync(f, 'utf8');
const run = (name, extra = {}) => doctrine.refreshUnedited(name, rosterOf(name), { now: NOW, past: OLD_TABLE, ...extra });

test('#5635 (the card): a changed section reaches an EXISTING agent\'s file with no click, and nothing outside the span moves', () => {
  const born = doctrine.atBirth('# Mine\n\nMy own words.\n', NOW).replace(BLOCK, () => OLD);
  const f = agentFile('unedited', born + '\nWords after.\n');
  store.writeProfile('unedited', { doctrineVersion: defaults.DOCTRINE_VERSION - 1 });
  const got = run('unedited');
  assert.equal(got.state, 'added', JSON.stringify(got));
  const now = read(f);
  assert.ok(now.includes(BLOCK) && !now.includes(OLD), 'the changed section did not reach the file');
  assert.ok(now.startsWith('# Mine\n\nMy own words.\n') && now.endsWith('\nWords after.\n'), 'the person\'s words moved');
  assert.equal(store.readProfile('unedited').doctrineVersion, defaults.DOCTRINE_VERSION, 'the agent is not recorded as current');
  assert.equal(run('unedited').state, 'current', 'a second pass wrote again');
  assert.equal(read(f), now, 'a no-op pass changed the file');
});

test('#5635: the file never claims an OK nobody gave: an automatic refresh writes its own frame line', () => {
  const f = agentFile('framed', doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD));
  assert.equal(run('framed').state, 'added');
  const line = read(f).split('\n').find((l) => l.startsWith('<!-- Kosmos added the working rules below on '));
  assert.equal(line, doctrine.autoLine(NOW));
  assert.ok(!/with your OK/.test(line), 'an automatic write said the person agreed');
  assert.match(line, /may bring this block up to date when the rules change while it is exactly as Kosmos wrote it, and asks first otherwise/);
  assert.equal(doctrine.planFor(read(f), NOW, OLD_TABLE).state, 'current', 'the new frame line is read as a change to the rules');
});

test('#5635: an unedited PLAIN copy of an earlier block is replaced too (it is Kosmos\'s own text)', () => {
  const f = agentFile('plainold', `# Mine\n\n${OLD}\n\nWords after.\n`);
  assert.equal(run('plainold').state, 'added');
  assert.ok(read(f).includes(BLOCK) && !read(f).includes(OLD));
  assert.ok(read(f).endsWith('\n\nWords after.\n'));
});

test('#5635: what still waits for the click is left byte for byte, and says why', () => {
  const cases = {
    // the person edited the span
    editedspan: doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD.replace(LINE, () => LINE + ' My own edit.')),
    // no rules block at all: sections would be added to the person's own text
    norules: '# Mine\n\nMy own words, no rules here.\n',
    // an unedited plain copy beside an EDITED span: left by the whole-block check on the span (review 3: not by `edited`)
    plainandedited: `# Mine\n\n${OLD}\n\n` + doctrine.atBirth('', NOW).replace(BLOCK, () => OLD.replace(LINE, () => LINE + ' Mine.')),
  };
  for (const [name, text] of Object.entries(cases)) {
    const f = agentFile(name, text);
    const got = run(name);
    assert.equal(got.state, 'left', `${name}: ${JSON.stringify(got)}`);
    assert.ok(got.because, `${name}: no reason given`);
    assert.equal(read(f), text, `${name}: the file was written`);
  }
  // CONTROL: the click still reaches the edited span, so the case above is left by this function and not unreachable.
  const plan = doctrine.planFor(read(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'editedspan', 'CLAUDE.md')), NOW, OLD_TABLE);
  assert.equal(plan.state, 'refresh');
  assert.equal(plan.edited, true);
});

test('#5635: a Not now for this version is honoured; a Not now for an earlier version is not', () => {
  const text = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const f = agentFile('declined', text);
  store.writeProfile('declined', { doctrineDeclined: defaults.DOCTRINE_VERSION });
  assert.equal(run('declined').state, 'left');
  assert.equal(read(f), text);
  store.writeProfile('declined', { doctrineDeclined: defaults.DOCTRINE_VERSION - 1 });
  assert.equal(run('declined').state, 'added', 'an old Not now still held back the new rules');
});

test('#5635: an agent that is not exactly ours is never written', () => {
  const text = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const f = agentFile('stranger', text);
  const got = doctrine.refreshUnedited('stranger', rosterOf('someoneelse'), { now: NOW, past: OLD_TABLE });
  assert.equal(got.state, 'could_not');
  assert.equal(read(f), text);
});

test('#5635: the birth and click frames say the same thing about keeping the block current', () => {
  const born = doctrine.atBirth('# Mine\n', NOW);
  assert.match(born, /when it set up this agent\. Kosmos may bring this block up to date when the rules change while it is exactly as Kosmos wrote it, and asks first otherwise;/);
  assert.match(doctrine.spanBody(defaults.sections(), NOW), /with your OK\. Kosmos may bring this block up to date/);
  for (const t of [born, doctrine.autoLine(NOW)]) assert.ok(!t.includes('—') && !t.includes('–'), 'a dash');
});

test('#5635 review 1 (the blocker): a section the person DELETED from the span, or sections reordered, are never put back without a click (real fingerprint table)', () => {
  const born = doctrine.atBirth('# Mine\n', NOW);   // the current block, framed
  const third = defaults.sections()[2].text;
  const deleted = born.replace(third + '\n', '');
  assert.notEqual(deleted, born, 'fixture: the section was not removed');
  const [s1, s2] = [defaults.sections()[1].text, defaults.sections()[2].text];
  const reordered = born.replace(s1 + '\n' + s2, () => s2 + '\n' + s1);
  assert.notEqual(reordered, born, 'fixture: the sections were not swapped');
  for (const [name, text] of [['deletedsection', deleted], ['reordered', reordered]]) {
    const f = agentFile(name, text);
    // CONTROL: the click still offers it (planFor, the real table), so it is this function that leaves it.
    assert.equal(doctrine.planFor(text, NOW).state, 'refresh', name + ': fixture is not a refresh case');
    const got = doctrine.refreshUnedited(name, rosterOf(name), { now: NOW });   // no `past`: the shipped table
    assert.equal(got.state, 'left', name + ': ' + JSON.stringify(got));
    assert.equal(read(f), text, name + ': the person\'s edit was undone');
  }
});

test('#5635 review 1: the board-start sweep refreshes every agent of ours, owes each one written, and skips the rest', () => {
  const oldText = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const ours = agentFile('fleetours', oldText);
  const stranger = agentFile('fleetstranger', oldText);
  const board = fleet.install([fleet.agent('fleetours', { state: 'idle' }), fleet.agent('fleetstranger', { state: 'idle' })]);
  const roster = board.agents.map((a) => (a.sessionName === 'fleetstranger' ? { ...a, isNamedOurs: false } : a));
  board.restore();
  const owed = [];
  const done = doctrine.refreshFleet(roster, (n) => owed.push(n), { now: NOW, past: OLD_TABLE });
  assert.deepEqual(done.map((d) => [d.sessionName, d.state]), [['fleetours', 'added']], JSON.stringify(done));
  assert.deepEqual(owed, ['fleetours'], 'the agent written was not owed the re-read line, or another was');
  assert.ok(read(ours).includes(BLOCK));
  assert.equal(read(stranger), oldText, 'an agent that is not ours was written');
  assert.deepEqual(doctrine.refreshFleet(roster, (n) => owed.push(n), { now: NOW, past: OLD_TABLE }).map((d) => d.state), ['current'], 'a second sweep wrote again');
  assert.deepEqual(owed, ['fleetours'], 'a sweep that wrote nothing owed a line');
  assert.deepEqual(doctrine.refreshFleet(null, () => owed.push('x')), [], 'an unreadable roster did something');
  // The board calls it at start with the re-read owe.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /doctrine\.refreshFleet\(safeRoster\(\), instructionRereadOwe\)/, 'the board no longer runs the sweep');
});

test('#5635 review 2: the person\'s words ON a marker line or INSIDE the frame comment, a span with Windows line endings, and a plain copy missing a section are left for the click', () => {
  const oldSpan = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const frame = oldSpan.split('\n').find((l) => l.startsWith('<!-- Kosmos added the working rules below on '));
  const heading3 = defaults.sections()[2].heading;
  const cases = {
    markertail: oldSpan.replace(doctrine.START, () => doctrine.START + ' MY NOTE'),
    framewords: oldSpan.replace(frame, () => frame.replace(' -->', ' and my own words -->')),
    crlfspan: oldSpan.replace(/\n/g, '\r\n'),
    sharedheading: `# Mine\n\n${heading3}\nMy own take on this.\n\n${OLD}\n`,
  };
  for (const [name, text] of Object.entries(cases)) {
    assert.notEqual(text, oldSpan, name + ': fixture did not change');
    const f = agentFile(name, text);
    // CONTROL: each is a refresh the click would offer.
    assert.equal(doctrine.planFor(text, NOW, OLD_TABLE).state, 'refresh', name + ': fixture is not a refresh case');
    const got = run(name);
    assert.equal(got.state, 'left', name + ': ' + JSON.stringify(got));
    assert.equal(read(f), text, name + ': written without a click');
  }
});

test('#5635 review 2: a span born under the OLD frame wording (before this change) is still Kosmos\'s own and is brought current', () => {
  const oldFrame = '<!-- Kosmos added the working rules below on 3 Oct 2026, when it set up this agent. Kosmos may update this block when the rules change, with your OK; your own words above and below it are never touched. -->';
  const born = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const now = born.split('\n').find((l) => l.startsWith('<!-- Kosmos added the working rules below on '));
  const text = born.replace(now, () => oldFrame);
  const f = agentFile('oldframe', text);
  assert.equal(run('oldframe').state, 'added');
  assert.ok(read(f).includes(BLOCK));
});

test('#5635 review 3: a person who puts the earlier rules back after the update keeps them (once per block, no loop)', () => {
  const oldText = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const f = agentFile('undone', oldText);
  assert.equal(run('undone').state, 'added', 'CONTROL: the first boot did not update it');
  fs.writeFileSync(f, oldText);   // the Instructions tab's previous version, saved by the person
  const again = run('undone');
  assert.equal(again.state, 'left', 'the person\'s restore was undone at the next boot: ' + JSON.stringify(again));
  assert.equal(read(f), oldText);
  // CONTROL: the click still offers it, so the person can change their mind.
  assert.equal(doctrine.planFor(read(f), NOW, OLD_TABLE).state, 'refresh');
});

test('#5635 review 3: a plain copy with a line the person typed under its last section is left; one ending cleanly is replaced', () => {
  const typed = `# Mine\n\n${OLD}\n- my own bullet under the last rule\n`;
  const f = agentFile('typedunder', typed);
  assert.equal(doctrine.planFor(typed, NOW, OLD_TABLE).replacing, true, 'fixture: the click would replace it');
  assert.equal(run('typedunder').state, 'left');
  assert.equal(read(f), typed);
  for (const [name, text] of [['endsfile', `# Mine\n\n${OLD}\n`], ['blankafter', `# Mine\n\n${OLD}\n\nMine after.\n`], ['headingafter', `# Mine\n\n${OLD}\n## My section\n`]]) {
    agentFile(name, text);
    assert.equal(run(name).state, 'added', name + ': a copy ending cleanly was not replaced');
  }
});

test('#5635 review 3: a span refreshed by a CLICK before this change (the old click frame) is still Kosmos\'s own', () => {
  const oldClick = '<!-- Kosmos added the working rules below on 24 Aug 2026, with your OK. Kosmos may update this block when the rules change; your own words above and below it are never touched. -->';
  const born = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const frame = born.split('\n').find((l) => l.startsWith('<!-- Kosmos added the working rules below on '));
  const f = agentFile('oldclick', born.replace(frame, () => oldClick));
  assert.equal(run('oldclick').state, 'added');
  assert.ok(read(f).includes(BLOCK));
});

test('#5635 review 4: once per BLOCK, not per version: a later block (a text fix inside the same version) still arrives', () => {
  const oldText = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const f = agentFile('withinversion', oldText);
  // An EARLIER block was written into this agent before, at the same DOCTRINE_VERSION (doctrine-past.js has several
  // rows for one version): the record names that block, not today's.
  // doctrineAuto is the field round 3's per-VERSION rule wrote (no code reads it now); with it here, that rule would refuse.
  store.writeProfile('withinversion', { doctrineVersion: defaults.DOCTRINE_VERSION, doctrineAuto: defaults.DOCTRINE_VERSION, doctrineWrote: sha('an earlier block of this same version') });
  assert.equal(run('withinversion').state, 'added', 'a newer block in the same version did not arrive');
  assert.ok(read(f).includes(BLOCK));
  assert.equal(store.readProfile('withinversion').doctrineWrote, sha(BLOCK), 'the record does not name the block written');
});

test('#5635 review 4: a restore after a CLICK holds too (the click records the block it wrote)', () => {
  const oldText = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const f = agentFile('clickthenrestore', oldText);
  const plan = doctrine.planFor(oldText, NOW, OLD_TABLE);
  assert.equal(doctrine.refresh('clickthenrestore', rosterOf('clickthenrestore'), { now: NOW, past: OLD_TABLE, expectHash: plan.hash }).state, 'added', 'CONTROL: the click did not write');
  fs.writeFileSync(f, oldText);   // the person restores the earlier rules
  assert.equal(run('clickthenrestore').state, 'left', 'the boot sweep overwrote a restore made after a click');
  assert.equal(read(f), oldText);
});

test('#5635 review 5: a plain copy with a typed line under it is left even when the file also has a whole known span', () => {
  const oldSpan = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const text = oldSpan + '\n' + OLD + '\n- my own bullet under the last rule\n';
  const f = agentFile('spanplustyped', text);
  assert.equal(doctrine.planFor(text, NOW, OLD_TABLE).state, 'refresh', 'fixture: the click would act');
  assert.equal(run('spanplustyped').state, 'left');
  assert.equal(read(f), text);
});

test('#5635 review 5: a write that fails after the record is tried again at the next boot, not read as a restore', () => {
  const oldText = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const f = agentFile('writefails', oldText);
  const instructions = require('./instructions');
  const real = instructions.write;
  instructions.write = () => { throw new Error('the disk said no'); };
  let first;
  try { first = run('writefails'); } finally { instructions.write = real; }
  assert.equal(first.state, 'could_not');
  assert.equal(read(f), oldText);
  assert.equal(run('writefails').state, 'added', 'the failed write was read as a restore at the next boot');
  assert.ok(read(f).includes(BLOCK));
});

test('#5635 review 5: a profile that exists but cannot be read stops the write, and keeps its Not now and its id', () => {
  const oldText = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const f = agentFile('badprofile', oldText);
  store.writeProfile('badprofile', { doctrineDeclined: defaults.DOCTRINE_VERSION });
  const pf = store.profilePath('badprofile');
  const good = fs.readFileSync(pf, 'utf8');
  fs.writeFileSync(pf, good.slice(0, -3));   // a torn write: not JSON
  const got = run('badprofile');
  assert.equal(got.state, 'could_not', JSON.stringify(got));
  assert.equal(read(f), oldText, 'the rules were written over an unread Not now');
  assert.equal(fs.readFileSync(pf, 'utf8'), good.slice(0, -3), 'the unreadable profile was replaced');
  fs.writeFileSync(pf, good);   // CONTROL: readable again, the Not now holds
  assert.equal(run('badprofile').state, 'left');
});

test('#5635 review 6: an agent with no instructions file is left quietly (nothing to bring up to date), never a failure', () => {
  const board = fleet.install([fleet.agent('nofileyet', { state: 'idle' })]);
  const roster = board.agents;
  board.restore();
  const done = doctrine.refreshFleet(roster, () => {}, { now: NOW, past: OLD_TABLE });
  assert.equal(done.length, 1);
  assert.equal(done[0].state, 'left', 'a missing file reads as a failure the board logs at every start: ' + JSON.stringify(done[0]));
});

test('#5635 review 6: a line starting with # that is not a heading, typed under the last section, is the person\'s', () => {
  const typed = `# Mine\n\n${OLD}\n#note to self\n`;
  const f = agentFile('hashnote', typed);
  assert.equal(run('hashnote').state, 'left');
  assert.equal(read(f), typed);
});

test('#5635 review 7: every frame Kosmos writes TODAY counts as its own (pasted as literals, so a change to the wording fails here)', () => {
  const K = 'Kosmos may bring this block up to date when the rules change while it is exactly as Kosmos wrote it, and asks first otherwise; your own words above and below it are never touched.';
  const today = [
    '<!-- Kosmos added the working rules below on 8 Oct 2026, with your OK. ' + K + ' -->',
    '<!-- Kosmos added the working rules below on 8 Oct 2026, when it set up this agent. ' + K + ' -->',
    '<!-- Kosmos added the working rules below on 8 Oct 2026, bringing its own earlier copy up to date. ' + K + ' -->',
  ];
  // The functions write exactly these (so the literals above are today's words, not a guess).
  assert.equal(doctrine.spanBody([], NOW).split('\n')[0], today[0]);
  assert.equal(doctrine.birthLine(NOW), today[1]);
  assert.equal(doctrine.autoLine(NOW), today[2]);
  const born = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const frame = born.split('\n').find((l) => l.startsWith('<!-- Kosmos added the working rules below on '));
  today.forEach((line, i) => {
    const name = 'todayframe' + i;
    const f = agentFile(name, born.replace(frame, () => line));
    assert.equal(run(name).state, 'added', 'a frame Kosmos writes today is not recognised as its own: ' + line.slice(0, 90));
    assert.ok(read(f).includes(BLOCK));
  });
});

test('#5635 review 7: two earlier plain copies, the second with a line typed under it, are left; a whole span plus one clean copy is updated', () => {
  const two = `# Mine\n\n${OLD}\n\n${OLD}\n- my own bullet under the last rule\n`;
  const f = agentFile('twocopies', two);
  assert.equal(run('twocopies').state, 'left');
  assert.equal(read(f), two);
  // CONTROL: one plain copy beside a whole known span (the span is not mistaken for a second copy).
  const span = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD);
  const g = agentFile('spanplusone', `${span}\n${OLD}\n`);
  assert.equal(run('spanplusone').state, 'added', 'a whole span beside one clean copy was left');
  assert.ok(read(g).includes(BLOCK) && !read(g).includes(OLD));
});

test('#5635 review 7: an instructions file that is there but cannot be read is a failure the board reports, not left quietly', () => {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'symlinked');
  fs.mkdirSync(dir, { recursive: true });
  const real = path.join(SANDBOX, 'elsewhere.md');
  fs.writeFileSync(real, doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => OLD));
  fs.symlinkSync(real, path.join(dir, 'CLAUDE.md'));
  const got = run('symlinked');
  assert.equal(got.state, 'could_not', JSON.stringify(got));
});

test('#5635 review 7: the re-read line about the rules never claims the person agreed', () => {
  const ir = require('./instructionreread');
  const src = fs.readFileSync(path.join(__dirname, 'instructionreread.js'), 'utf8');
  const rulesLine = /rules: '([^']*)'/.exec(src);
  assert.ok(rulesLine, 'CONTROL: the rules entry was not found, so this checks nothing');
  assert.doesNotMatch(rulesLine[1], /OK|consent|agreed|approv/i);
  assert.ok(ir, 'module loads');
});

test('#5635 review 8: an update of a span that would leave out a section (the person has that heading outside) waits for the click', () => {
  const last = defaults.sections()[defaults.sections().length - 1];
  const olderBlock = defaults.sections().slice(0, -1).map((x) => x.text).join('\n');   // an earlier block without the newest section
  const table = [{ version: 1, length: olderBlock.length, sha256: sha(olderBlock) }];
  const born = doctrine.atBirth('# Mine\n', NOW).replace(BLOCK, () => olderBlock);
  const text = born + `\n${last.heading}\nMy own words under this heading.\n`;
  const f = agentFile('sharednewest', text);
  const plan = doctrine.planFor(text, NOW, table);
  assert.equal(plan.state, 'refresh');
  assert.ok(plan.sections.length < defaults.sections().length, 'fixture: the plan does not leave a section out');
  const got = doctrine.refreshUnedited('sharednewest', rosterOf('sharednewest'), { now: NOW, past: table });
  assert.equal(got.state, 'left', JSON.stringify(got));
  assert.equal(read(f), text);
});

test('#5635 review 8: the span offset after a cut (a copy BEFORE the span) and a current copy beside an old one', () => {
  const span = doctrine.atBirth('', NOW).replace(BLOCK, () => OLD);
  const before = `# Mine\n\n${OLD}\n\n${span}\n`;
  const a = agentFile('copybefore', before);
  assert.equal(run('copybefore').state, 'added', 'a copy before a whole span was left (the span was read as a second copy)');
  assert.ok(read(a).includes(BLOCK) && !read(a).includes(OLD));
  const thenTyped = `# Mine\n\n${OLD}\n\n${span}\n\n${OLD}\n- typed\n`;
  const b = agentFile('copyspancopy', thenTyped);
  assert.equal(run('copyspancopy').state, 'left');
  assert.equal(read(b), thenTyped);
  const withCurrent = `# Mine\n\n${OLD}\n\n# mine\n\n${BLOCK}\n`;
  const c = agentFile('oldandcurrent', withCurrent);
  assert.equal(run('oldandcurrent').state, 'left', 'an old copy beside today\'s own was cut with no click');
  assert.equal(read(c), withCurrent);
});
