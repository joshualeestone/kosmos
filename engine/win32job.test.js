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

/* #2603: run this file from an ISOLATED temp cwd. Arms here reach
   anchor.ensureAnchored({platform:'win32'}), which does a real `fs.mkdirSync` of a
   `path.win32.join(...)` (backslash) path; on macOS that lands as a cwd-relative
   backslash-named dir (`\private\var\...\runtime`) that dirties the worktree. The
   tests still pass and run-tests.sh exits 0, but the challenge-loop validation
   helper then reads the dirty tree as failed -- turning the local validation gate
   permanently red on every macOS worktree. Isolating cwd here PREVENTS the leak
   reaching the worktree (it lands in the temp dir, removed below) even if an arm
   throws. Assertions resolve against the same cwd the mkdir used, so they are
   unaffected. Worktree cleanliness does not depend on process isolation: the chdir
   runs at load before any test. (Node isolates each test file in its own process by
   DEFAULT -- run-tests.sh passes no --test-isolation flag -- and even a shared process
   keeps the worktree clean, verified.) */
const _win32OrigCwd = process.cwd();
const _win32LeakCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win32-cwd-'));
process.chdir(_win32LeakCwd);

test.after(() => job.setRunner(null));
test.after(() => {
  try { process.chdir(_win32OrigCwd); } catch { /* the process is ending anyway */ }
  try { fs.rmSync(_win32LeakCwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

/**
 * Record schtasks invocations instead of running them.
 *
 * ⚠️ IT READS THE /XML FILE WHILE IT STILL EXISTS. `install` writes the task
 * definition to a temp file, shells `schtasks /Create /XML <file>`, and deletes
 * it in a `finally` -- so the only moment its content can be seen is inside this
 * stub. Capturing it here is what lets the arms below assert what was actually
 * registered rather than only that something was.
 */
function recording(reply) {
  const calls = [];
  job.setRunner((args) => {
    const at = args.indexOf('/XML');
    let xml = null;
    if (at >= 0 && args[at + 1]) {
      try { xml = fs.readFileSync(args[at + 1], 'utf16le').replace(/^﻿/, ''); } catch { xml = null; }
    }
    /* ⚠️ Attached ONLY when there is one. Hanging a property on every recorded
       array breaks the `deepEqual` arms below, which compare the argument vector
       for the verbs that carry no XML (disable, enable, end, run). */
    const rec = args.slice();
    if (xml !== null) rec.xml = xml;
    calls.push(rec);
    return reply || { ok: true, out: '' };
  });
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
  /* ⚠️ realpathSync, and it is the fleet's Macs that need it. macOS's tmpdir is a
     symlink (`/var/...` -> `/private/var/...`), so the raw mkdtemp path and the
     path the anchor reports back are different STRINGS for one directory -- and
     the anchor assertions below are `cmd.includes(sb.dir)`, which then fails on a
     Mac while passing on Windows. That is this branch's own recurring shape: a
     win32 arm asserted from a Mac, defeated by a platform difference in the test
     rather than in the code. `create.win32-launch-570.test.js` already resolves
     its sandbox for the same reason; this one did not. */
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-anchor-')));
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

  /* 🛑 REGISTERED FROM XML, NEVER `/SC ONLOGON`. Measured unelevated on a real box
     2026-09-08: `/SC ONLOGON` fails with "Access is denied" while `/SC ONCE` and
     `/SC MINUTE` succeed from the same shell, because ONLOGON builds a trigger
     with no UserId -- "at ANY user's logon" -- which is a machine-wide act.
     Kosmos runs as an ordinary desktop user, so that spelling would have shipped
     a keep-alive that failed to register for everyone. */
  assert.ok(args.includes('/XML'), 'the task is created from a definition, not from /SC');
  assert.ok(!args.includes('ONLOGON'), '/SC ONLOGON requires administrator and must never come back');

  assert.match(args.xml, /<LogonTrigger>/, 'it is still the RunAtLoad analog');
  assert.match(args.xml, /<LogonTrigger>[\s\S]*<UserId>[^<]+<\/UserId>[\s\S]*<\/LogonTrigger>/,
    'and the trigger names ONE user, which is what makes it need no elevation');
  assert.match(args.xml, /supervisor-boot\.js/, 'it runs the ONE shared supervisor, through the durable shim');
  assert.match(args.xml, /winagent-1/, 'and the agent arrives as an argument, not as a copy of the script');
});

test('#570 a path with an XML metacharacter cannot break the definition', () => {
  /* `C:\a & b\node.exe` is an ordinary folder, and a bare `&` makes the document
     unparseable -- schtasks would refuse it, which is the loud failure; worse
     would be a `<` closing an element early. The command line form quoted; this
     form escapes. */
  const xml = job.taskXml({
    name: 'amp', cwd: 'C:\\work\\a & b', node: 'C:\\a & b\\node.exe',
    supervisor: 'C:\\a & b\\supervisor-boot.js',
  }, { USERDOMAIN: 'DOM', USERNAME: 'jo' });
  assert.ok(!/&(?!amp;|quot;|apos;|lt;|gt;)/.test(xml), 'every bare ampersand must be escaped: ' + xml);
  assert.match(xml, /C:\\a &amp; b\\node\.exe/);
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

  const cmd = calls[0].xml;
  /* ⚠️ COMPARED SEPARATOR-INSENSITIVELY, and only because the SANDBOX is a POSIX
     path on a Mac. This drives the win32 arm, so the anchor joins with
     `path.win32` and the result comes back separator-normalized: the temp dir
     `/private/var/.../kosmos-anchor-x` appears in the XML as
     `\private\var\...\kosmos-anchor-x`. Same directory, different spelling, so a
     raw `includes` failed on the fleet's Macs and passed on Windows.

     🔑 The claim here is WHICH DIRECTORY the two paths come from, not how its
     separators are drawn -- so the comparison is made on that, and normalising
     both sides makes the negative assertion strictly stronger rather than weaker.
     Production never sees this: a real Windows anchor is a Windows path already. */
  const norm = (s) => String(s).replace(/[\\/]+/g, '/');
  assert.ok(!norm(cmd).includes(norm(sb.spec.engineDir)), 'the ephemeral engine dir must not reach a durable task: ' + cmd);
  assert.ok(norm(cmd).includes(norm(sb.dir)), 'both paths come from the anchor: ' + cmd);
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

test('#570 THE TASK RUNS WITH NO WINDOW: node is started under a headless conhost', () => {
  /* 🛑 Measured 2026-09-10: a task that starts node.exe directly opens a Windows
     Terminal window, and closing it killed the agent (0xC000013A). Josh closed
     exactly those windows. The definition must start the headless host, and hand
     it the SAME command it used to run. */
  const env = { USERDOMAIN: 'DOM', USERNAME: 'jo', SystemRoot: 'C:\\Windows' };
  const spec = { name: 'quiet', cwd: 'C:\\work\\quiet', node: 'C:\\K\\node.exe', supervisor: 'C:\\K\\supervisor-boot.js' };
  const xml = job.taskXml(spec, env);
  assert.ok(xml.includes('<Command>C:\\Windows\\System32\\conhost.exe</Command>'), xml);
  const inner = job.taskExec(spec);
  assert.ok(xml.includes('<Arguments>--headless &quot;C:\\K\\node.exe&quot; '), 'headless first, then the quoted node: ' + xml);
  assert.ok(xml.includes(inner.args.replace(/&/g, '&amp;').replace(/"/g, '&quot;')), 'and every argument it used to get, unchanged');
});

test('#570 the headless host follows SystemRoot, so Windows on another drive still starts', () => {
  const exec = job.headlessExec({ command: 'C:\\K\\node.exe', args: '"a"' }, { SystemRoot: 'D:\\WINNT' });
  assert.equal(exec.command, 'D:\\WINNT\\System32\\conhost.exe');
  assert.equal(exec.args, '--headless "C:\\K\\node.exe" "a"');
});

/* The joined command line, rebuilt from what actually ships. `taskCommand` used
   to return this, but nothing in production called it -- `taskXml` builds the
   definition from `taskExec` -- so it was a second derivation of the command
   string kept alive only by these two tests, and the #265 orphan guard was right
   to flag it. The assertions below are about quoting and argument POSITION, which
   are properties of taskExec's output, so they are made on that directly. */
function joined(spec) {
  const e = job.taskExec(spec);
  return '"' + e.command + '" ' + e.args;
}

test('#570 every path in the command is quoted', () => {
  /* `C:\Program Files\...` is an ordinary install location. An unquoted argument
     truncates at the space, the task registers happily, and it runs the wrong
     thing -- a failure with no error anywhere. */
  const cmd = joined({
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
  const cmd = joined({ name: 'n', cwd: 'C:\\w', configDir: 'C:\\cfg' });
  const quoted = cmd.match(/"[^"]*"/g).map((s) => s.slice(1, -1));
  const argv = quoted.slice(2);   // after node + supervisor
  assert.deepEqual(argv, ['n', 'C:\\w', '-', 'C:\\cfg', 'claude', '-']);

  // and the supervisor reads them back the same way, including the '-' holes
  const spec = sup.specFromArgv(argv);
  assert.equal(spec.name, 'n');
  assert.equal(spec.cwd, 'C:\\w');
  assert.equal(spec.model, undefined, 'a dash is a HOLE, not a model called "-"');
  assert.equal(spec.configDir, 'C:\\cfg');
  assert.equal(spec.runner, 'claude');
  assert.equal(spec.claudeBin, undefined, 'and the sixth is a hole too when nothing resolved');

  /* 🔑 APPEND-ONLY, PROVEN BY READING AN OLD VECTOR. A task registered before
     `claudeBin` existed passes five arguments and must keep working -- that is the
     whole reason the contract is positional and append-only rather than tidy. */
  const old = sup.specFromArgv(['n', 'C:\\w', '-', 'C:\\cfg', 'claude']);
  assert.equal(old.name, 'n');
  assert.equal(old.runner, 'claude');
  assert.equal(old.claudeBin, undefined);
});

test('#570 7c-2 the RESOLVED runner rides on the task line, and a hole is not a path', () => {
  /* 🛑 THE FACT THAT GOT LOST WHEN THE TASK BECAME THE LAUNCHER. create.js resolves
     the runner (runners.resolveBin, with the PATHEXT candidates #570 added) and used
     to hand that path straight to the spawn. Once the supervisor did the spawning,
     the only facts reaching it were the ones on this line -- and the resolved path
     was not one of them, so every task-started agent fell back to a bare `claude`
     and depended on the logon PATH carrying %USERPROFILE%\.local\bin. */
  const cmd = joined({ name: 'n', cwd: 'C:\\w', claudeBin: 'C:\\Users\\j\\.local\\bin\\claude.exe' });
  const argv = cmd.match(/"[^"]*"/g).map((s) => s.slice(1, -1)).slice(2);
  assert.equal(argv[5], 'C:\\Users\\j\\.local\\bin\\claude.exe');
  assert.equal(sup.specFromArgv(argv).claudeBin, 'C:\\Users\\j\\.local\\bin\\claude.exe');
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

/* ─────────────────────────────────────────────────────────────────────────────
 * #2614: configDirFor reads the account dir back from the Scheduled Task argv,
 * so restore-refuse (#2609) can run on Windows where there is no plist. Every arm
 * round-trips through taskXml -- the same writer schtasks would have stored -- so
 * the reader is tested against the real registered shape, not a hand-built string.
 * ───────────────────────────────────────────────────────────────────────────*/
test('#2614 configDirFor reads the configDir back out of the task the writer registered', () => {
  const configDir = 'C:\\Users\\kitty\\.claude';
  const xml = job.taskXml(
    { name: 'kitty', cwd: 'C:\\work', configDir, node: 'C:\\node.exe', supervisor: 'C:\\app\\win32supervisor.js' },
    { USERNAME: 'kitty', USERDOMAIN: 'BOX' });
  job.setRunner((args) => (args.includes('/Query') && args.includes('/XML')
    ? { ok: true, out: xml } : { ok: false, out: 'unexpected verb' }));
  assert.deepEqual(job.configDirFor('kitty'), { known: true, configDir });
});

test('#2614 configDirFor round-trips a configDir carrying an XML metacharacter', () => {
  // taskXml escapes `&` in the argv; configDirFor must unescape it or the read
  // path silently returns a different directory than the one the agent ran on.
  const configDir = 'C:\\Users\\a & b\\.claude';
  const xml = job.taskXml(
    { name: 'amp', cwd: 'C:\\work', configDir, node: 'C:\\node.exe', supervisor: 'C:\\app\\win32supervisor.js' },
    { USERNAME: 'u', USERDOMAIN: 'BOX' });
  assert.ok(xml.includes('&amp;'), 'control: the writer must have escaped the ampersand, or this proves nothing');
  job.setRunner(() => ({ ok: true, out: xml }));
  assert.equal(job.configDirFor('amp').configDir, configDir);
});

test('#2614 a default-account agent (configDir "-") reads back as null, so the guard skips it', () => {
  // Matches the Mac side: a default-account agent has configDir: null and is
  // untouched (the default ~/.claude always exists).
  const xml = job.taskXml(
    { name: 'deflt', cwd: 'C:\\work', node: 'C:\\node.exe', supervisor: 'C:\\app\\win32supervisor.js' },
    { USERNAME: 'u', USERDOMAIN: 'BOX' });
  job.setRunner(() => ({ ok: true, out: xml }));
  assert.deepEqual(job.configDirFor('deflt'), { known: true, configDir: null });
});

test('#2614 the reader reuses win32supervisor.specFromArgv, not a second copy of the positions', () => {
  // The position of configDir is stated once, in specFromArgv. If the two ever
  // disagree this fails, which is the whole point of not re-deriving it here.
  const configDir = 'C:\\dir4\\.claude';
  const xml = job.taskXml(
    { name: 'pos', cwd: 'C:\\cwd', model: 'opus', configDir, runner: 'codex', node: 'C:\\node.exe', supervisor: 'C:\\app\\sup.js' },
    { USERNAME: 'u', USERDOMAIN: 'BOX' });
  // Pull the argv the writer put on the line and confirm specFromArgv agrees.
  const argStr = job.xmlUnescape(/<Arguments>([\s\S]*?)<\/Arguments>/.exec(xml)[1]);
  const toks = []; const re = /"([^"]*)"/g; let m; while ((m = re.exec(argStr)) !== null) toks.push(m[1]);
  // slice(2) drops the headless wrapper's [node, supervisor] prefix, leaving node's
  // process.argv[2:] -- exactly what win32supervisor.main consumes.
  assert.equal(sup.specFromArgv(toks.slice(2)).configDir, configDir, 'control: specFromArgv reads position 4');
  job.setRunner(() => ({ ok: true, out: xml }));
  assert.equal(job.configDirFor('pos').configDir, configDir);
});

test('#2614 an absent task reads as known with no configDir (guard skips), an UNREADABLE one as unknown', () => {
  // The distinction matters: "no such task" is an honest "nothing to check", but
  // "schtasks would not answer" must NOT read as "no account dir" and silently
  // drop the guard -- known:false is the fail-safe the caller checks for.
  job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
  assert.deepEqual(job.configDirFor('gone'), { known: true, configDir: null });

  job.setRunner(() => ({ ok: false, out: 'ERROR: Access is denied.' }));
  const r = job.configDirFor('locked');
  assert.equal(r.known, false, 'an unreadable task must not read as "no account dir"');
  assert.equal(r.configDir, undefined);
});

test('#2614 configDirFor survives a real UTF-16 /XML report (run decodes utf8), guard not silently disarmed', () => {
  // The ACCURATE mis-decode: encode the XML as the UTF-16LE bytes a box would emit,
  // then decode those bytes as utf8 the way run() does. For an ASCII line this leaves
  // a NUL after every character; the NUL strip recovers it. (A hand-built '" + '" + uFEFF + "' +
  // interleaved-NUL fixture is NOT what a byte-level mis-decode produces -- the real
  // UTF-16 BOM decodes to U+FFFD, not U+FEFF -- so build the real bytes.)
  const configDir = 'C:\\Users\\kitty\\.claude';
  const xml = job.taskXml(
    { name: 'u16', cwd: 'C:\\work', configDir, node: 'C:\\node.exe', supervisor: 'C:\\app\\win32supervisor.js' },
    { USERNAME: 'kitty', USERDOMAIN: 'BOX' });
  const real = Buffer.from(xml, 'utf16le').toString('utf8');
  // Control: the real mis-decoded bytes defeat a naive match before the strip.
  assert.equal(/<Arguments>[\s\S]*?<\/Arguments>/.test(real), false,
    'control: the real UTF-16-mis-decoded output must NOT match before the strip');
  job.setRunner(() => ({ ok: true, out: real }));
  assert.equal(job.configDirFor('u16').configDir, configDir,
    'the NUL strip must recover the configDir from a real UTF-16 report');
});

test('#2614 a genuine UTF-8-with-BOM report has its leading BOM stripped', () => {
  // This is the case the BOM strip actually defends: a utf8 report that carries a
  // real U+FEFF BOM (EF BB BF), unlike the UTF-16 BOM which decodes to U+FFFD.
  const configDir = 'C:\\Users\\bom\\.claude';
  const xml = job.taskXml(
    { name: 'bomdir', cwd: 'C:\\work', configDir, node: 'C:\\node.exe', supervisor: 'C:\\app\\s.js' },
    { USERNAME: 'u', USERDOMAIN: 'BOX' });
  job.setRunner(() => ({ ok: true, out: '\uFEFF' + xml }));
  assert.equal(job.configDirFor('bomdir').configDir, configDir);
});

test('#2614 a NON-ASCII path under a real UTF-16 report is known:false, never a corrupted directory', () => {
  // The dangerous case: a real UTF-16 mis-decode of a non-ASCII account folder
  // yields U+FFFD mid-path, which the NUL strip cannot recover and the (ASCII)
  // name self-check would not catch. The U+FFFD guard must turn it into an honest
  // unknown rather than return a silently wrong directory.
  const xml = job.taskXml(
    { name: 'nonascii', cwd: 'C:\\work', configDir: 'C:\\Users\\caf\u00e9\\.claude', node: 'C:\\node.exe', supervisor: 'C:\\app\\s.js' },
    { USERNAME: 'u', USERDOMAIN: 'BOX' });
  const real = Buffer.from(xml, 'utf16le').toString('utf8');
  assert.ok(real.indexOf('\uFFFD') !== -1, 'control: the non-ASCII path must actually corrupt to U+FFFD');
  job.setRunner(() => ({ ok: true, out: real }));
  const r = job.configDirFor('nonascii');
  assert.equal(r.known, false, 'a corrupted non-ASCII path must not be returned as a configDir');
  assert.equal(r.configDir, undefined);
});

test('#2614 a registered task with no readable argument line is known:false, not a confident no-configDir', () => {
  // r.ok but no <Arguments> element is a shape we do not understand; admit it
  // rather than assert 'no account dir' the way an absent task legitimately can.
  job.setRunner(() => ({ ok: true, out: '<Task><Actions><Exec><Command>x</Command></Exec></Actions></Task>' }));
  const r = job.configDirFor('noargs');
  assert.equal(r.known, false);
});


/* ───────────────────────────────────────────────────────────────────────────
 * #2717: the configDir PATH is remembered, so `/api/removed` stops spawning a
 * `schtasks /Query /XML` per removed agent on the board's five-second poll.
 * Only the PATH is cached; whether the directory still EXISTS is checked live
 * by the caller on every ask and is not cached here.
 * ──────────────────────────────────────────────────────────────────────────*/
function countingRunner(xml) {
  const calls = { n: 0 };
  job.setRunner((args) => {
    if (args.includes('/Query') && args.includes('/XML')) { calls.n += 1; return { ok: true, out: xml }; }
    return { ok: true, out: '' };
  });
  return calls;
}
function taskXmlFor(name, configDir) {
  return job.taskXml(
    { name, cwd: 'C:\\work', configDir, node: 'C:\\node.exe', supervisor: 'C:\\app\\win32supervisor.js' },
    { USERNAME: name, USERDOMAIN: 'BOX' });
}

test('#2717 a second ask does not spawn again, and the answer is the same', () => {
  const configDir = 'C:\\Users\\kitty\\.claude';
  const calls = countingRunner(taskXmlFor('kitty', configDir));
  const first = job.configDirFor('kitty');
  const second = job.configDirFor('kitty');
  assert.deepEqual(first, { known: true, configDir });
  assert.deepEqual(second, first, 'the cached answer differs from the one that was read');
  /* 🛑 THE ARM THAT MAKES THIS FIX NON-INERT. Without it every assertion here is
     satisfied by a cache that never stores anything, which is precisely the
     shape that shipped green elsewhere this week. */
  assert.equal(calls.n, 1, 'the second ask spawned schtasks again, so nothing is cached');
});

test('#2717 registering the task again forgets the old path, because the account can change', () => {
  const calls = countingRunner(taskXmlFor('kitty', 'C:\\Users\\kitty\\.claude'));
  job.configDirFor('kitty');
  assert.equal(calls.n, 1);
  /* `/Create /F` REWRITES the definition, so a re-registered agent can carry a
     different account. A cache kept across it would hand out the old one, which
     on a SAFETY check is the worst direction to be wrong in. */
  job.install({ name: 'kitty', cwd: 'C:\\work', configDir: 'C:\\Users\\kitty\\.other', node: 'C:\\node.exe' });
  job.configDirFor('kitty');
  assert.equal(calls.n, 2, 'install did not forget the remembered path');
});

test('#2717 removing the task forgets its path', () => {
  const calls = countingRunner(taskXmlFor('kitty', 'C:\\Users\\kitty\\.claude'));
  job.configDirFor('kitty');
  assert.equal(calls.n, 1);
  job.remove('kitty');
  job.configDirFor('kitty');
  assert.equal(calls.n, 2, 'remove did not forget the remembered path');
});

test('#2717 a read that FAILED is never cached, so one bad answer cannot disarm the check forever', () => {
  /* 🛑 THE DIRECTION THAT MATTERS. `known: false` is a statement about the
     moment, not about the task. Caching it would turn a single transient
     schtasks failure into a permanently wrong answer on a safety check. */
  let n = 0;
  job.setRunner((args) => {
    if (!(args.includes('/Query') && args.includes('/XML'))) return { ok: true, out: '' };
    n += 1;
    /* ⚠️ NOT a "cannot find" message: `NO_SUCH_TASK` is /cannot find|does not
       exist/i, so the obvious wording is classified as a KNOWN "no task" answer
       and is cached on purpose. The first version of this arm used it and failed
       for that reason, which is the fixture being wrong rather than the code. */
    return { ok: false, out: 'ERROR: Access is denied.' };
  });
  const a = job.configDirFor('kitty');
  assert.equal(a.known, false, 'the fixture did not produce the unreadable answer this arm is about');
  job.configDirFor('kitty');
  assert.equal(n, 2, 'a FAILED read was cached, so a transient error is now permanent');
});

test('#2717 "there is no task" IS cached, since that is the case a removed agent hits every poll', () => {
  let n = 0;
  job.setRunner((args) => {
    if (!(args.includes('/Query') && args.includes('/XML'))) return { ok: true, out: '' };
    n += 1;
    return { ok: false, out: 'ERROR: The system cannot find the task specified.' };
  });
  const a = job.configDirFor('kitty');
  assert.deepEqual(a, { known: true, configDir: null },
    'the fixture did not produce the no-such-task answer this arm is about');
  job.configDirFor('kitty');
  assert.equal(n, 1, 'the no-such-task answer was not cached, so a removed agent still spawns every poll');
});

test('#2717 swapping the runner clears the cache, so one test cannot answer the next', () => {
  const first = countingRunner(taskXmlFor('kitty', 'C:\\Users\\kitty\\.claude'));
  job.configDirFor('kitty');
  assert.equal(first.n, 1);
  const second = countingRunner(taskXmlFor('kitty', 'C:\\Users\\kitty\\.second'));
  assert.deepEqual(job.configDirFor('kitty'), { known: true, configDir: 'C:\\Users\\kitty\\.second' },
    'the new runner was answered from the previous one cache');
  assert.equal(second.n, 1, 'the runner swap did not clear the cache');
});

test('#2717 the cached answer is frozen, so one caller cannot poison every later one', () => {
  /* 🛑 AN UNTESTED INVARIANT IS THE SHAPE THIS CARD KEEPS PRODUCING. Round 2
     noted that deleting the `Object.freeze` left all arms green, because no
     caller mutates what it gets today (`remove.js` only reads `.configDir`).
     That is exactly when it is cheap to pin: before the cache, every call built
     a fresh object and a caller could scribble on it harmlessly; now they share
     one, so the first caller to write would change the answer every later caller
     sees, on a SAFETY check. */
  const calls = countingRunner(taskXmlFor('kitty', 'C:\\Users\\kitty\\.claude'));
  const first = job.configDirFor('kitty');
  assert.ok(Object.isFrozen(first), 'the cached answer is not frozen, so a caller can poison it');
  /* And the freeze is on the object the CACHE hands back, not merely on a copy:
     mutating it must not change what the next ask returns. */
  try { first.configDir = 'C:\\poisoned'; } catch { /* strict mode throws; both are fine */ }
  assert.equal(job.configDirFor('kitty').configDir, 'C:\\Users\\kitty\\.claude',
    'a caller mutated the cached answer and the next ask returned the poisoned value');
  assert.equal(calls.n, 1, 'the second ask spawned again, so this arm is not testing the cache');
});
