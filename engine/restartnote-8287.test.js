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
  rn.resetForTests();
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
  rn.noteRunning([card('leo', 'Leo'), card('april', 'April', { state: 'stopped' })], NOW);
  rn.beat(NOW);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running, [{ session: 'leo', name: 'Leo' }]);
  rn.noteRunning(null);   // a failed snapshot
  rn.beat(NOW + MIN);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running, [{ session: 'leo', name: 'Leo' }], 'a failed read wiped the list');
  rn.noteRunning([], NOW + 2 * MIN);     // a real empty roster is a real answer
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

test('#8287: the file result is what this start found, however the notice is handled afterwards', () => {
  const root = require('./store').ROOT;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'settings.json'), '');
  storecheck.scan({ base: null });
  assert.deepEqual(storecheck.lastScan(), { checked: true, damaged: 1, unread: 0 });
  storecheck.dismiss();
  assert.equal(storecheck.current().length, 0, 'CONTROL: dismissing empties the notice');
  assert.deepEqual(storecheck.lastScan(), { checked: true, damaged: 1, unread: 0 }, 'dismissing turned the damage into fine');
  fs.rmSync(path.join(root, 'settings.json'));
});

test('#8287: a folder or file the scan could not read is never called fine, but damage it did find still counts', (t) => {
  const root = require('./store').ROOT;
  fs.mkdirSync(root, { recursive: true });
  storecheck.scan({ base: null });
  assert.deepEqual(storecheck.lastScan(), { checked: true, damaged: 0, unread: 0 }, 'CONTROL: a clean scan says so');

  const realDir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (dir, ...a) => { if (dir === root) { const e = new Error('no'); e.code = 'EACCES'; throw e; } return realDir(dir, ...a); });
  storecheck.scan({ base: null });
  assert.equal(storecheck.lastScan().checked, false, 'a data folder it could not list was called fine');
  fs.readdirSync.mock.restore();

  fs.writeFileSync(path.join(root, 'settings.json'), '{}');
  const realStat = fs.statSync;
  t.mock.method(fs, 'statSync', (f, ...a) => { if (String(f).endsWith('settings.json')) { const e = new Error('no'); e.code = 'EPERM'; throw e; } return realStat(f, ...a); });
  storecheck.scan({ base: null });
  assert.equal(storecheck.lastScan().checked, false, 'a file it could not stat was called fine');
  fs.statSync.mock.restore();

  const realRead = fs.readFileSync;
  const busy = t.mock.method(fs, 'readFileSync', (f, ...a) => { if (String(f).endsWith('settings.json')) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return realRead(f, ...a); });
  storecheck.scan({ base: null });
  assert.equal(storecheck.lastScan().checked, false, 'a file it could not read was called fine');
  fs.writeFileSync(path.join(root, 'policy.json'), '');
  storecheck.scan({ base: null });
  /* kosmos#8297: and the file it could not read is counted beside it, so the page can say the damaged count is a floor. */
  assert.deepEqual(storecheck.lastScan(), { checked: true, damaged: 1, unread: 1 }, 'damage it did find was dropped, or the unread file not counted beside it');
  busy.mock.restore();
  fs.rmSync(path.join(root, 'settings.json'));
  fs.rmSync(path.join(root, 'policy.json'));
});

test('#8287: a rejected token, a lost connection or a crash loop is not back', () => {
  const note = { wereRunning: was('a', 'b', 'c') };
  const roster = [card('a', 'A', { state: 'auth_failed' }), card('b', 'B', { state: 'connection_lost' }), card('c', 'C', { crashLoop: { looping: true } })];
  assert.deepEqual(rn.checksFor(note, roster, []).agents, { was: 3, back: 0, notBack: ['A', 'B', 'C'] });
  assert.deepEqual(rn.runningOf(roster), [], 'one of these was recorded as running');
});

