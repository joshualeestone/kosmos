'use strict';
/**
 * #570: the at-logon job -- launchd's RunAtLoad half, on Windows.
 *
 * The command seam means every arm runs on any platform without registering a
 * real Scheduled Task. What is pinned is the CONTRACT: the argument vector the
 * task runs, quoting, idempotence, and -- most of all -- that STOP disables the
 * job rather than killing a process.
 *
 *   node --test engine/win32job.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const job = require('./win32job');
const sup = require('./win32supervisor');
const anchor = require('./win32anchor');

test.after(() => job.setRunner(null));

/** Record schtasks invocations instead of running them. */
function recording(reply) {
  const calls = [];
  job.setRunner((args) => { calls.push(args); return reply || { ok: true, out: '' }; });
  return calls;
}

/**
 * A sandboxed anchor: a temp data root and a STAND-IN node.
 *
 * ⚠️ THE STAND-IN MATTERS. `install()` now copies the interpreter, and the real
 * one is 92 MB -- a suite that copied it per arm would be slow enough that people
 * stop running it, and it would write into the operator's real %LOCALAPPDATA%.
 * The copy path is what is under test, not the bytes, so a one-line file proves
 * it exactly as well.
 */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-anchor-'));
  const srcNode = path.join(dir, 'node.exe');
  fs.writeFileSync(srcNode, 'not really node, but a file with a size', 'utf8');
  return {
    dir,
    spec: {
      platform: 'win32',
      home: 'C:\\Users\\test',
      env: { AGENT_WORKFORCE_DATA: dir },
      node: srcNode,
      engineDir: 'C:\\Kosmos\\0.6.24\\app\\engine',
    },
  };
}

test('#570 the job starts ONE supervisor at logon, with the agent as arguments', () => {
  const calls = recording();
  const sb = sandbox();
  const r = job.install({ name: 'winagent-1', cwd: 'C:\\work\\winagent-1', model: 'haiku', ...sb.spec });
  assert.equal(r.ok, true, r.because || '');
  assert.equal(calls.length, 1);

  const args = calls[0];
  assert.equal(args[0], '/Create');
  assert.ok(args.includes('/F'), 're-registering must overwrite, or a spec change never takes');
  assert.deepEqual([args[args.indexOf('/SC') + 1]], ['ONLOGON'], 'RunAtLoad analog');

  const cmd = args[args.indexOf('/TR') + 1];
  assert.match(cmd, /supervisor-boot\.js/, 'it runs the ONE shared supervisor, through the durable shim');
  assert.match(cmd, /winagent-1/, 'and the agent arrives as an argument, not as a copy of the script');
});

test('#570 A REGISTERED TASK NAMES NOTHING UNDER THE APP -- an update must not strand it', () => {
  /* 🛑 The defect this pins. A Scheduled Task is durable; the Windows bundle is a
     portable zip extracted into a versioned folder. If the task command carried
     `process.execPath` (<extract-root>/runtime/node.exe) or `__dirname`
     (<extract-root>/app/engine), the next update would leave every task pointing
     at a path that is gone -- and nothing reports it: the task stays registered,
     stays enabled, and simply never starts anything at logon.

     Pinning "the app root appears nowhere in the command" is the load-bearing
     assertion, because it fails for BOTH halves (node and the script) and it
     fails no matter which one someone reintroduces. */
  const calls = recording();
  const sb = sandbox();
  const r = job.install({ name: 'winagent-2', cwd: 'C:\\work\\winagent-2', ...sb.spec });
  assert.equal(r.ok, true, r.because || '');

  const cmd = calls[0][calls[0].indexOf('/TR') + 1];
  assert.ok(!cmd.includes(sb.spec.engineDir), 'the ephemeral engine dir must not reach a durable task: ' + cmd);
  assert.ok(!cmd.includes(path.dirname(sb.spec.node)) || cmd.includes(sb.dir),
    'the source node must not reach a durable task unless it is the anchored copy');
  assert.ok(cmd.includes(sb.dir), 'both paths come from the anchor: ' + cmd);
});

test('#570 the anchor is what a stale task follows, and it is refreshed on install', () => {
  /* 🔑 ONE POINTER, EVERY TASK. The durability claim rests on this: the shim is
     fixed forever and the pointer beside it decides which app runs. Refreshing it
     once must move every registered agent -- so a second install with a NEW
     engine dir has to rewrite it, or an update would strand every agent created
     before the update. */
  recording();
  const sb = sandbox();
  job.install({ name: 'winagent-3', cwd: 'C:\\work\\a', ...sb.spec });
  assert.equal(anchor.readPointer('win32', sb.spec.home, sb.spec.env), sb.spec.engineDir);

  const moved = 'C:\\Kosmos\\0.6.25\\app\\engine';
  job.install({ name: 'winagent-3', cwd: 'C:\\work\\a', ...sb.spec, engineDir: moved });
  assert.equal(anchor.readPointer('win32', sb.spec.home, sb.spec.env), moved,
    'an app that moved must take effect through the pointer, not through re-registering N tasks');
});

