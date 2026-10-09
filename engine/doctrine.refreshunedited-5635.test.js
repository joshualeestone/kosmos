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
  assert.match(line, /keeps this block up to date when the rules change while nobody has edited it, and asks first/);
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
    // an unedited plain copy beside an EDITED span: the replace carries the span's plan, edited (the case refreshUnedited
    // checks on every path)
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
  assert.match(born, /when it set up this agent\. Kosmos keeps this block up to date when the rules change while nobody has edited it, and asks first once someone has;/);
  assert.match(doctrine.spanBody(defaults.sections(), NOW), /with your OK\. Kosmos keeps this block up to date/);
  for (const t of [born, doctrine.autoLine(NOW)]) assert.ok(!t.includes('—') && !t.includes('–'), 'a dash');
});

test('#5635: the board brings every agent of ours up to date at start, and owes each one changed a re-read line', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('doctrine.refreshUnedited(a.sessionName, roster)');
  assert.ok(at > 0, 'the boot sweep no longer calls refreshUnedited');
  const near = src.slice(at, at + 300);
  assert.match(near, /got\.state === 'added'\) instructionRereadOwe\(a\.sessionName\)/, 'a changed agent is not owed the re-read line');
  assert.ok(src.lastIndexOf('a.isNamedOurs !== true', at) > src.lastIndexOf('kosmos#5635 F1', at), 'the sweep no longer skips agents that are not ours');
});
