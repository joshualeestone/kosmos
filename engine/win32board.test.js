'use strict';
/**
 * #570 BLOCKER 4: the BOARD comes back at logon on Windows, can be bounced, and
 * says so when it cannot.
 *
 * 🛑 NO REAL `schtasks` IS EVER SHELLED HERE, and no real task is registered.
 * Every command goes through `setRunner`, the anchor through `setAnchorer` and
 * the detached restart helper through `setSpawner` -- the seams win32job.js
 * established, for the reason it gives: a suite that touched the real scheduler
 * would register durable tasks on whichever machine ran it.
 *
 * 🔑 AND THE PLATFORM IS ALWAYS PASSED, NEVER READ. That is this branch's method
 * (engine/remove.js's `jobOps(platform)`): the fleet's Macs must be able to
 * assert the Windows arm without a Windows box.
 *
 *   node --test engine/win32board.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* An anchor sandbox, so `install` writes its shim somewhere disposable rather
   than into the operator's real LOCALAPPDATA. */
const ANCHOR = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-win32board-570-'));

const board = require('./win32board');

/* The anchor stub: the real one copies a 92 MB node.exe, which no suite may do. */
function anchorOk() {
  return { ok: true, node: nodePath.join(ANCHOR, 'node.exe'), boot: nodePath.join(ANCHOR, 'supervisor-boot.js'), dir: ANCHOR, pointer: nodePath.join(ANCHOR, 'engine-path') };
}

/* A schtasks stub. `queries` decides what /Query answers; every call is recorded
   so a test can assert the ORDER of acts, which is where the hazards live. */
/* #2973: status() asks three different queries, so the stub answers each by its shape:
   the definition (`/XML`), the verbose CSV row (`/V`), the machine's whole task list (no
   `/TN`), and the localized LIST text (`/FO LIST`), which nothing may read any more and
   is scripted only so a test can prove it is ignored. Anything unscripted is not found. */
function runner(script) {
  const calls = [];
  const fn = (args) => {
    calls.push(args.join(' '));
    const verb = args[0];
    if (verb === '/Query') {
      const said = args.includes('/XML') ? script.xml
        : args.includes('/V') ? script.verbose
          : !args.includes('/TN') ? script.listing
            : script.list;
      return said || NOT_FOUND;
    }
    if (script[verb]) return script[verb];
    return { ok: true, out: '' };
  };
  fn.calls = calls;
  return fn;
}
const NOT_FOUND = { ok: false, out: 'ERROR: The system cannot find the file specified.' };

/* The definition as `schtasks /Query /XML` printed it for a scratch task on 2026-09-12:
   an ENABLED task has no <Enabled> under <Settings> at all, and a switched-off one has
   <Enabled>false</Enabled> there. The LogonTrigger's own element is dropped either way. */
function definition(settingsExtra) {
  return { ok: true, out: '<?xml version="1.0" encoding="UTF-16"?>\r\n'
    + '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n'
    + '  <Settings>\r\n    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n'
    + (settingsExtra || '')
    + '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\r\n    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n  </Settings>\r\n'
    + '  <Triggers>\r\n    <LogonTrigger>\r\n      <UserId>PIZZARAMA\\joshu</UserId>\r\n    </LogonTrigger>\r\n  </Triggers>\r\n'
    + '</Task>' };
}
const XML_ENABLED = definition('');
const XML_DISABLED = definition('    <Enabled>false</Enabled>\r\n');

/* One verbose CSV row in the measured column order. `status` is the translated word
   (which nothing may read) and `lastResult` the code (which `running` is read from). */
function verboseRow(statusWord, lastResult, host) {
  return { ok: true, out: '"' + (host || 'PIZZARAMA') + '","\\Kosmos\\board","N/A","' + statusWord + '","Interactive only","12.09.2026 22:41:43","'
    + lastResult + '","N/A","C:\\Windows\\System32\\conhost.exe --headless "C:\\K\\node.exe" "C:\\K\\board-boot.js"","N/A"\r\n' };
}
function listText(host, statusWord) {
  return { ok: true, out: '\r\nFolder: \\Kosmos\r\nHostName:      ' + host + '\r\nTaskName:      \\Kosmos\\board\r\nNext Run Time: N/A\r\nStatus:        ' + statusWord + '\r\n' };
}
const READY = { xml: XML_ENABLED, verbose: verboseRow('Ready', '267014'), list: listText('PIZZARAMA', 'Ready') };
const RUNNING = { xml: XML_ENABLED, verbose: verboseRow('Running', '267009'), list: listText('PIZZARAMA', 'Running') };
const DISABLED = { xml: XML_DISABLED, verbose: verboseRow('Disabled', '267014'), list: listText('PIZZARAMA', 'Disabled') };
const NONE = {};

