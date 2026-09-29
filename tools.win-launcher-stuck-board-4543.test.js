'use strict';

/**
 * #4543, the Windows half: opening Kosmos replaces a board that holds its port but does not answer.
 *
 *   node --test tools.win-launcher-stuck-board-4543.test.js
 *
 * Measured on the Windows box before this: with the board frozen (alive, listening, answering
 * nothing), opening Kosmos from the Start menu handed off to the still-running logon task and
 * opened a window onto the same frozen board. "Close Kosmos and open it again" changed nothing.
 *
 * Two halves, as tools.win-launcher-native.test.js does it:
 *   - the SOURCE, for the wiring nothing can call from outside (where Main asks, for whom, and
 *     which task it may touch; the order of the replacement; the constants the engine owns);
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only), which drives the real decision
 *     against real listeners this test starts: one that never answers, one really frozen with
 *     NtSuspendProcess, one slow but inside the bound, one that refuses (401) and one that errors
 *     (500). Only the first two are ended. The probe never passes a task name, so no test here
 *     reaches Task Scheduler; the `/End` and `/Run` half was proven on the box against a scratch
 *     task (the PR has the run).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const REPO = __dirname;
const LAUNCHER = path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs');
const SOURCE = fs.readFileSync(LAUNCHER, 'utf8');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe needs the Windows C# compiler and Windows processes' };

function slice(start, end) {
  const at = SOURCE.indexOf(start);
  assert.notEqual(at, -1, start + ' is gone from KosmosLauncher.cs');
  const to = SOURCE.indexOf(end, at + start.length);
  assert.notEqual(to, -1, 'the end of ' + start + ' is gone');
  return SOURCE.slice(at, to);
}
function method(signature) { return slice(signature, '\n    }\n'); }

/* ---- the source ------------------------------------------------------------ */

test('#4543: Main replaces a stuck board after the installer duties and before the window or the board is started, only for a person at a desktop', () => {
  const main = method('static int Main(string[] args)');
  const duties = main.indexOf('if (endedByInstallerDuties.HasValue) return endedByInstallerDuties.Value;');
  const ask = main.indexOf('ReplaceBoardIfStuck(port, portIsTheTasks ? BoardTaskName : null, StuckAfterMs);');
  const window = main.indexOf('if (File.Exists(opener))');
  const board = main.indexOf('p = Process.Start(s);');
  assert.ok(duties > 0 && ask > duties, 'the stuck check runs before the installer duties, which may hand this launch to another copy');
  assert.ok(window > ask && board > ask, 'the window or the board starts before a stuck board is replaced, so it opens onto the stuck one');
  assert.match(main.slice(duties, ask), /if \(showMessageBoxes\)\n\s+\{\n\s+bool portIsTheTasks = string\.IsNullOrEmpty\(Environment\.GetEnvironmentVariable\("PORT"\)\);\n\s+$/,
    'the replacement is not limited to a person at a desktop, or a launch that set PORT can end the logon task that serves another port');
});

test('#4543: only no answer at all is stuck; any HTTP answer, a refusal included, is a board that is alive', () => {
  assert.match(SOURCE, /internal const int StuckAfterMs = 10000;/, 'the bound moved; say why in its comment and here');
  const ask = method('internal static BoardAnswer AskBoard(int port, int timeoutMs)');
  assert.match(ask, /"http:\/\/127\.0\.0\.1:" \+ port \+ "\/api\/status"/);
  assert.match(ask, /request\.Proxy = null;/, 'the ask can go through the system proxy');
  assert.match(ask, /request\.Timeout = timeoutMs;/);
  assert.match(ask, /if \(e\.Response != null\) \{[^\n]*return BoardAnswer\.Answered; \}/, 'a 401, 403 or 500 is read as no answer');
  assert.match(ask, /return e\.Status == System\.Net\.WebExceptionStatus\.Timeout \? BoardAnswer\.NoAnswer : BoardAnswer\.CouldNotAsk;/,
    'something other than a timeout counts as stuck');
});

test('#4543: the replacement ends the logon task first, ends a surviving listener\'s tree, then runs the task again', () => {
  const replace = method('static StuckBoardOutcome ReplaceStuckBoard(int port, string taskName, List<int> stuck)');
  const end = replace.indexOf('RunSchtasks("/End /TN " + QuoteArgument(taskName));');
  const kill = replace.indexOf('foreach (int pid in survivors) EndProcessTree(pid);');
  const run = replace.indexOf('if (taskName != null) RunSchtasks("/Run /TN " + QuoteArgument(taskName));');
  assert.ok(end > 0 && kill > end && run > kill, 'the replacement is not /End, then the listener\'s tree, then /Run');
  const decide = method('internal static StuckBoardOutcome ReplaceBoardIfStuck(int port, string taskName, int stuckAfterMs)');
  assert.match(decide, /if \(!stillHeld\.TrueForAll\(pid => isKosmosBoardProcess\(pid\)\)\) \{ outcome = StuckBoardOutcome\.NotKosmos; return; \}/,
    'a program that is not a Kosmos board can be ended for not speaking HTTP');
  assert.match(method('static void EndProcessTree(int processId)'), /"taskkill\.exe"\), "\/PID " \+ processId \+ " \/T \/F"\)/);
});

