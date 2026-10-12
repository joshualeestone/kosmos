'use strict';
/* #5959 slice 2: the agent's page carries one health line: sign-in, usage, and when it last worked, from the card's
 * state and its lastWorked (engine/status.js lastWorkedOf). No line for a card with no lastWorked.
 * The page's own functions, lifted out of index.html and run.
 *   node --test web.healthline-5959.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function src(name) {
  const m = PAGE.match(new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
  assert.ok(m, 'CONTROL: ' + name + ' was not found in the page');
  return m[0];
}
const healthLine = new Function(src('agoWords') + src('healthLine') + '\nreturn healthLine;')();
const NOW = Date.parse('2026-10-12T17:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('#5959 slice 2: the health line says sign-in, usage and when it last worked', () => {
  assert.equal(healthLine({ state: 'idle', lastWorked: { at: ago(5 * 60e3), why: null } }, NOW),
    'Sign-in: no problem seen · Usage: no limit seen · Last worked: 5 minutes ago');
  assert.equal(healthLine({ state: 'auth_failed', lastWorked: { at: ago(3 * 3600e3), why: null } }, NOW),
    'Sign-in: isn\'t working · Usage: no limit seen · Last worked: 3 hours ago');
  assert.equal(healthLine({ state: 'rate_limited', lastWorked: { at: null, why: 'not_seen' } }, NOW),
    'Sign-in: no problem seen · Usage: limit reached · Last worked: not seen since Kosmos started');
  assert.equal(healthLine({ state: 'working', lastWorked: { at: null, why: 'no_source' } }, NOW),
    'Sign-in: no problem seen · Usage: no limit seen · Last worked: Kosmos cannot see this agent\'s turns yet');
  // A time a little ahead of this computer's clock is now, never a blank.
  assert.match(healthLine({ state: 'working', lastWorked: { at: new Date(NOW + 2000).toISOString(), why: null } }, NOW), /Last worked: just now$/);
});

test('#5959 slice 2: no line for a card with no lastWorked, and the page paints it into its own element', () => {
  for (const a of [{ state: 'idle' }, { state: 'idle', lastWorked: null }, null, undefined]) assert.equal(healthLine(a, NOW), '', JSON.stringify(a));
  assert.equal((PAGE.match(/id="d-health"/g) || []).length, 1, 'the page has no single d-health element');
  assert.match(PAGE, /getElementById\('d-health'\)[\s\S]{0,200}healthLine\(a, Date\.now\(\)\)/, 'nothing paints healthLine into d-health');
});