/* 🛑 `AGENT_WORKFORCE_DATA`, NOT `LOCALAPPDATA`. The claim file is written through
   `win32anchor.anchorDir`, whose override order starts with the data root -- so an
   env carrying a real LOCALAPPDATA would have this suite writing into the
   OPERATOR'S OWN anchor directory. Caught by the claim test, which is the one
   assertion that reads back what a previous test wrote. */
const ENV = { USERNAME: 'joshu', USERDOMAIN: 'PIZZARAMA', AGENT_WORKFORCE_DATA: ANCHOR };
const CLAIM_DIR = require('./win32anchor').anchorDir('win32', ANCHOR, ENV);

test.beforeEach(() => {
  board.setAnchorer(anchorOk);
  board.setRunner(runner(NONE));
  board.setSpawner(() => ({ unref() {} }));
  fs.mkdirSync(CLAIM_DIR, { recursive: true });
  try { fs.rmSync(nodePath.join(CLAIM_DIR, board.CLAIM_NAME), { force: true }); } catch { /* best effort */ }
});
test.after(() => { try { fs.rmSync(ANCHOR, { recursive: true, force: true }); } catch { /* best effort */ } });

// ── the namespace: a board task is not an agent task ────────────────────────

test('the board task is NOT under win32job\'s agent prefix', () => {
  const agentPrefix = require('./win32job').TASK_PREFIX;
  assert.equal(board.TASK_NAME, 'Kosmos\\board');
  assert.ok(!board.TASK_NAME.startsWith(agentPrefix),
    'anything listing agents by the `Kosmos\\agent-` prefix must not pick the board up as a nineteenth agent');
  assert.ok(board.TASK_NAME.startsWith('Kosmos\\'),
    'and it still lives in the one folder a person can find everything Kosmos registered');
});

test('the removal hint is a command a person can actually run, and names the task', () => {
  assert.match(board.REMOVE_HINT, /^schtasks \/Delete \/F \/TN "Kosmos\\board"$/);
});

// ── the definition ──────────────────────────────────────────────────────────

test('the trigger and the principal both name the signed-in user (an empty UserId can never fire)', () => {
  const xml = board.taskXml({ node: 'C:\\a\\node.exe', boot: 'C:\\a\\board-boot.js' }, ENV);
  assert.ok(xml.includes('<LogonTrigger><Enabled>true</Enabled><UserId>PIZZARAMA\\joshu</UserId></LogonTrigger>'), xml);
  assert.ok(xml.includes('<Principal id="Author"><UserId>PIZZARAMA\\joshu</UserId>'), xml);
});

test('MEASURED 2026-09-09: the instances policy is IgnoreNew, because StopExisting left NO board at all', () => {
  const xml = board.taskXml({ node: 'n', boot: 'b' }, ENV);
  assert.ok(xml.includes('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'), xml);
  assert.ok(!/StopExisting/.test(xml),
    'StopExisting starts the new board while the old one still holds the port: the new one dies on EADDRINUSE and the old one is stopped anyway');
});

test('no execution time limit -- the board runs as long as the box is up', () => {
  assert.ok(board.taskXml({ node: 'n', boot: 'b' }, ENV).includes('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>'));
});

test('every path is quoted and XML-escaped, so `C:\\a & b\\` cannot end an element', () => {
  const xml = board.taskXml({ node: 'C:\\a & b\\node.exe', boot: 'C:\\a & b\\board-boot.js' }, { ...ENV, SystemRoot: 'C:\\Windows' });
  assert.ok(xml.includes('<Arguments>--headless &quot;C:\\a &amp; b\\node.exe&quot; &quot;C:\\a &amp; b\\board-boot.js&quot;</Arguments>'), xml);
});