test('#570 a job is REFUSED when the anchor cannot be written, not registered to fail later', () => {
  /* A task registered against an anchor that does not exist would fail silently
     at some logon months from now. Refusing at create time is the only moment a
     person is present to read the sentence. */
  const calls = recording();
  const r = job.install({
    name: 'winagent-4', cwd: 'C:\\work\\a',
    platform: 'win32', home: 'C:\\Users\\test',
    env: { AGENT_WORKFORCE_DATA: 'relative/not/absolute' },
  });
  assert.equal(r.ok, false);
  assert.match(r.because, /could not/i);
  assert.equal(calls.length, 0, 'nothing may be registered when the anchor failed');
});

test('#570 every path in the command is quoted', () => {
  /* `C:\Program Files\...` is an ordinary install location. An unquoted argument
     truncates at the space, the task registers happily, and it runs the wrong
     thing -- a failure with no error anywhere. */
  const cmd = job.taskCommand({
    name: 'spacey', cwd: 'C:\\Users\\a b\\work', node: 'C:\\Program Files\\Kosmos\\runtime\\node.exe',
    supervisor: 'C:\\Program Files\\Kosmos\\app\\engine\\win32supervisor.js',
  });
  const unquoted = cmd.split(' ').filter((tok) => /^[A-Za-z]:\\/.test(tok));
  assert.deepEqual(unquoted, [], 'no bare drive-letter path may appear outside quotes: ' + cmd);
  assert.match(cmd, /^"[^"]+" "[^"]+"/, 'interpreter and script are each quoted');
});

test('#570 the argument vector is POSITIONAL and never shifts', () => {
  /* The Mac's contract for agent-supervisor.sh: positional, append-only, every
     new argument optional and defaulted. A missing middle value is '-' rather
     than omitted, or a task registered before the argument existed would feed
     the next value into the wrong slot. */
  const cmd = job.taskCommand({ name: 'n', cwd: 'C:\\w', configDir: 'C:\\cfg' });
  const quoted = cmd.match(/"[^"]*"/g).map((s) => s.slice(1, -1));
  const argv = quoted.slice(2);   // after node + supervisor
  assert.deepEqual(argv, ['n', 'C:\\w', '-', 'C:\\cfg', 'claude']);

  // and the supervisor reads them back the same way, including the '-' holes
  const spec = sup.specFromArgv(argv);
  assert.equal(spec.name, 'n');
  assert.equal(spec.cwd, 'C:\\w');
  assert.equal(spec.model, undefined, 'a dash is a HOLE, not a model called "-"');
  assert.equal(spec.configDir, 'C:\\cfg');
  assert.equal(spec.runner, 'claude');
});

test('#570 STOP DISABLES THE JOB -- it does not kill a process', () => {
  /* 🛑 THE DISTINCTION THAT MAKES "stopped" MEAN ANYTHING. A death leaves the job
     in place so the agent comes back (correct). A deliberate stop has to outlive
     the next logon, which only a job-level change does. Killing processes would
     be undone the moment somebody signs in -- the Mac's ordering comment warns
     about exactly this, one platform over. */
  const calls = recording();
  const r = job.disable('winagent-1');
  assert.equal(r.ok, true, r.because || '');
  assert.deepEqual(calls[0], ['/Change', '/TN', 'Kosmos\\agent-winagent-1', '/DISABLE']);
  assert.ok(!calls.flat().some((a) => /taskkill|Stop-Process|\/End/i.test(String(a))),
    'stopping must not be spelled as killing');
});

test('#570 enable is the exact inverse, so a stop is restorable', () => {
  const calls = recording();
  assert.equal(job.enable('winagent-1').ok, true);
  assert.deepEqual(calls[0], ['/Change', '/TN', 'Kosmos\\agent-winagent-1', '/ENABLE']);
});

test('#570 removing a job that was never registered is not an error', () => {
  job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
  assert.equal(job.remove('never-existed').ok, true,
    'a delete is idempotent, the same posture win32sessions.forget takes');
  job.setRunner(() => ({ ok: false, out: 'ERROR: Access is denied.' }));
  assert.equal(job.remove('denied').ok, false, 'but a REAL failure is still reported');
});

test('#570 status reports registered/enabled, and fails toward the honest answer', () => {
  job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
  assert.deepEqual(job.status('gone'), { registered: false });

  job.setRunner(() => ({ ok: true, out: 'TaskName: Kosmos\\agent-a\nStatus: Ready\n' }));
  assert.deepEqual(job.status('a'), { registered: true, enabled: true });

  job.setRunner(() => ({ ok: true, out: 'TaskName: Kosmos\\agent-a\nScheduled Task State: Disabled\n' }));
  assert.deepEqual(job.status('a'), { registered: true, enabled: false },
    'the DISABLED token is what is read -- defaulting to enabled would claim a stopped agent is running');
});
