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
  assert.match(route, /sendJson\(res, 200, \{ ok: true, on: r\.on, \.\.\.\(r\.watchdog \? \{ watchdog: r\.watchdog \} : \{\}\) \}\)/, 'the route answers with something other than the state the engine read back');
  assert.match(route, /sendJson\(res, 409, \{ error: r\.because \}\)/);
});

/* #7498: turning the switch on registers the crash-recovery watchdog when it is missing, with the spec a boot uses. */
const os = require('node:os');
const ANCHOR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-7498-'));
test.after(() => { fs.rmSync(ANCHOR_DIR, { recursive: true, force: true }); board.setAnchorer(null); });
const BUNDLE = {
  platform: 'win32', root: 'C:\\Kosmos\\v1', exists: () => true, home: ANCHOR_DIR, anchorDir: ANCHOR_DIR,
  env: { USERNAME: 'person', USERDOMAIN: 'PC', LOCALAPPDATA: ANCHOR_DIR },
};
function withWatchdogState(state, watchdog) {
  const s = scheduler(state);
  const base = s;
  const fn = (args) => {
    if (args[0] === '/Query' && args[2] === 'Kosmos\\board-watchdog') {
      base.calls.push(args.join(' '));
      if (fn.onWatchdogQuery) fn.onWatchdogQuery();
      if (watchdog === 'present') return { ok: true, out: 'TaskName: \\Kosmos\\board-watchdog' };
      if (watchdog === 'unreadable') return { ok: false, out: 'ERROR: Access is denied.' };
      if (watchdog === 'german' || watchdog === 'german-listed') return { ok: false, out: 'FEHLER: Das System kann die angegebene Datei nicht finden.' };
      return NOT_FOUND;
    }
    // Review 1: the label-free task list; unreadable too when the watchdog's own query is.
    if (args[0] === '/Query' && args.includes('/FO')) {
      base.calls.push(args.join(' '));
      if (watchdog === 'unreadable') return { ok: false, out: 'ERROR: Access is denied.' };
      if (watchdog === 'german-listed') return { ok: true, out: '"\\Kosmos\\board","N/A","Ready"\r\n"\\KOSMOS\\Board-Watchdog","N/A","Bereit"\r\n' };
      return { ok: true, out: '"\\Kosmos\\board","N/A","Ready"\r\n' };
    }
    if (args[0] === '/Create' && args[3] === 'Kosmos\\board-watchdog') {
      base.calls.push(args.join(' '));
      fn.xml = fs.readFileSync(args[5]).toString('utf16le');
      return { ok: true, out: 'SUCCESS' };
    }
    return base(args);
  };
  fn.calls = base.calls;
  board.setRunner(fn);
  board.setAnchorer(() => ({ ok: true, dir: ANCHOR_DIR, node: 'C:\\Kosmos\\v1\\runtime\\node.exe' }));
  return fn;
}
const createdWatchdog = (calls) => calls.some((c) => c.startsWith('/Create /F /TN Kosmos\\board-watchdog'));

test('#7498: switched on with no watchdog, the watchdog is registered, and the answer says so', () => {
  const s = withWatchdogState({ registered: true, enabled: false }, 'missing');
  const r = board.setStartAtSignIn(true, BUNDLE);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.on, true);
  assert.ok(createdWatchdog(s.calls), 'no watchdog /Create: ' + s.calls.join(' | '));
  assert.deepEqual(r.watchdog, { ok: true, action: 'registered', task: 'Kosmos\\board-watchdog' });
  assert.ok(fs.existsSync(path.join(ANCHOR_DIR, board.WATCH_NAME)), 'the watchdog shim was not written beside the board one');
  // Review 1: the boot's spec, read from the definition registered: the anchor's interpreter, its shim, the bundle.
  assert.ok(s.xml.includes(path.join(ANCHOR_DIR, 'node.exe')), 'not the anchored interpreter: ' + s.xml.slice(0, 400));
  assert.ok(s.xml.includes(path.join(ANCHOR_DIR, board.WATCH_NAME)), 'not the anchored shim');
  assert.ok(s.xml.includes('<WorkingDirectory>C:\\Kosmos\\v1</WorkingDirectory>'), 'not the bundle as working folder');
  assert.ok(s.xml.includes('PC\\person'), 'not the signed-in user');
});

