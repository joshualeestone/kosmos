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
  // Review 4: a clock set back a little after the note was made still shows it; one set back further does not.
  assert.ok(rn.current(NOW - 30 * 1000), 'hidden by a clock 30 seconds behind');
  assert.equal(rn.current(NOW - 2 * MIN), null, 'shown although the clock is two minutes before the note');
  assert.equal(rn.current(NOW + rn.SHOW_MS + MIN), null, 'still shown after a day');
  assert.equal(rn.dismiss(), true);
  assert.equal(rn.current(NOW + MIN), null, 'shown after it was dismissed');
});

test('#5359: no record at all reads as no note, and dismissing nothing is fine', () => {
  fs.rmSync(path.dirname(rn._files.aliveFile()), { recursive: true, force: true });
  assert.equal(rn.current(NOW), null);
  assert.equal(rn.dismiss(), true);
});

test('#5359 review 5: the beat rewrites the last-alive record once a minute', (t) => {
  // The rule needs a recent record when the computer goes down: a beat slower than a few per window misses notes.
  assert.ok(rn.BEAT_MS > 0 && rn.BEAT_MS * 5 <= rn.WINDOW_MS, 'the beat is too slow for the window: ' + rn.BEAT_MS);
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: NOW });
  fs.rmSync(path.dirname(rn._files.aliveFile()), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(rn._files.aliveFile()), { recursive: true });
  const timer = rn.startBeating();
  t.after(() => clearInterval(timer));
  assert.equal(fs.existsSync(rn._files.aliveFile()), false, 'control: nothing is written before the first minute');
  t.mock.timers.tick(rn.BEAT_MS);
  assert.equal(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).at, new Date(NOW + rn.BEAT_MS).toISOString());
  t.mock.timers.tick(rn.BEAT_MS);
  assert.equal(JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8')).at, new Date(NOW + 2 * rn.BEAT_MS).toISOString(), 'the second minute did not move it');
});

test('#5359 review 7: both windows hold at exactly WINDOW_MS and close one millisecond past it', () => {
  const W = rn.WINDOW_MS;
  const boot = NOW - 5 * 60 * 1000;   // the computer came up five minutes before this start
  const upSec = (now, bootAt) => (now - bootAt) / 1000;
  // Alive exactly WINDOW_MS before the boot: a note. One millisecond earlier: none.
  assert.ok(rn.noteFor({ now: NOW, uptimeSec: upSec(NOW, boot), lastAliveAt: boot - W }), 'no note at exactly the window before boot');
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: upSec(NOW, boot), lastAliveAt: boot - W - 1 }), null, 'a note one millisecond past the window before boot');
  // Started exactly WINDOW_MS after the boot: a note. One millisecond later: none.
  const boot2 = NOW - W;
  assert.ok(rn.noteFor({ now: NOW, uptimeSec: upSec(NOW, boot2), lastAliveAt: boot2 - MIN }), 'no note at exactly the window after boot');
  const boot3 = NOW - W - 1;
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: upSec(NOW, boot3), lastAliveAt: boot3 - MIN }), null, 'a note one millisecond past the window after boot');
  // The window is the 15 minutes the words and the plan promise.
  assert.equal(W, 15 * 60 * 1000);
});

test('#5450: who started the board decides it when the launcher says so; the timer only guesses when nothing does', () => {
  // A crash, then the machine waited 40 minutes at a login screen before the login item brought Kosmos back.
  const late = { now: NOW, uptimeSec: up(40), lastAliveAt: at(41 * MIN) };
  assert.equal(rn.noteFor(late), null, 'CONTROL: unknown, the timer reads a late start as a person opening it');
  assert.ok(rn.noteFor({ ...late, startedBy: 'supervisor' }), 'the supervisor brought it back, so it came back by itself');
  // A person opening Kosmos 5 minutes after a restart that caught it running: never "by itself".
  const quick = { now: NOW, uptimeSec: up(5), lastAliveAt: at(6 * MIN) };
  assert.ok(rn.noteFor(quick), 'CONTROL: unknown and quick, the timer says by itself');
  assert.equal(rn.noteFor({ ...quick, startedBy: 'person' }), null, 'a person started it, so it did not come back by itself');
  // Review 6: board-run sends the STRING 'unknown' for a mark it cannot judge: the timer decides, exactly as undefined.
  assert.equal(rn.noteFor({ ...late, startedBy: 'unknown' }), null, 'an unjudgeable mark switched the timer off: a false note');
  assert.ok(rn.noteFor({ ...quick, startedBy: 'unknown' }), 'CONTROL: unknown and quick, the timer still says by itself');
  // The other rules still hold for the supervisor: alive since this boot, or last alive long before it, is no note.
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: up(40), lastAliveAt: at(10 * MIN), startedBy: 'supervisor' }), null, 'alive since this boot');
  assert.equal(rn.noteFor({ now: NOW, uptimeSec: up(40), lastAliveAt: at(40 * MIN + rn.WINDOW_MS + MIN), startedBy: 'supervisor' }), null, 'not running when it went down');
});

test('#5450: atStart uses the launcher\'s word it is given, and consumes the person\'s mark only after using it', () => {
  fs.rmSync(path.dirname(rn._files.aliveFile()), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(rn._files.aliveFile()), { recursive: true });
  fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: at(41 * MIN) }));
  assert.ok(rn.atStart({ now: () => NOW, uptime: () => up(40), startedBy: 'supervisor' }), 'the supervisor\'s late start made no note');
  // A person's start: no note, and the mark it left is removed now that it has been read (review 1).
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kosmos-5450-mark-'));
  try {
    const mark = path.join(dir, 'board.person-start');
    fs.writeFileSync(mark, '1');
    fs.writeFileSync(rn._files.aliveFile(), JSON.stringify({ at: at(6 * MIN) }));
    assert.equal(rn.atStart({ now: () => NOW, uptime: () => up(5), startedBy: 'person', personMark: mark }), null);
    assert.equal(fs.existsSync(mark), false, 'the mark was left, so the next start would read as a person\'s too');
    // Review 7: removed whoever started the board, or an unjudgeable mark would make every later relaunch unknown.
    for (const who of ['supervisor', 'unknown']) {
      fs.writeFileSync(mark, '1');
      rn.atStart({ now: () => NOW, uptime: () => up(5), startedBy: who, personMark: mark });
      assert.equal(fs.existsSync(mark), false, 'the mark was left after a start by ' + who);
    }
    // Only the launcher's own mark file, by its name: a stray path is never deleted.
    const other = path.join(dir, 'something-else');
    fs.writeFileSync(other, 'x');
    rn.atStart({ now: () => NOW, uptime: () => up(5), startedBy: 'person', personMark: other });
    assert.equal(fs.existsSync(other), true, 'a file that is not the mark was deleted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
