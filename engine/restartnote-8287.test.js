'use strict';
/**
 * kosmos#8287: the restart note says what was checked, and what was not fine. engine/restartnote.js; the route is in
 * server.restartnote-8287.test.js and the words in docs/browser-checks/render-reboot-note-5359.js.
 *
 *   node --test engine/restartnote-8287.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-restartnote-8287-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const rn = require('./restartnote');
const storecheck = require('./storecheck');

const MIN = 60 * 1000;
const NOW = Date.parse('2026-11-08T19:22:00Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const up = (minutes) => minutes * 60;
const card = (sessionName, name, extra) => ({ sessionName, name, isAgentSession: true, isNamedOurs: true, state: 'idle', ...extra });
const was = (...names) => names.map((n) => ({ session: n, name: n[0].toUpperCase() + n.slice(1) }));

function clean() {
  fs.rmSync(path.dirname(rn._files.aliveFile()), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(rn._files.aliveFile()), { recursive: true });
  rn.noteRunning(null);
}
function aliveWith(fields) { fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: at(8 * MIN), ...fields })); }

test('#8287: the note keeps who was running when the board went down, and the page is told only what was checked', () => {
  clean();
  aliveWith({ running: was('leo', 'homer') });
  const note = rn.atStart({ now: () => NOW, uptime: () => up(6), files: { checked: true, damaged: 0 } });
  assert.deepEqual(note.wereRunning, was('leo', 'homer'), 'the list was overwritten before it was read');
  assert.deepEqual(note.files, { damaged: 0 });
  assert.deepEqual(rn.current(NOW + MIN), note, 'the page reads something other than what the start kept');
});

test('#8287: a part that could not be checked is absent, never reported as fine', () => {
  clean();
  aliveWith({});   // CONTROL below: an older board's record has no list
  const note = rn.atStart({ now: () => NOW, uptime: () => up(6), files: { checked: false } });
  assert.ok(note, 'CONTROL: this should have made a note');
  assert.equal('wereRunning' in note, false, 'a record with no list claimed one');
  assert.equal('files' in note, false, 'a file check that did not finish was reported');
  assert.deepEqual(rn.checksFor(note, [card('leo', 'Leo')], []), {}, 'nothing was read, so nothing may be said');
  assert.deepEqual(rn.checksFor(null, [], []), {});
});

test('#8287: agents come from who was running, so one a person stopped earlier is not "not back"', () => {
  const note = { wereRunning: was('leo') };
  const roster = [card('leo', 'Leo'), card('april', 'April', { state: 'stopped' })];
  assert.deepEqual(rn.checksFor(note, roster, []).agents, { was: 1, back: 1, notBack: [] });
});

test('#8287: an agent that was running and is stopped, or missing from the roster, is named; only a removal excuses it', () => {
  const note = { wereRunning: was('leo', 'homer', 'april') };
  const roster = [card('leo', 'Leo'), card('homer', 'Homer P', { state: 'stopped' })];
  assert.deepEqual(rn.checksFor(note, roster, []).agents, { was: 3, back: 1, notBack: ['Homer P', 'April'] }, 'stopped uses the card\'s name; missing uses the recorded one');
  assert.deepEqual(rn.checksFor(note, roster, ['april']).agents, { was: 2, back: 1, notBack: ['Homer P'] }, 'a removed agent still counted');
});

test('#8287: an unreadable roster says nothing about agents rather than calling them all not back', () => {
  assert.equal('agents' in rn.checksFor({ wereRunning: was('leo') }, null, []), false);
});

test('#8287: a pane that is not one of our agents is not "up"', () => {
  const note = { wereRunning: was('leo') };
  assert.deepEqual(rn.checksFor(note, [card('leo', 'Leo', { isNamedOurs: false })], []).agents.notBack, ['Leo']);
});

test('#8287: the beat records who is up, once a roster read has succeeded, and keeps it through a failed read', () => {
  clean();
  rn.beat(NOW);
  assert.equal('running' in JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')), false, 'claimed a list before any read');
  rn.noteRunning([card('leo', 'Leo'), card('april', 'April', { state: 'stopped' })]);
  rn.beat(NOW);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running, [{ session: 'leo', name: 'Leo' }]);
  rn.noteRunning(null);   // a failed snapshot
  rn.beat(NOW + MIN);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running, [{ session: 'leo', name: 'Leo' }], 'a failed read wiped the list');
  rn.noteRunning([]);     // a real empty roster is a real answer
  rn.beat(NOW + 2 * MIN);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running, []);
});

test('#8287: a damaged record cannot put junk in the note', () => {
  clean();
  aliveWith({ running: [{ session: 'leo', name: 7 }, 'x', null, { name: 'no session' }] });
  const note = rn.atStart({ now: () => NOW, uptime: () => up(6), files: { checked: true, damaged: -1 } });
  assert.deepEqual(note.wereRunning, [{ session: 'leo', name: 'leo' }]);
  assert.equal('files' in note, false);
  clean();
  aliveWith({ running: 'not a list' });
  assert.equal('wereRunning' in rn.atStart({ now: () => NOW, uptime: () => up(6) }), false);
});

test('#8287: on Windows the logon task counts as the supervisor; nothing else does', () => {
  assert.equal(rn.whoStarted({ platform: 'win32', startedByTask: true }), 'supervisor');
  assert.equal(rn.whoStarted({ platform: 'win32', startedByTask: false }), undefined, 'a hand start was called the supervisor');
  assert.equal(rn.whoStarted({ platform: 'darwin', startedByTask: true }), undefined, 'the proof is a Windows one');
  assert.equal(rn.whoStarted({ launcherSaid: 'person', platform: 'win32', startedByTask: true }), 'person', 'the launcher\'s word lost');
  // What it buys: a box left at the sign-in screen past the window still gets its note.
  const late = { now: NOW, uptimeSec: up(40), lastAliveAt: at(42 * MIN) };
  assert.equal(rn.noteFor({ ...late }), null, 'CONTROL: with no word the timer refuses this');
  assert.ok(rn.noteFor({ ...late, startedBy: rn.whoStarted({ platform: 'win32', startedByTask: true }) }));
});

test('#8287: the file result is what this start found, however the notice is handled afterwards', () => {
  const root = require('./store').ROOT;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'settings.json'), '');
  storecheck.scan({ base: null });
  assert.deepEqual(storecheck.lastScan(), { checked: true, damaged: 1 });
  storecheck.dismiss();
  assert.equal(storecheck.current().length, 0, 'CONTROL: dismissing empties the notice');
  assert.deepEqual(storecheck.lastScan(), { checked: true, damaged: 1 }, 'dismissing turned the damage into fine');
  fs.rmSync(path.join(root, 'settings.json'));
});