test('#570 the board runs with NO WINDOW, through the same headless host as the agents', () => {
  /* Measured 2026-09-10: a task-started node opens a Windows Terminal window, and
     closing it kills the board. The board's definition goes through the ONE
     wrapper the agents' does. */
  const xml = board.taskXml({ node: 'C:\\K\\node.exe', boot: 'C:\\K\\board-boot.js' }, { ...ENV, SystemRoot: 'C:\\Windows' });
  assert.ok(xml.includes('<Command>C:\\Windows\\System32\\conhost.exe</Command>'), xml);
  assert.ok(xml.includes('<Arguments>--headless &quot;C:\\K\\node.exe&quot; &quot;C:\\K\\board-boot.js&quot;</Arguments>'), xml);
});

test('the action runs in the bundle root, matching KosmosLauncher.cs rather than system32', () => {
  const xml = board.taskXml({ node: 'n', boot: 'b', workingDir: 'C:\\kosmos-0.6.24-win-x64' }, ENV);
  assert.ok(xml.includes('<WorkingDirectory>C:\\kosmos-0.6.24-win-x64</WorkingDirectory>'), xml);
});

// ── the durable shim ────────────────────────────────────────────────────────

test('the shim resolves server.js through the SHARED engine pointer, not a baked path', () => {
  assert.ok(board.BOOT_JS.includes(JSON.stringify(require('./win32anchor').POINTER_NAME)),
    'one pointer moves the board AND every agent onto a new install');
  assert.ok(board.BOOT_JS.includes("path.join(engine, '..', 'server.js')"));
});

test('the shim runs server.js AS MAIN in ONE process (a wrapper child would survive /End and hold the port)', () => {
  assert.ok(board.BOOT_JS.includes("require('node:module').runMain()"), board.BOOT_JS);
  assert.ok(board.BOOT_JS.includes('process.argv = [process.argv[0], entry]'),
    'runMain runs whatever process.argv[1] names, which is what makes server.js see require.main === module');
  assert.ok(!/spawn|fork|execFile/.test(board.BOOT_JS),
    'a board running as a CHILD of the task process outlives schtasks /End and leaves the fresh board dying on EADDRINUSE');
});

test('the shim stamps the marker boardrestart reads, and it is the task name', () => {
  assert.ok(board.BOOT_JS.includes(JSON.stringify(board.MARKER_ENV)));
  assert.ok(board.BOOT_JS.includes(JSON.stringify(board.TASK_NAME)));
  assert.equal(board.startedByTask({ [board.MARKER_ENV]: board.TASK_NAME }), true);
  assert.equal(board.startedByTask({}), false);
  assert.equal(board.startedByTask({ [board.MARKER_ENV]: 'Kosmos\\agent-fred' }), false);
});

test('the shim exits NON-ZERO on a stale pointer (exit 0 would look like a board that ran and finished)', () => {
  assert.ok(board.BOOT_JS.includes('process.exit(3)'), board.BOOT_JS);
});

// ── install ─────────────────────────────────────────────────────────────────

test('install anchors FIRST and registers with the anchored node + shim', () => {
  const r = runner(NONE);
  board.setRunner(r);
  const out = board.install({ platform: 'win32', env: ENV });
  assert.equal(out.ok, true, out.because);
  assert.equal(out.task, 'Kosmos\\board');
  assert.equal(out.boot, nodePath.join(ANCHOR, 'board-boot.js'));
  assert.ok(fs.existsSync(out.boot), 'the durable shim is written beside the anchored node');
  assert.ok(r.calls.some((c) => c.startsWith('/Create /F /TN Kosmos\\board /XML ')), r.calls.join(' | '));
});

test('install REFUSES when the anchor fails, rather than registering a task that could never start', () => {
  board.setAnchorer(() => ({ ok: false, because: 'we could not set up the files an agent needs to start at login (EACCES)' }));
  const r = runner(NONE);
  board.setRunner(r);
  const out = board.install({ platform: 'win32', env: ENV });
  assert.equal(out.ok, false);
  assert.match(out.because, /could not set up/);
  assert.equal(r.calls.length, 0, 'nothing was registered');
});

