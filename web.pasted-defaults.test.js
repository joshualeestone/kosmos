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

test('the sentence sits under the instructions box, once, with a Show them fold whose text starts empty', () => {
  const at = PAGE.indexOf('<textarea id="create-instr"');
  const box = PAGE.slice(at, at + 1400);
  assert.match(box, /id="create-instr-defaults">Whatever you write here, your agent also gets Kosmos's working rules: keep going until finished, report what happened, ask before anything it cannot take back\./);
  assert.match(box, /<summary class="linkish">Show them<\/summary>/);
  assert.match(box, /<pre class="instr-defaults-text" id="create-instr-defaults-text"><\/pre>/, 'the fold carries words the engine did not serve');
  assert.equal((PAGE.match(/id="create-instr-defaults"/g) || []).length, 1);
});

test('the words come from the engine: the route serves the block and the page writes it into the fold', () => {
  assert.match(SERVER, /defaults: require\('\.\/engine\/defaults'\)\.block\(\),/);
  const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
  const at = SCRIPT.indexOf("OWN_ROLE = (data && data.own) || null;");
  assert.ok(at > -1, 'the roles loader moved; re-anchor');
  const after = SCRIPT.slice(at, at + 900);
  assert.match(after, /data\.defaults === 'string' \? data\.defaults\.trim\(\) : ''/);
  assert.match(after, /pre\.textContent = words/);
  assert.match(after, /fold\.hidden = !words/, 'an older engine with no defaults field would show an empty fold');
  assert.doesNotMatch(PAGE, /You keep working until the task is finished/, 'the page carries its own copy of the block');
  assert.match(DEFAULTS, /You keep working until the task is finished/);
});

test('no em dash in the sentence a person reads', () => {
  const at = PAGE.indexOf('id="create-instr-defaults"');
  assert.doesNotMatch(PAGE.slice(at, at + 600), /—/);
});
