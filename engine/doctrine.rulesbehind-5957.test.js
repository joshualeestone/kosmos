'use strict';
/**
 * kosmos#5957 slice 2: doctrine.rulesBehind, the number a card shows when an agent's working rules are far behind.
 *
 *   node --test engine/doctrine.rulesbehind-5957.test.js
 */
// Both sandbox knobs BEFORE any require, travelling together per #527.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-rulesbehind-5957-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const defaults = require('./defaults');
const store = require('./store');
const instructions = require('./instructions');
const doctrine = require('./doctrine');

const DV = defaults.DOCTRINE_VERSION;
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const NOW = new Date(2026, 9, 12);
function agent(name, profile, text) {
  store.writeProfile(name, { provider: 'anthropic', ...profile });
  const file = instructions.fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
const OLD_FILE = (n) => `# ${n}\n\nYou are **${n}**, an assistant.\n`;   // no working-rules block: its page offers them

test('far behind, and its page offers the update: the card gets the number', () => {
  agent('stale', { doctrineVersion: DV - 13 }, OLD_FILE('Stale'));
  assert.equal(doctrine.status('stale').state, 'refresh', 'fixture: its own page would not offer the update');
  assert.equal(doctrine.rulesBehind('stale'), 13);
  // The row passes its own profile read; the answer is the same.
  assert.equal(doctrine.rulesBehind('stale', store.readProfile('stale')), 13);
});

test('the threshold: RULES_FAR_BEHIND behind counts, one fewer does not', () => {
  agent('edge', { doctrineVersion: DV - doctrine.RULES_FAR_BEHIND }, OLD_FILE('Edge'));
  assert.equal(doctrine.rulesBehind('edge'), doctrine.RULES_FAR_BEHIND);
  agent('near', { doctrineVersion: DV - (doctrine.RULES_FAR_BEHIND - 1) }, OLD_FILE('Near'));
  assert.equal(doctrine.rulesBehind('near'), null);
});

test('no claim without a record, and none after the person said Not now to this version', () => {
  agent('unknown', {}, OLD_FILE('Unknown'));
  assert.equal(doctrine.rulesBehind('unknown'), null);
  agent('declined', { doctrineVersion: DV - 13, doctrineDeclined: DV }, OLD_FILE('Declined'));
  assert.equal(doctrine.rulesBehind('declined'), null);
});

test('the card agrees with the page: rules already current in the file (a person edited them in) say nothing', () => {
  agent('edited', { doctrineVersion: DV - 13 }, doctrine.atBirth(OLD_FILE('Edited'), NOW));
  assert.equal(doctrine.status('edited').state, 'current', 'fixture: the file does not read as current');
  assert.equal(doctrine.rulesBehind('edited'), null);
});

test('kept between polls, and recomputed when the file changes', () => {
  const file = agent('moving', { doctrineVersion: DV - 13 }, OLD_FILE('Moving'));
  assert.equal(doctrine.rulesBehind('moving'), 13);
  // The rules arrive in the file (the record unchanged): the next poll must see it.
  fs.writeFileSync(file, doctrine.atBirth(OLD_FILE('Moving'), NOW));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  assert.equal(doctrine.rulesBehind('moving'), null, 'a stale answer outlived the file change');
});

test('the cache saves work: unchanged polls read the instructions file once', (t) => {
  agent('steady', { doctrineVersion: DV - 13 }, OLD_FILE('Steady'));
  const real = instructions.read;
  let reads = 0;
  instructions.read = (...args) => { reads += 1; return real.apply(instructions, args); };
  t.after(() => { instructions.read = real; });
  for (let i = 0; i < 5; i++) assert.equal(doctrine.rulesBehind('steady'), 13);
  assert.equal(reads, 1, 'every poll re-read and re-planned the file');
});

test('never throws: no instructions file is null', () => {
  store.writeProfile('nofile', { provider: 'anthropic', doctrineVersion: DV - 13 });
  assert.equal(doctrine.rulesBehind('nofile'), null);
});
