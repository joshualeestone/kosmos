'use strict';
/**
 * #3734: an existing setup guide was born told it never creates agents. refreshGuideRole replaces that
 * paragraph, once, in the marked guide folder only.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-role-')));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const sa = require('./setup-assistant');
const roles = require('./roles');
const instructions = require('./instructions');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function seed(name, text) {
  const file = instructions.fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
const BEFORE = ['# You are Josh\'s AI', '', '## How you work', '', '- Answer the question they asked, briefly, then offer the one next step.',
  ...roles.HANDS_OFF_LINES_BEFORE_3734, '', '## Which screen they are on', '', 'Kosmos tells you which screen the person is on.', ''].join('\n');

test('#3734 an existing guide\'s "never create agents" paragraph is replaced once with the current lines', () => {
  const file = seed('guidea', BEFORE);
  assert.deepEqual(sa.refreshGuideRole({ name: 'guidea', isGuide: () => true }), { changed: true });
  const after = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(after, /never create agents/, 'the old paragraph survived');
  assert.ok(after.includes(roles.MAKE_AGENTS_LINES.join('\n')), 'the make-agents lines were not written');
  assert.ok(after.includes(roles.HANDS_OFF_LINES.join('\n')), 'settings stopped being hands-off');
  assert.match(after, /## Which screen they are on/, 'the rest of the file was not kept');
  assert.deepEqual(sa.refreshGuideRole({ name: 'guidea', isGuide: () => true }), { changed: false }, 'a second run changed it again');
});

test('#3734 an agent that is not the marked guide is never rewritten', () => {
  const file = seed('notguide', BEFORE);
  assert.deepEqual(sa.refreshGuideRole({ name: 'notguide', isGuide: () => false }), { changed: false });
  assert.equal(fs.readFileSync(file, 'utf8'), BEFORE, 'a non-guide agent\'s instructions were edited');
  assert.deepEqual(sa.refreshGuideRole({ name: null, isGuide: () => true }), { changed: false }, 'no guide name, and something was written');
});

test('#3734 a guide whose instructions the person reworded is left alone', () => {
  const edited = BEFORE.replace('you never create agents for', 'you never ever create agents for');
  const file = seed('guideb', edited);
  assert.deepEqual(sa.refreshGuideRole({ name: 'guideb', isGuide: () => true }), { changed: false });
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
});
