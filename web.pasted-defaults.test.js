'use strict';
/**
 * #591: told before the write. Whatever a person writes in the instructions
 * box, the working rules follow it under their own heading; the form says so
 * under the box and shows them, and the words it shows are the engine's
 * (/api/roles `defaults`), never a copy kept in the page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const DEFAULTS = fs.readFileSync(path.join(__dirname, 'engine', 'defaults.js'), 'utf8');

test('#739: the block under the instructions box is gone, and so is the role caution line on this step', () => {
  // Josh, 2026-08-24 21:16: "I just want it to be our nice simple instruction
  // box, the checkbox for 'Let the Kosmos team know you created an agent,' and
  // the 'Create an agent' button. That's it." The explanation went; the rules
  // did not (next test).
  assert.doesNotMatch(PAGE, /id="create-instr-defaults"/);
  assert.doesNotMatch(PAGE, /Whatever you write here, your agent also gets Kosmos's working rules/);
  assert.doesNotMatch(PAGE, /id="create-limit"/);
  assert.doesNotMatch(PAGE, /getElementById\('create-limit'\)/);
  assert.doesNotMatch(PAGE, /getElementById\('create-instr-defaults-text'\)/);
  const at = PAGE.indexOf('id="create-instr"');
  const step = PAGE.slice(at, PAGE.indexOf('id="create-msg"', at));
  assert.match(step, /id="create-tell"/); assert.match(step, /id="create-go"/);
  assert.ok(step.indexOf('id="create-tell"') < step.indexOf('id="create-go"'));
});

test('the rules still reach the agent: the engine serves and writes them, and the page carries no copy', () => {
  assert.match(SERVER, /defaults: require\('\.\/engine\/defaults'\)\.block\(\),/);
  assert.doesNotMatch(PAGE, /You keep working until the task is finished/, 'the page carries its own copy of the block');
  assert.match(DEFAULTS, /You keep working until the task is finished/);
});
