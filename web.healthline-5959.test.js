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
const { healthLine, seenAtWords } = new Function(src('seenAtWords') + PAGE.match(/\nconst HEALTH_READ_STATES = [^\n]*\n/)[0] + src('healthLine') + '\nreturn { healthLine, seenAtWords };')();
const NOW = Date.parse('2026-10-12T17:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('#5959 slice 2: the health line says sign-in, usage and when Kosmos last saw it working', () => {
  const clock = (ms) => new Date(ms).toLocaleString([], { hour: 'numeric', minute: '2-digit' });
  const at5 = NOW - 5 * 60e3;
  assert.equal(healthLine({ state: 'idle', lastWorked: { at: new Date(at5).toISOString(), why: null } }, NOW),
    'Sign-in: no problem showing · Usage: no limit showing · Last seen working: ' + clock(at5));
  const seen = { at: new Date(at5).toISOString(), why: null };
  const never = { at: null, why: 'not_seen' };
  // A screen reading is hedged, as the state sentence is (#215); the agent's own report is not.
  assert.equal(healthLine({ state: 'auth_failed', stateConfidence: 'scraped', lastWorked: seen }, NOW),
    'Sign-in: looks like it isn\'t working · Usage: no limit showing · Last seen working: ' + clock(at5));
  assert.equal(healthLine({ state: 'auth_failed', stateConfidence: 'structured', lastWorked: seen }, NOW),
    'Sign-in: isn\'t working · Usage: no limit showing · Last seen working: ' + clock(at5));
  assert.equal(healthLine({ state: 'rate_limited', stateConfidence: 'scraped', lastWorked: seen }, NOW),
    'Sign-in: no problem showing · Usage: looks like a limit · Last seen working: ' + clock(at5));
  assert.equal(healthLine({ state: 'rate_limited', stateConfidence: 'structured', lastWorked: seen }, NOW),
    'Sign-in: no problem showing · Usage: limit reached · Last seen working: ' + clock(at5));
  // Never seen working: a problem the state shows is still said, but "no problem" is not (it would rest on an absence).
  assert.equal(healthLine({ state: 'auth_failed', stateConfidence: 'scraped', lastWorked: never }, NOW),
    'Sign-in: looks like it isn\'t working · Last seen working: not since Kosmos started');
  assert.equal(healthLine({ state: 'rate_limited', stateConfidence: 'structured', lastWorked: never }, NOW),
    'Usage: limit reached · Last seen working: not since Kosmos started');
  assert.equal(healthLine({ state: 'idle', lastWorked: never }, NOW), 'Last seen working: not since Kosmos started');
  assert.equal(healthLine({ state: 'working', lastWorked: { at: null, why: 'no_source' } }, NOW),
    'Last seen working: Kosmos cannot see this agent\'s turns');
  // Stopped, restarting or unreadable: Kosmos sees nothing of its sign-in or usage, so only the time is said. Blocked
  // too: a Claude card stays blocked on Claude Code's own report of a refused sign-in or a usage cap.
  for (const state of ['stopped', 'restarting', 'unknown', 'blocked']) {
    assert.equal(healthLine({ state, lastWorked: { at: null, why: 'not_seen' } }, NOW), 'Last seen working: not since Kosmos started', state);
  }
  // A clock time, not "N minutes ago": the page is painted once, so a relative time would go stale while it is open.
  // Not today: the weekday too; over six days: the date.
  const day = 86400e3;
  assert.equal(seenAtWords(NOW - 2 * day, NOW), new Date(NOW - 2 * day).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }));
  assert.equal(seenAtWords(NOW - 9 * day, NOW), new Date(NOW - 9 * day).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
  assert.equal(seenAtWords(at5, NOW), clock(at5), 'CONTROL: today is the time alone');
});

test('#5959 slice 2: no line for a card with no lastWorked, and the page paints it into its own element', () => {
  for (const a of [{ state: 'idle' }, { state: 'idle', lastWorked: null }, null, undefined]) assert.equal(healthLine(a, NOW), '', JSON.stringify(a));
  assert.equal((PAGE.match(/id="d-health"/g) || []).length, 1, 'the page has no single d-health element');
  assert.match(PAGE, /getElementById\('d-health'\)[\s\S]{0,200}healthLine\(a, Date\.now\(\)\)/, 'nothing paints healthLine into d-health');
  // A provider switch repaints the open page for the new runner; the health line spoke for the old one, so it goes.
  assert.match(PAGE, /CURRENT\.lastWorked = null;\s*\{ const dh = document\.getElementById\('d-health'\); if \(dh\) \{ dh\.textContent = ''; dh\.hidden = true; \} \}/, 'the switch path leaves the old runner\'s health line');
});