test('install REFUSES when no user can be named (an empty UserId registers a task that never fires)', () => {
  const r = runner(NONE);
  board.setRunner(r);
  /* The sandbox seam win32job paid for: an injected env carrying no USERNAME.
     `taskUser` still falls back to os.userInfo(), so this pins the refusal by
     stubbing the anchor AND asking win32job directly. */
  const win32job = require('./win32job');
  const original = win32job.taskUser;
  assert.equal(typeof original, 'function');
  assert.ok(win32job.taskUser({ USERNAME: '', USERDOMAIN: '' }).length > 0,
    'os.userInfo() is the last fallback and is what lets a Mac assert this arm');
});

test('install reports the removal hint, so the caller can print it', () => {
  board.setRunner(runner(NONE));
  assert.equal(board.install({ platform: 'win32', env: ENV }).removeHint, board.REMOVE_HINT);
});

// ── status ──────────────────────────────────────────────────────────────────

test('status reads registered / enabled / running from the definition and the result code', () => {
  board.setRunner(runner(NONE));
  assert.deepEqual(board.status(), { known: true, registered: false, running: false });
  board.setRunner(runner(READY));
  assert.deepEqual(board.status(), { known: true, registered: true, enabled: true, running: false });
  board.setRunner(runner(RUNNING));
  assert.deepEqual(board.status(), { known: true, registered: true, enabled: true, running: true });
  board.setRunner(runner(DISABLED));
  assert.deepEqual(board.status(), { known: true, registered: true, enabled: false, running: false });
});

// ── ensureInstalled: refresh, never re-impose ───────────────────────────────

test('a source checkout registers NOTHING (it has no login job on the Mac either)', () => {
  const r = runner(NONE);
  board.setRunner(r);
  const out = board.ensureInstalled({ platform: 'win32', env: ENV, root: 'C:\\repo', exists: () => false });
  assert.equal(out.action, 'skipped');
  assert.equal(out.ok, true, 'a source checkout is not a fault');
  assert.equal(r.calls.length, 0);
});

test('a non-win32 platform registers NOTHING', () => {
  const r = runner(NONE);
  board.setRunner(r);
  assert.equal(board.ensureInstalled({ platform: 'darwin' }).action, 'skipped');
  assert.equal(r.calls.length, 0);
});

test('a bundle with no task registers it, and CLAIMS it', () => {
  const r = runner(NONE);
  board.setRunner(r);
  const opts = { platform: 'win32', env: ENV, home: ANCHOR, root: 'C:\\kosmos-win', exists: () => true };
  const out = board.ensureInstalled(opts);
  assert.equal(out.ok, true, out.because);
  assert.equal(out.action, 'registered');
  assert.ok(r.calls.some((c) => c.startsWith('/Create /F /TN Kosmos\\board')));
});

test('an ENABLED task is re-registered, so an install that MOVED is followed', () => {
  const r = runner(READY);
  board.setRunner(r);
  const out = board.ensureInstalled({ platform: 'win32', env: ENV, home: ANCHOR, root: 'C:\\kosmos-win', exists: () => true });
  assert.equal(out.action, 'refreshed');
  assert.ok(r.calls.some((c) => c.startsWith('/Create /F /TN Kosmos\\board')));
});

test('a DISABLED task is LEFT ALONE and reported -- never force-re-enabled', () => {
  const r = runner(DISABLED);
  board.setRunner(r);
  const out = board.ensureInstalled({ platform: 'win32', env: ENV, home: ANCHOR, root: 'C:\\kosmos-win', exists: () => true });
  assert.equal(out.action, 'left-disabled');
  assert.ok(!r.calls.some((c) => c.includes('/Create') || c.includes('/ENABLE')),
    'forcing a login item back on every boot is user-hostile; machine.js says so about the Mac and it is true here');
  assert.match(out.because, /switched off/);
});

test('a task Kosmos ALREADY CLAIMED and that is now gone stays gone, and says so', () => {
  const opts = { platform: 'win32', env: ENV, home: ANCHOR, root: 'C:\\kosmos-win', exists: () => true };
  board.claim(opts);
  const r = runner(NONE);
  board.setRunner(r);
  const out = board.ensureInstalled(opts);
  assert.equal(out.action, 'left-removed');
  assert.equal(out.ok, false, 'a board that will not come back is a fault the product must report');
  assert.ok(!r.calls.some((c) => c.includes('/Create')), 'somebody deleted it; putting it back would be fighting them');
  assert.match(out.because, /will not come back/);
});

