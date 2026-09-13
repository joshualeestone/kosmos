'use strict';
/**
 * win32-installer-native (W-21a, W-22): Settings' "Start Kosmos when I sign in to Windows" switch.
 * The engine (win32board.setStartAtSignIn), the row that carries it (machine.win32BoardAutostartCheck)
 * and the route between them.
 *
 * 🛑 NO REAL schtasks: every command goes to a stub runner, which also plays the task's own
 * definition, so the switch is asserted against what `/Query /XML` would say afterwards.
 *
 *   node --test engine/win32board.start-at-sign-in.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const board = require('./win32board');
const machine = require('./machine');

const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };

/* The definition as schtasks prints it: an enabled task has no <Enabled> under <Settings>, a
   switched-off one has <Enabled>false</Enabled> there (measured for #2973). */
function definition(enabled) {
  return { ok: true, out: '<?xml version="1.0" encoding="UTF-16"?>\r\n<Task><Settings>\r\n'
    + (enabled ? '' : '    <Enabled>false</Enabled>\r\n')
    + '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n  </Settings></Task>\r\n' };
}

/** A scheduler with one board task whose switch `/Change` really flips, unless told otherwise. */
function scheduler(state) {
  const calls = [];
  const fn = (args) => {
    calls.push(args.join(' '));
    if (args[0] === '/Query' && args.includes('/XML')) {
      if (state.unreadable) return { ok: false, out: 'ERROR: Access is denied.' };
      if (!state.registered) return NOT_FOUND;
      if (state.readBackFails && calls.some((c) => c.startsWith('/Change'))) return { ok: false, out: 'ERROR: Access is denied.' };
      return definition(state.enabled);
    }
    if (args[0] === '/Query' && !args.includes('/TN')) return state.unreadable ? { ok: false, out: 'ERROR: Access is denied.' } : { ok: true, out: '"\\Microsoft\\x","N/A","Ready"\r\n' };
    if (args[0] === '/Query') return NOT_FOUND;
    if (args[0] === '/Change') {
      if (state.changeFails) return { ok: false, out: 'ERROR: Access is denied.' };
      if (!state.ignoresChange) state.enabled = args.includes('/ENABLE');
      return { ok: true, out: 'SUCCESS' };
    }
    return { ok: true, out: '' };
  };
  fn.calls = calls;
  board.setRunner(fn);
  return fn;
}

const WIN = { platform: 'win32' };

test.afterEach(() => board.setRunner(null));

test('turning it off switches the task off and answers with the state read back', () => {
  const s = scheduler({ registered: true, enabled: true });
  assert.deepEqual(board.setStartAtSignIn(false, WIN), { ok: true, on: false });
  assert.ok(s.calls.includes('/Change /TN Kosmos\\board /DISABLE'), s.calls.join(' | '));
  assert.ok(s.calls.lastIndexOf('/Query /TN Kosmos\\board /XML') > s.calls.indexOf('/Change /TN Kosmos\\board /DISABLE'), 'the state was not read back after the change');
  assert.deepEqual(board.setStartAtSignIn(true, WIN), { ok: true, on: true });
  assert.ok(s.calls.includes('/Change /TN Kosmos\\board /ENABLE'));
});

test('a switch already in the wanted position changes nothing', () => {
  const s = scheduler({ registered: true, enabled: false });
  assert.deepEqual(board.setStartAtSignIn(false, WIN), { ok: true, on: false });
  assert.ok(!s.calls.some((c) => c.startsWith('/Change')), 'a task already off was changed');
});

test('🛑 unknown is never on: a task that cannot be read refuses before anything is changed', () => {
  const s = scheduler({ unreadable: true });
  const r = board.setStartAtSignIn(true, WIN);
  assert.equal(r.ok, false);
  assert.match(r.because, /we could not read the job that starts Kosmos when you sign in \(.*\), so nothing was changed/);
  assert.ok(!s.calls.some((c) => c.startsWith('/Change')), 'a task whose state could not be read was changed');
});

test('no task, a change Windows refused, a read-back that fails or disagrees: each is a failure with its sentence', () => {
  let s = scheduler({ registered: false });
  assert.match(board.setStartAtSignIn(true, WIN).because, /there is no job on this computer that starts Kosmos when you sign in/);
  assert.ok(!s.calls.some((c) => c.startsWith('/Change')));
  scheduler({ registered: true, enabled: true, changeFails: true });
  assert.match(board.setStartAtSignIn(false, WIN).because, /we could not stop the board starting at logon \(ERROR: Access is denied\.\)/);
  scheduler({ registered: true, enabled: true, readBackFails: true });
  assert.match(board.setStartAtSignIn(false, WIN).because, /could not read it back, so we cannot say it worked/);
  scheduler({ registered: true, enabled: true, ignoresChange: true });
  assert.match(board.setStartAtSignIn(false, WIN).because, /but it still reads on/);
});

test('the gate: without live execution and without a runner nothing is asked; a wrong value or a Mac is refused', () => {
  board.setRunner(null);
  const r = board.setStartAtSignIn(false, { platform: 'win32', liveExecutionAllowed: () => false });
  assert.deepEqual(r, { ok: false, because: 'this Kosmos is not allowed to change Task Scheduler, so nothing was changed' });
  const s = scheduler({ registered: true, enabled: true });
  assert.equal(board.setStartAtSignIn('off', WIN).ok, false);
  assert.equal(board.setStartAtSignIn(false, { platform: 'darwin' }).ok, false);
  assert.deepEqual(s.calls, []);
});

test('the Settings row carries the switch only where the state was READ and the task is there', () => {
  const facts = (extra) => ({ task: 'Kosmos\\board', bundle: true, registered: true, enabled: true, running: false, claimed: true, removeHint: 'schtasks /Delete /F /TN "Kosmos\\board"', ...extra });
  const row = (boardTask) => machine.win32BoardAutostartCheck({ boardTask });
  assert.equal(row(facts()).startAtSignIn, true);
  const off = row(facts({ enabled: false }));
  assert.equal(off.startAtSignIn, false);
  assert.equal(off.state, machine.STATE.OK, 'a task the person switched off is still a warning row');
  assert.match(off.detail, /You can turn it back on with the switch below\./);
  assert.doesNotMatch(off.detail, /Task Scheduler Library/, 'the switched-off row still sends the person to Task Scheduler');
  assert.equal('startAtSignIn' in row(facts({ registered: false, enabled: false })), false, 'a missing task was given a switch');
  assert.equal('startAtSignIn' in row(null), false, 'a state that could not be read was given a switch');
  assert.equal('startAtSignIn' in row(facts({ bundle: false })), false, 'a source checkout was given a switch');
});

test('the route: POST only, a boolean only, and the answer is the engine\'s', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = server.indexOf("pathname === '/api/machine/start-at-sign-in'");
  assert.ok(at > -1, 'the route is gone');
  const route = server.slice(at, server.indexOf('\n    return;\n  }\n', at));
  assert.match(route, /req\.method === 'POST'/);
  assert.match(route, /typeof body\.on !== 'boolean'/, 'the route passes something other than a boolean to the engine');
  assert.match(route, /setStartAtSignIn\(body\.on\)/);
  assert.match(route, /sendJson\(res, 200, \{ ok: true, on: r\.on \}\)/, 'the route answers with something other than the state the engine read back');
  assert.match(route, /sendJson\(res, 409, \{ error: r\.because \}\)/);
});