test('#4543: the task name and its boot shim are the engine\'s, one fact in two files', () => {
  const board = fs.readFileSync(path.join(REPO, 'engine', 'win32board.js'), 'utf8');
  const task = board.match(/const TASK_NAME = '([^']+)';/);
  const boot = board.match(/const BOOT_NAME = '([^']+)';/);
  assert.ok(task && boot, 'engine/win32board.js no longer names its task and boot shim');
  /* Compared as written: both files spell the backslash as an escaped pair. */
  const constant = (name) => { const m = SOURCE.match(new RegExp('internal const string ' + name + ' = "([^"]*)";')); assert.ok(m, name + ' is gone'); return m[1]; };
  assert.equal(constant('BoardTaskName'), task[1], 'the launcher ends a different task than the engine registers');
  assert.equal(constant('BoardBootFileName'), boot[1], 'the launcher looks for a different boot shim than the engine writes');
});

/* ---- the probe ------------------------------------------------------------- */

const PROBE = `
using System;
using System.Runtime.InteropServices;
class StuckProbe {
  [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr process);
  static int Main(string[] a) {
    switch (a[0]) {
      case "ask": Console.Write(KosmosLauncher.AskBoard(int.Parse(a[1]), int.Parse(a[2]))); break;
      case "listeners": Console.Write(string.Join(",", KosmosLauncher.ListenersOnPort(int.Parse(a[1])))); break;
      case "image": Console.Write(KosmosLauncher.IsKosmosBoardImage(int.Parse(a[1]))); break;
      case "suspend": using (System.Diagnostics.Process p = System.Diagnostics.Process.GetProcessById(int.Parse(a[1]))) Console.Write(NtSuspendProcess(p.Handle)); break;
      case "replace":
        if (a[3] == "any") KosmosLauncher.isKosmosBoardProcess = pid => true;
        else if (a[3] == "none") KosmosLauncher.isKosmosBoardProcess = pid => false;
        Console.Write(KosmosLauncher.ReplaceBoardIfStuck(int.Parse(a[1]), a[2] == "-" ? null : a[2], int.Parse(a[4])));
        break;
    }
    return 0;
  }
}
`;

/* A listener of the test's own: `hang` accepts and never answers, `slow:<ms>` answers after that
   long, `401` and `500` refuse and fail at once, `ok` answers at once. It prints its port. */
const LISTENER = `
const http = require('node:http');
const mode = process.argv[2];
const server = http.createServer((req, res) => {
  if (mode === 'hang') return;
  if (mode.startsWith('slow:')) { setTimeout(() => res.end('{}'), Number(mode.slice(5))); return; }
  if (mode === '401' || mode === '500') { res.statusCode = Number(mode); res.end(); return; }
  res.end('{}');
});
server.listen(0, '127.0.0.1', () => process.stdout.write(server.address().port + '\\n'));
`;

let probeExe = null;
let probeDir = null;
const started = [];

function probe(args) {
  const r = spawnSync(probeExe, args, { encoding: 'utf8', windowsHide: true, timeout: 45000 });
  assert.equal(r.status, 0, 'the probe failed: ' + r.stdout + r.stderr);
  return r.stdout;
}

function startListener(mode, node) {
  return new Promise((resolve, reject) => {
    const child = spawn(node || process.execPath, [path.join(probeDir, 'listener.js'), mode], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    started.push(child);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/^(\d+)\n/);
      if (m) resolve({ child, port: Number(m[1]) });
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error('the listener ended before listening (' + code + ')')));
  });
}

function alive(child) { return child.exitCode === null && child.signalCode === null; }
async function endedWithin(child, ms) {
  const until = Date.now() + ms;
  while (alive(child) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  return !alive(child);
}

test('#4543: the probe compiles beside the launcher', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-stuck-probe-'));
  fs.writeFileSync(path.join(probeDir, 'StuckProbe.cs'), PROBE);
  fs.writeFileSync(path.join(probeDir, 'listener.js'), LISTENER);
  const out = path.join(probeDir, 'probe.exe');
  const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:StuckProbe', '/out:' + out, LAUNCHER, path.join(probeDir, 'StuckProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  probeExe = out;
});

