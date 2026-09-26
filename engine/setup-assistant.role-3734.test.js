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

/* #3947: an existing guide still carries the "say so the first time" paragraph; replace it once. */
const BORN_3034 = ['# You are Josh', '', '## Who you are', '', ...roles.WHO_YOU_ARE_LINES_BEFORE_3947, '', '## How you work', '',
  '- Answer the question they asked, briefly, then offer the one next step.', ''].join('\n');

test('#3947 the paragraph refreshGuideRole looks for is the text guides were actually born with', () => {
  // A literal copy of what instructionsFor('setup') wrote from 1f47aa227 (#3666) until #3947, the only form it ever
  // had. The fixtures below are built from the constant, so without this a typo in it would pass them all and
  // migrate no real guide.
  assert.equal(roles.WHO_YOU_ARE_LINES_BEFORE_3947.join('\n'), [
    'You speak as the builder: "I built Kosmos, let me help you get set up." You',
    'know why each part is there, and you enjoy showing it. But you are an AI,',
    'not Josh typing live, and you say so the first time you talk to someone and',
    'whenever they seem to think otherwise. Never claim to be the real person,',
    'never promise that Josh will read something or get back to them, and never',
    'speak for him on anything beyond how Kosmos works.',
  ].join('\n'));
});

test('#3947 an existing guide\'s first-answer AI note paragraph is replaced once, and nothing else moves', () => {
  const file = seed('guidec', BORN_3034);
  assert.deepEqual(sa.refreshGuideRole({ name: 'guidec', isGuide: () => true }), { changed: true });
  const after = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(after, /you say so the first time you talk to someone/, 'the old paragraph survived');
  assert.equal(after, BORN_3034.replace(roles.WHO_YOU_ARE_LINES_BEFORE_3947.join('\n'), roles.WHO_YOU_ARE_LINES.join('\n')));
  assert.deepEqual(sa.refreshGuideRole({ name: 'guidec', isGuide: () => true }), { changed: false }, 'a second run changed it again');
});

test('#3947 a guide born before #3734 gets both paragraphs replaced', () => {
  const both = BEFORE.replace('## How you work', ['## Who you are', '', ...roles.WHO_YOU_ARE_LINES_BEFORE_3947, '', '## How you work'].join('\n'));
  const file = seed('guided', both);
  assert.deepEqual(sa.refreshGuideRole({ name: 'guided', isGuide: () => true }), { changed: true });
  const after = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(after, /never create agents/);
  assert.doesNotMatch(after, /you say so the first time you talk to someone/);
  assert.ok(after.includes(roles.WHO_YOU_ARE_LINES.join('\n')));
  assert.ok(after.includes(roles.MAKE_AGENTS_LINES.join('\n')));
  assert.ok(after.includes(roles.HANDS_OFF_LINES.join('\n')), 'settings stopped being hands-off');
});

test('#3947 a guide whose "Who you are" paragraph the person reworded is left alone', () => {
  const edited = BORN_3034.replace('whenever they seem to think otherwise', 'whenever they seem confused');
  const file = seed('guidee', edited);
  assert.deepEqual(sa.refreshGuideRole({ name: 'guidee', isGuide: () => true }), { changed: false });
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
});
