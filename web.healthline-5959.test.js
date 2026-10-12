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
const { healthLine, seenAtWords } = new Function(src('seenAtWords') + PAGE.match(/\nconst HEALTH_QUIET_MS = [^\n]*\n/)[0] + PAGE.match(/\nconst HEALTH_READ_STATES = [^\n]*\n/)[0] + src('healthLine') + '\nreturn { healthLine, seenAtWords };')();
const NOW = Date.parse('2026-10-12T17:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('#5959 slice 2: the health line says sign-in, usage and when Kosmos last saw it working', () => {
  const clock = (ms) => new Date(ms).toLocaleString([], { hour: 'numeric', minute: '2-digit' });
  const at5 = NOW - 5 * 60e3;
  assert.equal(healthLine({ state: 'idle', runner: 'claude', lastWorked: { at: new Date(at5).toISOString(), why: null } }, NOW),
    'Sign-in: no problem showing · Usage: no limit showing · Last seen working: ' + clock(at5));
  const seen = { at: new Date(at5).toISOString(), why: null };
  const never = { at: null, why: 'not_seen' };
  // A screen reading is hedged, as the state sentence is (#215); the agent's own report is not.
  assert.equal(healthLine({ state: 'auth_failed', stateConfidence: 'scraped', runner: 'claude', lastWorked: seen }, NOW),
    'Sign-in: looks like it isn\'t working · Usage: no limit showing · Last seen working: ' + clock(at5));
  assert.equal(healthLine({ state: 'auth_failed', stateConfidence: 'structured', runner: 'claude', lastWorked: seen }, NOW),
    'Sign-in: isn\'t working · Usage: no limit showing · Last seen working: ' + clock(at5));
  assert.equal(healthLine({ state: 'rate_limited', stateConfidence: 'scraped', runner: 'claude', lastWorked: seen }, NOW),
    'Sign-in: no problem showing · Usage: looks like a limit · Last seen working: ' + clock(at5));
  assert.equal(healthLine({ state: 'rate_limited', stateConfidence: 'structured', runner: 'claude', lastWorked: seen }, NOW),
    'Sign-in: no problem showing · Usage: limit reached · Last seen working: ' + clock(at5));
  // Never seen working: a problem the state shows is still said, but "no problem" is not (it would rest on an absence).
  assert.equal(healthLine({ state: 'auth_failed', stateConfidence: 'scraped', lastWorked: never }, NOW),
    'Sign-in: looks like it isn\'t working · Last seen working: not seen since Kosmos started');
  assert.equal(healthLine({ state: 'rate_limited', stateConfidence: 'structured', lastWorked: never }, NOW),
    'Usage: limit reached · Last seen working: not seen since Kosmos started');
  assert.equal(healthLine({ state: 'idle', lastWorked: never }, NOW), 'Last seen working: not seen since Kosmos started');
  assert.equal(healthLine({ state: 'working', lastWorked: { at: null, why: 'no_source' } }, NOW),
    'Last seen working: Kosmos cannot see this agent\'s turns');
  // Stopped, restarting or unreadable: Kosmos sees nothing of its sign-in or usage, so only the time is said. Blocked
  // too: a Claude card stays blocked on Claude Code's own report of a refused sign-in or a usage cap.
  for (const state of ['stopped', 'restarting', 'unknown', 'blocked', 'connection_lost']) {
    assert.equal(healthLine({ state, lastWorked: { at: new Date(at5).toISOString(), why: null } }, NOW), 'Last seen working: ' + clock(at5), state);
  }
  // Sign-in "no problem" only for Claude: another runner's state cannot show a sign-in that stopped working here.
  for (const runner of ['codex', 'gemini', 'grok']) {
    assert.equal(healthLine({ state: 'idle', runner, lastWorked: seen }, NOW), 'Usage: no limit showing · Last seen working: ' + clock(at5), runner);
    assert.match(healthLine({ state: 'auth_failed', runner, stateConfidence: 'structured', lastWorked: seen }, NOW), /^Sign-in: isn't working · /, runner + ': a problem is still said');
  }
  assert.match(healthLine({ state: 'idle', runner: 'claude', lastWorked: seen }, NOW), /^Sign-in: no problem showing · /, 'CONTROL: a Claude card');
  // No runner field (an older card): not said, since only Claude's state can show a dead sign-in.
  assert.equal(healthLine({ state: 'idle', lastWorked: seen }, NOW), 'Usage: no limit showing · Last seen working: ' + clock(at5));
  // Seen working over an hour ago: a sign-in may have lapsed since, so "no problem" is not said; a problem still is.
  const old = { at: new Date(NOW - 2 * 3600e3).toISOString(), why: null };
  assert.equal(healthLine({ state: 'idle', runner: 'claude', lastWorked: old }, NOW), 'Last seen working: ' + clock(NOW - 2 * 3600e3));
  assert.match(healthLine({ state: 'auth_failed', runner: 'claude', stateConfidence: 'structured', lastWorked: old }, NOW), /^Sign-in: isn't working · Last seen working: /);
  const edge = { at: new Date(NOW - 3600e3).toISOString(), why: null };
  assert.match(healthLine({ state: 'idle', runner: 'claude', lastWorked: edge }, NOW), /^Sign-in: no problem showing · /, 'CONTROL: exactly an hour ago still counts');
  // A clock time, not "N minutes ago": an idle card's line changes rarely, so a relative time would age.
  // Not today: the weekday too; over six days: the date.
  const day = 86400e3;
  assert.equal(seenAtWords(NOW - 2 * day, NOW), new Date(NOW - 2 * day).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }));
  assert.equal(seenAtWords(NOW - 9 * day, NOW), new Date(NOW - 9 * day).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
  assert.equal(seenAtWords(at5, NOW), clock(at5), 'CONTROL: today is the time alone');
});

test('#5959 slice 2: no line for a card with no lastWorked, and the page paints it into its own element', () => {
  for (const a of [{ state: 'idle' }, { state: 'idle', lastWorked: null }, null, undefined]) assert.equal(healthLine(a, NOW), '', JSON.stringify(a));
  assert.equal((PAGE.match(/id="d-health"/g) || []).length, 1, 'the page has no single d-health element');
  // Painted by paintDetailState, which openDetail and the poll both call, so the line follows the state pill.
  const paint = src('paintDetailState');
  assert.match(paint, /getElementById\('d-health'\)[\s\S]{0,200}healthLine\(a, Date\.now\(\)\)/, 'paintDetailState does not paint the health line');
  assert.equal((PAGE.match(/healthLine\(a, Date\.now\(\)\)/g) || []).length, 1, 'the health line is painted somewhere else as well');
});