test.after(() => {
  for (const child of started) { try { if (alive(child)) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* gone */ } }
  if (probeDir) { try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch { /* a listener still holds a file */ } }
});

const needsProbe = (t) => { if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return false; } return true; };

test('#4543: the port\'s listeners are read from the TCP table, and a free port has none', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child, port } = await startListener('ok');
  assert.equal(probe(['listeners', String(port)]), String(child.pid), 'the listener on the port is not the one this test started');
  child.kill();
  await endedWithin(child, 5000);
  assert.equal(probe(['listeners', String(port)]), '', 'a port nothing listens on still names a listener');
});

test('#4543: the ask reads a timeout as no answer, and 200, 401 and 500 as answers', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const hang = await startListener('hang');
  assert.equal(probe(['ask', String(hang.port), '1500']), 'NoAnswer');
  for (const mode of ['ok', '401', '500']) {
    const l = await startListener(mode);
    assert.equal(probe(['ask', String(l.port), '1500']), 'Answered', mode + ' was not read as an answer');
  }
  const nobody = await startListener('ok');
  nobody.child.kill();
  await endedWithin(nobody.child, 5000);
  /* Measured on the Windows box: .NET is told a loopback port is refused only after about 2 s (the
     SYN is retried), so a bound under that reads a refusal as a timeout. The real bound is 10 s, and
     ReplaceBoardIfStuck asks only when the TCP table shows a listener. */
  assert.equal(probe(['ask', String(nobody.port), '5000']), 'CouldNotAsk', 'a refused connection was read as a stuck board');
});

test('#4543 STUCK: a board that holds the port and never answers is ended, and the port is let go', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child, port } = await startListener('hang');
  assert.equal(probe(['replace', String(port), '-', 'any', '2000']), 'Replaced');
  assert.ok(await endedWithin(child, 5000), 'the stuck board is still running');
  assert.equal(probe(['listeners', String(port)]), '', 'the port is still held');
});

test('#4543 STUCK: a board frozen with NtSuspendProcess (the measured failure) is ended too', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child, port } = await startListener('ok');
  assert.equal(probe(['ask', String(port), '1500']), 'Answered', 'the board did not answer before it was frozen');
  assert.equal(probe(['suspend', String(child.pid)]), '0', 'NtSuspendProcess failed');
  assert.equal(probe(['replace', String(port), '-', 'any', '2000']), 'Replaced');
  assert.ok(await endedWithin(child, 5000), 'the frozen board is still running');
});

test('#4543 SLOW: a board that answers inside the bound, however slowly, is left alone', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child, port } = await startListener('slow:2500');
  assert.equal(probe(['replace', String(port), '-', 'any', '5000']), 'Answered');
  assert.ok(alive(child), 'a slow board that answered was ended');
});

test('#4543 REFUSING: a board that answers 401 or 500 is alive, and left alone', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  for (const mode of ['401', '500']) {
    const { child, port } = await startListener(mode);
    assert.equal(probe(['replace', String(port), '-', 'any', '2000']), 'Answered', mode);
    assert.ok(alive(child), 'a board answering ' + mode + ' was ended');
  }
});

test('#4543: a free port, and a stuck listener that is not a Kosmos board, are both left alone', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child, port } = await startListener('hang');
  assert.equal(probe(['replace', String(port), '-', 'none', '1500']), 'NotKosmos');
  assert.ok(alive(child), 'a program that is not Kosmos was ended');
  child.kill();
  await endedWithin(child, 5000);
  assert.equal(probe(['replace', String(port), '-', 'any', '1500']), 'NothingListening');
});

test('#4543: a Kosmos board is a node.exe in a build\'s runtime folder, or beside the logon task\'s boot shim; any other node.exe is not', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  /* A hard link to this node.exe stands in for a build's runtime without copying it. */
  const place = (name) => {
    const runtime = path.join(probeDir, name, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });
    const node = path.join(runtime, 'node.exe');
    try { fs.linkSync(process.execPath, node); } catch { fs.copyFileSync(process.execPath, node); }
    return { runtime, node };
  };
  const build = place('build');
  fs.mkdirSync(path.join(probeDir, 'build', 'app'), { recursive: true });
  fs.writeFileSync(path.join(probeDir, 'build', 'app', 'server.js'), '');
  const anchored = place('anchored');
  fs.writeFileSync(path.join(anchored.runtime, 'board-boot.js'), '');
  const other = place('other');
  for (const [where, expected] of [[build, 'True'], [anchored, 'True'], [other, 'False']]) {
    const { child } = await startListener('ok', where.node);
    assert.equal(probe(['image', String(child.pid)]), expected, where.node);
    child.kill();
    await endedWithin(child, 5000);
  }
  assert.equal(probe(['image', '0']), 'False', 'a process that cannot be opened counts as a board');
});
