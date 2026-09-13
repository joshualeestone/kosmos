'use strict';
/**
 * #570 BLOCKER 4, half three: Settings SAYS whether the board comes back.
 *
 * 🛑 THE SILENCE WAS THE BLOCKER. `boardAutostartCheck` returned null off-darwin
 * and `check()` filters falsy rows away, so a Windows Settings screen never
 * raised the subject -- while the honest answer was NO for every Windows board
 * ever run. A board that does not come back is bad; a board that does not come
 * back and says nothing is what makes this a blocker rather than an annoyance.
 *
 * ⚠️ THE TASK FACTS ARE INJECTED (`opts.boardTask`), so this never shells a real
 * `schtasks` and a Mac can assert the win32 rows.
 *
 *   node --test engine/machine.win32-autostart-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const machine = require('./machine');

const TASK = 'Kosmos\\board';
const HINT = 'schtasks /Delete /F /TN "Kosmos\\board"';
function facts(over) {
  return { task: TASK, bundle: true, registered: true, enabled: true, running: true, claimed: true, removeHint: HINT, ...over };
}
function row(over) {
  return machine.boardAutostartCheck(() => ({ ok: false }), { platform: 'win32', boardTask: facts(over) });
}

test('win32 gets a row AT ALL -- the whole point, since it used to get none', () => {
  assert.ok(row(), 'a platform with a real answer must not be filtered out of Settings');
  assert.equal(row().key, 'autostart');
});

test('no task registered -> ATTENTION, and it says the agents come back while the board does not', () => {
  const r = row({ registered: false });
  assert.equal(r.state, machine.STATE.ATTENTION);
  assert.match(r.title, /will not start itself/);
  assert.match(r.detail, /Kosmos\\board/);
  assert.match(r.detail, /your agents will/, 'the surprising half is the one worth naming');
});

test('task present but switched OFF -> ATTENTION, and it is not re-enabled behind the person', () => {
  const r = row({ enabled: false });
  assert.equal(r.state, machine.STATE.ATTENTION);
  assert.match(r.title, /turned off/);
  assert.match(r.detail, /Task Scheduler/);
});

test('task present and enabled -> OK, and it prints how to remove it', () => {
  const r = row();
  assert.equal(r.state, machine.STATE.OK);
  /* win32-board-copy (W-22): the command moved out of the sentence a person reads and
     into the row's `admin` field, which Settings shows under "For IT admins". It is
     still on the screen that mentions the task, so the rule this pins still holds. */
  assert.match(r.admin, /schtasks \/Delete \/F \/TN "Kosmos\\board"/,
    'anything durable Kosmos registers must be findable and removable from the screen that mentions it');
  assert.doesNotMatch(r.detail, /schtasks/, 'the raw command is back in the sentence a person reads');
});

test('a from-source checkout is OK, not a fault -- the same exemption the Mac arm gives', () => {
  const r = row({ bundle: false, registered: false });
  assert.equal(r.state, machine.STATE.OK);
  assert.match(r.title, /running from source/);
});

test('facts unreadable -> UNKNOWN, never a confident NO', () => {
  const r = machine.boardAutostartCheck(() => ({ ok: false }), { platform: 'win32', boardTask: null });
  assert.equal(r.state, machine.STATE.UNKNOWN);
  assert.match(r.detail, /Not the same as it being wrong/);
});

test('any OTHER platform still gets no row (we have nothing true to say about it)', () => {
  assert.equal(machine.boardAutostartCheck(() => ({ ok: false }), { platform: 'linux' }), null);
});
