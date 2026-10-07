'use strict';
/**
 * #5359 part 1: the board's note that this computer restarted while Kosmos was running and Kosmos came back by
 * itself. engine/restartnote.js; the route is covered in server.restartnote-5359.test.js.
 *
 *   node --test engine/restartnote-5359.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-restartnote-5359-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const rn = require('./restartnote');

const MIN = 60 * 1000;
const NOW = Date.parse('2026-10-05T19:22:00Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const up = (minutes) => minutes * 60;   // uptime in seconds

test('#5359: the note is made when the board was alive just before the boot and came up just after it', () => {
  // The field report: alive at 19:14, the computer back at 19:16, the board up at 19:22.
  const n = rn.noteFor({ now: NOW, uptimeSec: up(6), lastAliveAt: at(8 * MIN) });
  assert.ok(n, 'no note for a computer restart under a running Kosmos');
  assert.equal(n.lastAliveAt, at(8 * MIN));
  assert.equal(n.bootAt, at(6 * MIN));
  assert.equal(n.upAt, new Date(NOW).toISOString());
});

test('#5359: no note when the computer did not restart, when Kosmos was not running, or when a person opened it later', () => {
  // Alive SINCE this boot: Kosmos restarted (an update, a crash of its own), the computer did not.
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: up(600), lastAliveAt: at(2 * MIN) }), null);
  // Last alive long before the boot: a person quit Kosmos yesterday, then restarted the computer.
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: up(6), lastAliveAt: at(6 * MIN + rn.WINDOW_MS + MIN) }), null);
  // Started long after the boot: a person opened it, it did not come back with the computer.
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: up(30), lastAliveAt: at(31 * MIN) }), null);
  // Never alive before (a first start), or a record that cannot be read.
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: up(6), lastAliveAt: null }), null);
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: up(6), lastAliveAt: 'not a time' }), null);
  // Control at the edges: just inside both windows still makes one.
  assert.ok(rn.noteFor({ now: NOW, uptimeSec: up(14), lastAliveAt: at(28 * MIN) }), 'control: inside both windows');
});

test('#5359: at start the last-alive time is read BEFORE this run writes its own, and the beat follows', () => {
  fs.rmSync(path.dirname(rn._files.aliveFile()), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(rn._files.aliveFile()), { recursive: true });
  fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: at(8 * MIN) }));
  const note = rn.atStart({ now: () => NOW, uptime: () => up(6) });
  assert.ok(note, 'the previous run\'s last-alive time was overwritten before it was read');
  assert.equal(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).at, new Date(NOW).toISOString(), 'this run did not say it is alive');
  assert.deepEqual(rn.current(NOW + MIN), note, 'the note was not kept for the page');
  // A second start a minute later (the board restarted, the computer did not) makes no new note.
  assert.equal(rn.atStart({ now: () => NOW + MIN, uptime: () => up(7) }), null);
});

test('#5359: the note shows for a day, and not after it is dismissed', () => {
  fs.rmSync(path.dirname(rn._files.aliveFile()), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(rn._files.aliveFile()), { recursive: true });
  fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: at(8 * MIN) }));
  rn.atStart({ now: () => NOW, uptime: () => up(6) });
  assert.ok(rn.current(NOW + rn.SHOW_MS - MIN), 'control: shown just inside a day');
  assert.equal(rn.current(NOW + rn.SHOW_MS + MIN), null, 'still shown after a day');
  assert.equal(rn.dismiss(), true);
  assert.equal(rn.current(NOW + MIN), null, 'shown after it was dismissed');
});

test('#5359: no record at all reads as no note, and dismissing nothing is fine', () => {
  fs.rmSync(path.dirname(rn._files.aliveFile()), { recursive: true, force: true });
  assert.equal(rn.current(NOW), null);
  assert.equal(rn.dismiss(), true);
});