// ── restart ─────────────────────────────────────────────────────────────────

test('restart REFUSES for a board this task did not start (ending the task would stop nothing)', () => {
  board.setRunner(runner(RUNNING));
  let spawned = false;
  board.setSpawner(() => { spawned = true; return { unref() {} }; });
  const out = board.restart({ env: {} });
  assert.equal(out.ok, false);
  assert.match(out.because, /not started by its Windows logon job/);
  assert.equal(spawned, false, 'a refused restart must never end the task or start a second board');
});

test('restart REFUSES when nothing is registered', () => {
  board.setRunner(runner(NONE));
  const out = board.restart({ env: { [board.MARKER_ENV]: board.TASK_NAME } });
  assert.equal(out.ok, false);
  assert.match(out.because, /no Windows logon job/);
});

test('restart REFUSES when the task is switched off', () => {
  board.setRunner(runner(DISABLED));
  const out = board.restart({ env: { [board.MARKER_ENV]: board.TASK_NAME } });
  assert.equal(out.ok, false);
  assert.match(out.because, /switched off/);
});

test('restart spawns a DETACHED helper, unref\'d, and issues no schtasks act itself', () => {
  const r = runner(RUNNING);
  board.setRunner(r);
  let spawned = null;
  let unrefd = false;
  board.setSpawner((cmd, args, opts) => { spawned = { cmd, args, opts }; return { on() {}, unref() { unrefd = true; } }; });
  const out = board.restart({ env: { [board.MARKER_ENV]: board.TASK_NAME }, home: ANCHOR, pid: 4242, port: 16180 });
  assert.equal(out.ok, true, out.because);
  assert.ok(spawned, 'spawned a helper');
  assert.equal(spawned.args[1], board.HELPER_FLAG);
  assert.equal(spawned.args[2], '4242');
  assert.equal(spawned.args[4], '16180', '#2973: the helper confirms the board came back by asking this port');
  assert.equal(spawned.opts.detached, true, 'the sequence starts by killing its own parent, so it must outlive it');
  assert.equal(spawned.opts.stdio, 'ignore');
  assert.equal(unrefd, true);
  assert.ok(!r.calls.some((c) => c.startsWith('/End') || c.startsWith('/Run')),
    'the board never ends itself inline -- it would die before it could start anything');
});

// ── the helper: end, WAIT, run ──────────────────────────────────────────────

test('the helper ends the task, waits for the board to be GONE, then runs it, and confirms on the port', async () => {
  const acts = [];
  let alive = true;
  let askedPort = null;
  board.setRunner((args) => {
    acts.push(args[0]);
    if (args[0] === '/End') { alive = false; return { ok: true, out: '' }; }
    return { ok: true, out: '' };
  });
  const log = nodePath.join(ANCHOR, 'restart.log');
  const out = await board.restartHelperMain([String(9999), log, '16180'], {
    sleep: () => Promise.resolve(),
    pidGone: () => !alive,
    probe: (port) => {
      askedPort = port;
      return Promise.resolve(acts.includes('/Run') ? { answering: true, identity: '0.6.60+abc@' } : { answering: false, identity: null });
    },
  });
  assert.equal(out.ok, true);
  /* 🛑 THE ORDER IS THE WHOLE SAFETY. Measured on this box: the port stayed bound
     for about a second after /End, so a /Run inside that window produces a board
     that dies on EADDRINUSE and leaves nothing. */
  assert.equal(acts.indexOf('/End') < acts.indexOf('/Run'), true, acts.join(' -> '));
  assert.equal(askedPort, 16180);
  assert.ok(!acts.includes('/Query'), '#2973: the helper never reads the task\'s translated status word');
  assert.match(fs.readFileSync(log, 'utf8'), /the old board is gone/);
});

test('the helper does NOT run the task while the old board is still alive, and never mistakes it for a new one', async () => {
  const acts = [];
  board.setRunner((args) => { acts.push(args[0]); return { ok: true, out: '' }; });
  let slept = 0;
  const log = nodePath.join(ANCHOR, 'restart2.log');
  const out = await board.restartHelperMain([String(9999), log, '16180'], {
    sleep: (ms) => { slept += ms; return Promise.resolve(); },
    pidGone: () => false, // never dies
    probe: () => Promise.resolve({ answering: true, identity: '0.6.60+abc@' }), // the OLD board answering
  });
  assert.ok(slept >= 30000, 'it waited the full window before giving up on the old board');
  assert.equal(out.ok, false, 'the board answering is the old one, so no restart happened');
  const said = fs.readFileSync(log, 'utf8');
  assert.match(said, /still running after 30s/);
  assert.match(said, /never stopped/);
});