test('#7498 review 1: a German "not found" is still read as missing (the label-free task list), and it is registered', () => {
  const s = withWatchdogState({ registered: true, enabled: false }, 'german');
  const r = board.setStartAtSignIn(true, BUNDLE);
  assert.deepEqual(r.watchdog, { ok: true, action: 'registered', task: 'Kosmos\\board-watchdog' }, JSON.stringify(r));
  assert.ok(createdWatchdog(s.calls), s.calls.join(' | '));
});

test('#7498 review 1: an already-on switch still heals a missing watchdog; no anchoring, and a source checkout says nothing', () => {
  const s = withWatchdogState({ registered: true, enabled: true }, 'missing');
  board.setAnchorer(() => { throw new Error('a Settings switch must never anchor'); });
  const r = board.setStartAtSignIn(true, BUNDLE);
  assert.equal(r.watchdog && r.watchdog.action, 'registered', JSON.stringify(r));
  assert.ok(!s.calls.some((c) => c.startsWith('/Change')), 'an on switch was changed');
  withWatchdogState({ registered: true, enabled: false }, 'missing');
  const src = board.setStartAtSignIn(true, { ...BUNDLE, root: undefined, exists: () => false });
  assert.equal('watchdog' in src, false, 'a source checkout registers nothing: ' + JSON.stringify(src));
});

test('#7498 CONTROL: switched on with a watchdog already registered, it is left as it is', () => {
  const s = withWatchdogState({ registered: true, enabled: false }, 'present');
  const r = board.setStartAtSignIn(true, BUNDLE);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!createdWatchdog(s.calls), 'an existing watchdog was re-created: ' + s.calls.join(' | '));
  assert.deepEqual(r.watchdog, { ok: true, action: 'present', task: 'Kosmos\\board-watchdog' });
});

test('#7498: a watchdog whose presence cannot be read is not created blind, and the reason is in the answer', () => {
  const s = withWatchdogState({ registered: true, enabled: false }, 'unreadable');
  const r = board.setStartAtSignIn(true, BUNDLE);
  assert.equal(r.ok, true, 'the switch itself still turned on: ' + JSON.stringify(r));
  assert.ok(!createdWatchdog(s.calls), s.calls.join(' | '));
  assert.equal(r.watchdog.ok, false);
  assert.match(r.watchdog.because, /could not tell whether the job that restarts Kosmos if it stops is there/);
});

test('#7498: switching it OFF never touches the watchdog (turning it off is not removing crash recovery here)', () => {
  const s = withWatchdogState({ registered: true, enabled: true }, 'missing');
  const r = board.setStartAtSignIn(false, BUNDLE);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!s.calls.some((c) => c.includes('board-watchdog')), s.calls.join(' | '));
  assert.equal('watchdog' in r, false);
});

test('#7498 review 2: a German error with the watchdog in the task list is "could not tell", never a second one', () => {
  const s = withWatchdogState({ registered: true, enabled: false }, 'german-listed');
  const r = board.setStartAtSignIn(true, BUNDLE);
  assert.ok(!createdWatchdog(s.calls), s.calls.join(' | '));
  assert.match(r.watchdog.because, /could not tell whether the job that restarts Kosmos if it stops is there/, JSON.stringify(r));
});

test('#7498 review 2: no node.exe at the anchor yet means no registration, and the reason says when it will be', () => {
  const s = withWatchdogState({ registered: true, enabled: false }, 'missing');
  const r = board.setStartAtSignIn(true, { ...BUNDLE, exists: (f) => !String(f).endsWith('node.exe') || !String(f).startsWith(ANCHOR_DIR) });
  assert.ok(!createdWatchdog(s.calls), s.calls.join(' | '));
  assert.match(r.watchdog.because, /registered the next time Kosmos starts/, JSON.stringify(r));
});

test('#7498 review 2: a Task Scheduler too slow for the budget registers nothing and says so', () => {
  const s = withWatchdogState({ registered: true, enabled: false }, 'missing');
  let t = 1000;
  s.onWatchdogQuery = () => { t += 19500; };   // the watchdog's own query is the slow one
  const r = board.setStartAtSignIn(true, { ...BUNDLE, now: () => t });
  assert.ok(!createdWatchdog(s.calls), s.calls.join(' | '));
  assert.match(r.watchdog.because, /no time left/, JSON.stringify(r));
});