test('#8287: an agent seen back once stays back, so stopping it later that day is not reported', () => {
  clean();
  aliveWith({ running: was('leo', 'homer') });
  rn.atStart({ now: () => NOW, uptime: () => up(6) });
  const stopped = [card('leo', 'Leo', { state: 'stopped' }), card('homer', 'Homer', { state: 'stopped' })];
  rn.noteRunning(stopped);
  assert.deepEqual(rn.checksFor(rn.current(NOW + MIN), stopped, []).agents.notBack, ['Leo', 'Homer'], 'CONTROL: neither has been seen back');
  rn.noteRunning([card('leo', 'Leo'), card('april', 'April')]);
  assert.deepEqual(rn.checksFor(rn.current(NOW + MIN), stopped, []).agents, { was: 2, back: 1, notBack: ['Homer'] }, 'Leo came back and was stopped later');
  assert.deepEqual(rn.current(NOW + MIN).returned, ['leo'], 'an agent nobody asked about was recorded');
});

test('#8287: coming back does not excuse a later failure, only a plain stop', () => {
  const note = { wereRunning: was('a'), returned: ['a'] };
  assert.deepEqual(rn.checksFor(note, [card('a', 'A', { state: 'stopped' })], []).agents.notBack, [], 'CONTROL: a plain stop after coming back');
  for (const failed of [card('a', 'A', { state: 'auth_failed' }), card('a', 'A', { state: 'connection_lost' }), card('a', 'A', { state: 'stopped', crashLoop: { looping: true } })]) {
    assert.deepEqual(rn.checksFor(note, [failed], []).agents.notBack, ['A'], 'came back once and hid: ' + JSON.stringify(failed));
  }
  assert.deepEqual(rn.checksFor(note, [], []).agents.notBack, ['A'], 'gone from the roster was excused');
});

test('#8287: the route reads what the minute tick read, nothing until it has', () => {
  clean();
  assert.equal(rn.lastRoster(), null);
  rn.noteRunning(null);
  assert.equal(rn.lastRoster(), null, 'a failed read was kept as a roster');
  rn.noteRunning([card('leo', 'Leo')]);
  assert.deepEqual(rn.lastRoster().map((c) => c.sessionName), ['leo']);
  rn.noteRunning(null);
  assert.deepEqual(rn.lastRoster().map((c) => c.sessionName), ['leo'], 'a failed read lost the last good one');
  const T0 = Date.now();
  rn.noteRunning([card('leo', 'Leo')], T0);
  assert.ok(rn.lastRoster(T0 + 5 * MIN), 'CONTROL: a reading five minutes old still counts');
  assert.equal(rn.lastRoster(T0 + 5 * MIN + 1), null, 'a reading of unbounded age was reported as now');
  assert.equal(rn.lastRoster(T0 - 1), null, 'a clock set back made an old reading look new');
});

test('#8287: the page gets the times and the checks and none of the records', () => {
  const n = { lastAliveAt: 'a', bootAt: 'b', upAt: 'c', wereRunning: was('leo'), returned: ['leo'], files: { damaged: 1 } };
  assert.deepEqual(rn.publicNote(n, { files: { damaged: 1 } }), { lastAliveAt: 'a', bootAt: 'b', upAt: 'c', checks: { files: { damaged: 1 } } });
});

test('#8287: the fields read are the ones real cards carry', () => {
  const fleet = require('../test-support/fleet');
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('homer', { state: 'working' }), fleet.agent('april', { state: 'auth_failed' })]);
  try {
    assert.deepEqual(rn.runningOf(board.agents).map((a) => a.session).sort(), ['homer', 'leo'], 'real cards did not read as up, or a failed one did');
    assert.deepEqual(rn.checksFor({ wereRunning: was('leo', 'april') }, board.agents, []).agents, { was: 2, back: 1, notBack: [board.agents.find((a) => a.sessionName === 'april').name || 'april'] });
  } finally { board.restore(); }
});

test('#8287: a second restart soon after the first still asks about everyone', () => {
  clean();
  const T0 = Date.now();
  fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: new Date(T0 - 8 * MIN).toISOString(), running: was('leo', 'homer', 'april') }));
  rn.atStart({ now: () => T0, uptime: () => up(6) });
  assert.equal(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running.length, 3, 'the first beat dropped the list');
  rn.noteRunning([card('leo', 'Leo')], T0 + MIN);
  rn.beat(T0 + MIN);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running.map((a) => a.session).sort(), ['april', 'homer', 'leo'], 'a partial read shrank the list');
  rn.noteRunning([card('leo', 'Leo')], T0 + rn.WINDOW_MS + 1);
  rn.beat(T0 + rn.WINDOW_MS + 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running.map((a) => a.session), ['leo'], 'CONTROL: after the window the list is who is up');
});