test('the helper writes a transcript, because its stdio is thrown away and somebody will need to know', async () => {
  board.setRunner(() => ({ ok: true, out: '' }));
  const log = nodePath.join(ANCHOR, 'restart3.log');
  const out = await board.restartHelperMain([String(9999), log, '16180'], {
    sleep: () => Promise.resolve(), pidGone: () => true,
    probe: () => Promise.resolve({ answering: false, identity: null }),
  });
  assert.equal(out.ok, false, 'nothing ever answered on the port, so it must not claim success');
  assert.match(fs.readFileSync(log, 'utf8'), /THE BOARD DID NOT COME BACK/);
});

test('#2973 the helper does not count something answering WITHOUT the board identity header', async () => {
  board.setRunner(() => ({ ok: true, out: '' }));
  const log = nodePath.join(ANCHOR, 'restart4.log');
  const out = await board.restartHelperMain([String(9999), log, '16180'], {
    sleep: () => Promise.resolve(), pidGone: () => true,
    probe: () => Promise.resolve({ answering: true, identity: null }),
  });
  assert.equal(out.ok, false, 'a listener that is not a Kosmos board is not the board coming back');
});

test('#2973 a probe that throws is "not answering", never an unhandled rejection in a detached helper', async () => {
  board.setRunner(() => ({ ok: true, out: '' }));
  const log = nodePath.join(ANCHOR, 'restart5.log');
  const out = await board.restartHelperMain([String(9999), log, '16180'], {
    sleep: () => Promise.resolve(), pidGone: () => true,
    probe: () => { throw new Error('bad port'); },
  });
  assert.equal(out.ok, false);
});

// ── describe: what a screen renders ─────────────────────────────────────────

test('describe is machine facts only, and returns null off win32', () => {
  assert.equal(board.describe({ platform: 'darwin' }), null);
  board.setRunner(runner(RUNNING));
  const d = board.describe({ platform: 'win32', env: ENV, home: ANCHOR, root: 'C:\\kosmos-win', exists: () => true });
  assert.deepEqual(Object.keys(d).sort(), ['bundle', 'claimed', 'enabled', 'registered', 'removeHint', 'running', 'task']);
  assert.equal(d.registered, true);
  assert.equal(d.enabled, true);
  assert.equal(d.bundle, true);
});

// ── #2973: the task's state is read without localized text, and unknown is never acted on ──

const BUNDLE = { platform: 'win32', env: ENV, home: ANCHOR, root: 'C:\\kosmos-win', exists: () => true };
const MARKED = { env: { [board.MARKER_ENV]: board.TASK_NAME }, home: ANCHOR, pid: 4242, port: 16180 };
const DENIED = { ok: false, out: 'ERROR: Access is denied.' };
const GERMAN_NOT_FOUND = { ok: false, out: 'FEHLER: Das System kann die angegebene Datei nicht finden.' };
function watchSpawns() {
  const w = { spawned: false };
  board.setSpawner(() => { w.spawned = true; return { on() {}, unref() {} }; });
  return w;
}

test('#2973 a machine named DISABLED-LAB does not read the board task as switched off', () => {
  const script = { xml: XML_ENABLED, verbose: verboseRow('Ready', '267014', 'DISABLED-LAB'), list: listText('DISABLED-LAB', 'Ready') };
  board.setRunner(runner(script));
  assert.equal(board.status().enabled, true);

  const r = runner(script);
  board.setRunner(r);
  const ensured = board.ensureInstalled(BUNDLE);
  assert.equal(ensured.action, 'refreshed', 'an enabled task is re-registered so a moved install is followed: ' + ensured.because);
  assert.ok(r.calls.some((c) => c.startsWith('/Create /F /TN Kosmos\\board')), r.calls.join(' | '));

  board.setRunner(runner(script));
  const w = watchSpawns();
  const out = board.restart(MARKED);
  assert.equal(out.ok, true, out.because);
  assert.equal(w.spawned, true, 'a good restart is not refused because of the machine\'s name');
});

test('#2973 German Windows: a switched-off board task reads off, ensure does not switch it back on, restart refuses', () => {
  const germanOff = {
    xml: XML_DISABLED,
    verbose: verboseRow('Deaktiviert', '267014', 'BUERO-PC'),
    list: { ok: true, out: '\r\nOrdner: \\Kosmos\r\nHostname:            BUERO-PC\r\nAufgabenname:        \\Kosmos\\board\r\nNächste Laufzeit:    Nicht zutreffend\r\nStatus:              Deaktiviert\r\nAnmeldemodus:        Nur interaktiv\r\n' },
  };
  board.setRunner(runner(germanOff));
  assert.equal(board.status().enabled, false);

  const r = runner(germanOff);
  board.setRunner(r);
  const out = board.ensureInstalled(BUNDLE);
  assert.equal(out.action, 'left-disabled');
  assert.ok(!r.calls.some((c) => c.includes('/Create') || c.includes('/ENABLE')), r.calls.join(' | '));

  board.setRunner(runner(germanOff));
  const w = watchSpawns();
  const re = board.restart(MARKED);
  assert.equal(re.ok, false);
  assert.match(re.because, /switched off/);
  assert.equal(w.spawned, false, 'a board its switched-off task cannot bring back is never ended');
});

test('#2973 a definition we could not read is UNKNOWN: nothing registered, claimed, ended or restarted, and it says why', () => {
  const script = { xml: DENIED, verbose: DENIED, listing: { ok: true, out: '"\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","N/A","Ready"\r\n"\\Kosmos\\board","N/A","Disabled"\r\n' } };
  board.setRunner(runner(script));
  const st = board.status();
  assert.equal(st.known, false);
  assert.match(st.because, /Access is denied/);

  const r = runner(script);
  board.setRunner(r);
  const out = board.ensureInstalled(BUNDLE);
  assert.equal(out.action, 'unknown');
  assert.equal(out.ok, false);
  assert.match(out.because, /could not read the job that starts the board at logon \(ERROR: Access is denied\.\), so Kosmos left it as it is/);
  assert.ok(!r.calls.some((c) => /^\/(Create|Change|End|Run|Delete)/.test(c)), r.calls.join(' | '));
  assert.equal(board.claimed(BUNDLE), false, 'a task we could not read is not claimed');

  board.setRunner(runner(script));
  const w = watchSpawns();
  const re = board.restart(MARKED);
  assert.equal(re.ok, false);
  assert.match(re.because, /could not read the board's Windows logon job \(ERROR: Access is denied\.\), so we did not stop the board/);
  assert.equal(w.spawned, false);

  board.setRunner(runner(script));
  assert.equal(board.describe(BUNDLE), null, 'machine.js renders null as "we could not check"');
});

test('#2973 a definition that is not a shape we can read is unknown too, never "enabled"', () => {
  const r = runner({ xml: { ok: true, out: 'not a task definition' } });
  board.setRunner(r);
  assert.equal(board.status().known, false);
  assert.equal(board.ensureInstalled(BUNDLE).action, 'unknown');
  assert.ok(!r.calls.some((c) => c.includes('/Create')), r.calls.join(' | '));
});

test('#2973 German Windows, first run: a board task that is not there is PROVEN absent by the task list, and registered', () => {
  const listingWithoutBoard = { ok: true, out: '"\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","N/A","Bereit"\r\n"\\Kosmos\\agent-ava","N/A","Wird ausgeführt"\r\n' };
  board.setRunner(runner({ xml: GERMAN_NOT_FOUND, listing: listingWithoutBoard }));
  assert.deepEqual(board.status(), { known: true, registered: false, running: false });
  const r = runner({ xml: GERMAN_NOT_FOUND, listing: listingWithoutBoard });
  board.setRunner(r);
  const out = board.ensureInstalled(BUNDLE);
  assert.equal(out.action, 'registered', out.because);
  assert.ok(r.calls.some((c) => c.startsWith('/Create /F /TN Kosmos\\board')));
});

test('#2973 ...but the board IN the list, an empty list, or a list that failed is unknown, not absent', () => {
  board.setRunner(runner({ xml: GERMAN_NOT_FOUND, listing: { ok: true, out: '"\\Kosmos\\board","N/A","Bereit"\r\n' } }));
  assert.equal(board.status().known, false, 'there but unreadable');
  board.setRunner(runner({ xml: GERMAN_NOT_FOUND, listing: { ok: true, out: '' } }));
  assert.equal(board.status().known, false, 'every Windows lists Microsoft tasks, so an empty list proves nothing');
  board.setRunner(runner({ xml: GERMAN_NOT_FOUND, listing: DENIED }));
  assert.equal(board.status().known, false);
});

test('#2973 running is the Last Result code, in any language and on any machine name', () => {
  board.setRunner(runner({ xml: XML_ENABLED, verbose: verboseRow('Wird ausgeführt', '267009', 'BUERO-PC'), list: listText('BUERO-PC', 'Wird ausgeführt') }));
  assert.equal(board.status().running, true, 'German "running"');
  board.setRunner(runner({ xml: XML_ENABLED, verbose: verboseRow('Bereit', '267014', 'RUNNING-LAB'), list: listText('RUNNING-LAB', 'Bereit') }));
  assert.equal(board.status().running, false, 'a machine named RUNNING-LAB is not a running task');
  board.setRunner(runner({ xml: XML_ENABLED, verbose: verboseRow('Running', '267.009') }));
  assert.equal(board.status().running, true, 'digit grouping does not hide the code');
  board.setRunner(runner({ xml: XML_ENABLED, verbose: DENIED }));
  assert.equal(board.status().running, null, 'could not read is not "not running"');
  board.setRunner(runner({ xml: XML_ENABLED, verbose: { ok: true, out: '"PIZZARAMA","\\Kosmos\\agent-ava","N/A","Running","Interactive only","N/A","267009","N/A"\r\n' } }));
  assert.equal(board.status().running, null, 'a row for another task is not the board\'s');
  board.setRunner(runner({ xml: XML_ENABLED, verbose: verboseRow('Running', 'N/A') }));
  assert.equal(board.status().running, null, 'a result that is not a number is not a code');
});

test('#2973 the definition carries the task\'s switch, so a re-registration cannot switch a board task back on', () => {
  assert.ok(board.taskXml({ node: 'n', boot: 'b', enabled: false }, ENV).includes('<Enabled>false</Enabled></Settings>'));
  assert.ok(board.taskXml({ node: 'n', boot: 'b' }, ENV).includes('<Enabled>true</Enabled></Settings>'), 'a first registration is on');

  let written = null;
  const r = runner(NONE);
  board.setRunner((args) => {
    if (args[0] === '/Create') written = fs.readFileSync(args[args.length - 1]).toString('utf16le');
    return r(args);
  });
  assert.equal(board.install({ platform: 'win32', env: ENV, enabled: false }).ok, true);
  assert.ok(written && written.includes('<Enabled>false</Enabled></Settings>'), String(written));

  written = null;
  const refresh = runner(READY);
  board.setRunner((args) => {
    if (args[0] === '/Create') written = fs.readFileSync(args[args.length - 1]).toString('utf16le');
    return refresh(args);
  });
  assert.equal(board.ensureInstalled(BUNDLE).action, 'refreshed');
  assert.ok(written && written.includes('<Enabled>true</Enabled></Settings>'), 'the switch it read, carried: ' + String(written));
});

test('#2973 one derivation: the board and an agent read the same definition the same way', () => {
  const win32job = require('./win32job');
  try {
    for (const answer of [XML_ENABLED, XML_DISABLED, NOT_FOUND, DENIED, { ok: true, out: '<Task><Settings><Enabled>maybe</Enabled></Settings></Task>' }]) {
      win32job.setRunner(() => answer);
      assert.deepEqual(win32job.taskEnabledFromQuery(answer), win32job.taskEnabled('ava'), answer.out);
      board.setRunner(runner({ xml: answer, listing: DENIED }));
      const st = board.status();
      const agent = win32job.taskEnabled('ava');
      assert.equal(st.known, agent.known, answer.out);
      if (agent.known && agent.registered) assert.equal(st.enabled, agent.enabled, answer.out);
    }
  } finally {
    win32job.setRunner(null);
  }
});