test('#8287: when roster reads have stopped, the beat stops claiming who is running', () => {
  clean();
  const T0 = Date.now();
  rn.noteRunning([card('leo', 'Leo')], T0);
  rn.noteRunning(null);
  rn.beat(T0 + 5 * MIN);
  assert.equal(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running.length, 1, 'CONTROL: a recent read still counts');
  rn.beat(T0 + 5 * MIN + 1);
  assert.equal('running' in JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')), false, 'a list hours old was written as current');
});

test('#8287: a list from a board last open long ago is not carried into this run', () => {
  clean();
  const T0 = Date.now();
  fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: new Date(T0 - 24 * 60 * MIN).toISOString(), running: was('old1') }));
  assert.equal(rn.atStart({ now: () => T0, uptime: () => up(6), startedBy: 'person' }), null, 'CONTROL: this start makes no note');
  assert.equal('running' in JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')), false, 'the old list was written back');
  rn.noteRunning([card('live', 'Live')], T0 + MIN);
  rn.beat(T0 + MIN);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running.map((a) => a.session), ['live'], 'an agent from days ago joined the list');
});

test('#8287: a long outage still carries the list when it made a note', () => {
  clean();
  const T0 = Date.now();
  fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: new Date(T0 - 300 * MIN).toISOString(), running: was('leo') }));
  assert.ok(rn.atStart({ now: () => T0, uptime: () => up(298), startedBy: 'supervisor' }), 'CONTROL: this start makes a note');
  assert.equal(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running.length, 1, 'a note was made but its list was dropped');
});

test('#8287: an agent nobody recorded before this start is added, and the note still gets only the old list', () => {
  clean();
  const T0 = Date.now();
  fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: new Date(T0 - 8 * MIN).toISOString(), running: was('leo') }));
  const note = rn.atStart({ now: () => T0, uptime: () => up(6) });
  assert.deepEqual(note.wereRunning, was('leo'));
  rn.noteRunning([card('april', 'April')], T0 + MIN);
  rn.beat(T0 + MIN);
  assert.deepEqual(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).running.map((a) => a.session).sort(), ['april', 'leo']);
  assert.deepEqual(rn.current(T0 + MIN).wereRunning, was('leo'), 'the note moved');
});

test('#8297: records it could not look at travel with the damaged count, from the scan to what the page is sent', () => {
  clean();
  aliveWith({ running: was('leo') });
  const note = rn.atStart({ now: () => NOW, uptime: () => up(6), files: { checked: true, damaged: 2, unread: 3 } });
  assert.deepEqual(note.files, { damaged: 2, unread: 3 }, 'the note dropped the unread count');
  const shown = rn.current(NOW);
  assert.deepEqual(shown.files, { damaged: 2, unread: 3 }, 'the kept note lost the unread count');
  const checks = rn.checksFor(shown, [card('leo', 'Leo')], []);
  assert.deepEqual(checks.files, { damaged: 2, unread: 3 }, 'the checks lost the unread count');
  assert.deepEqual(rn.publicNote(shown, checks).checks.files, { damaged: 2, unread: 3 });

  // CONTROL: nothing unread adds nothing, so the words stay as they were.
  clean();
  aliveWith({ running: was('leo') });
  assert.deepEqual(rn.atStart({ now: () => NOW, uptime: () => up(6), files: { checked: true, damaged: 1, unread: 0 } }).files, { damaged: 1 });
  // Junk is dropped, never sent on.
  for (const unread of [-1, 1.5, '2', null]) {
    clean();
    aliveWith({ running: was('leo') });
    assert.deepEqual(rn.atStart({ now: () => NOW, uptime: () => up(6), files: { checked: true, damaged: 1, unread } }).files, { damaged: 1 }, 'kept unread ' + JSON.stringify(unread));
  }
  // A note kept before #8297 has no unread count, and reads as before.
  clean();
  aliveWith({ running: was('leo') });
  rn.atStart({ now: () => NOW, uptime: () => up(6), files: { checked: true, damaged: 1 } });
  assert.deepEqual(rn.current(NOW).files, { damaged: 1 });
});
