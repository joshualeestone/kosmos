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
 *     which task it may touch; what counts as stuck; that the listeners are read after the wait;
 *     the held handle; the order of the replacement; the constants the engine owns);
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only), which drives the real decision
 *     against real listeners this test starts: one that never answers, one frozen with
 *     NtSuspendProcess, one frozen with its backlog full (so Windows refuses), one slow but inside
 *     the bound, and ones that refuse (401) and fail (500). Only the frozen ones are ended, and only
 *     when they are Kosmos boards of this user. The probe never passes a task name, so no test here
 *     reaches Task Scheduler; the `/End` and `/Run` half was proven on the box against a scratch
 *     task (the PR has the run).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
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
const SECTION = slice('// ---- a board that listens but does not answer (#4543)', 'static void RunSchtasks(');

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
  assert.match(slice('// How long the board\'s /api/status gets to answer', 'internal const int StuckAfterMs'), /MEASURED on the Windows box/, 'the bound lost its measurement');
  const ask = method('internal static BoardAnswer AskBoard(int port, int timeoutMs)');
  assert.match(ask, /"http:\/\/127\.0\.0\.1:" \+ port \+ "\/api\/status"/);
  assert.match(ask, /request\.Proxy = null;/, 'the ask can go through the system proxy');
  assert.match(ask, /request\.Timeout = timeoutMs;/);
  assert.match(ask, /if \(e\.Response != null\) \{[^\n]*return BoardAnswer\.Answered; \}/, 'a 401, 403 or 500 is read as no answer');
  assert.match(ask, /if \(e\.Status == System\.Net\.WebExceptionStatus\.Timeout\) return BoardAnswer\.NoAnswer;/);
  assert.match(ask, /return e\.Status == System\.Net\.WebExceptionStatus\.ConnectFailure \? BoardAnswer\.Refused : BoardAnswer\.CouldNotAsk;/,
    'something other than a timeout or a refusal counts as stuck');
  assert.match(slice('// ⚠️ ONLY 127.0.0.1 IS ASKED', 'internal static BoardAnswer AskBoard('), /the error is on the side of doing nothing/, 'the loopback-only choice is no longer explained');
});

test('#4543 (a): a board is replaced ONLY on NoAnswer or a refusal that lasted the whole bound, never on Answered or CouldNotAsk', () => {
  const within = method('internal static BoardAnswer AskBoardWithin(int port, int boundMs)');
  assert.match(within, /if \(answer == BoardAnswer\.Answered \|\| answer == BoardAnswer\.CouldNotAsk\) return answer;/, 'an answer or a failed ask does not end the asking');
  assert.match(within, /if \(left <= 0\) return refused \? BoardAnswer\.Refused : BoardAnswer\.NoAnswer;/, 'a refusal is not asked again until the bound is spent');
  const decide = method('static StuckBoardOutcome DecideAfterTheWait(int port, string taskName, BoardAnswer answer)');
  const answered = decide.indexOf('if (answer == BoardAnswer.Answered) return StuckBoardOutcome.Answered;');
  const other = decide.indexOf('if (answer != BoardAnswer.NoAnswer && answer != BoardAnswer.Refused) return StuckBoardOutcome.CouldNotAsk;');
  const firstAction = Math.min(...['ListenersOnPort(', 'HeldProcess.Open(', 'ReplaceStuckBoard('].map((s) => decide.indexOf(s)).filter((i) => i >= 0));
  assert.ok(answered >= 0 && other > answered && firstAction > other, 'something is read or ended before an Answered or CouldNotAsk has returned');
  assert.equal((SECTION.match(/ReplaceStuckBoard\(port, taskName, held\)/g) || []).length, 1, 'the replacement is reached from somewhere other than the decision');
});

test('#4543 (b): the listeners that decide are read AFTER the wait, not before it', () => {
  const outer = method('internal static StuckBoardOutcome ReplaceBoardIfStuck(int port, string taskName, int stuckAfterMs)');
  const started = outer.indexOf('asking.Start();');
  assert.ok(started > 0 && outer.indexOf('ListenersOnPort(', started) === -1, 'listeners are read while the ask runs, and used after it');
  assert.match(outer, /asking\.Join\(\);\n\s+outcome = DecideAfterTheWait\(port, taskName, answer\);/, 'the decision does not wait for the ask to finish');
  const decide = method('static StuckBoardOutcome DecideAfterTheWait(int port, string taskName, BoardAnswer answer)');
  assert.match(decide, /List<int> after = ListenersOnPort\(port\);/, 'the decision uses listeners it did not read after the wait');
});

test('#4543: a process is held open from its judgement to its end, so its id cannot be given to another process', () => {
  const decide = method('static StuckBoardOutcome DecideAfterTheWait(int port, string taskName, BoardAnswer answer)');
  const open = decide.indexOf('HeldProcess process = HeldProcess.Open(pid);');
  const reread = decide.indexOf('List<int> listening = ListenersOnPort(port);');
  const judged = decide.indexOf('if (!held.TrueForAll(p => isKosmosBoardProcess(p))) return StuckBoardOutcome.NotKosmos;');
  assert.ok(open > 0 && reread > open && judged > reread, 'the listeners are not re-read with the handles held, before the judgement');
  assert.match(decide, /finally \{ foreach \(HeldProcess p in held\) p\.Dispose\(\); \}/, 'a held handle leaks');
  const end = method('static void EndProcessTree(HeldProcess board)');
  assert.match(end, /if \(board\.HasExited \|\| !isKosmosBoardProcess\(board\)\) return;/, 'the board is not judged again, on its held handle, before taskkill');
  assert.match(end, /"taskkill\.exe"\), "\/PID " \+ board\.Id \+ " \/T \/F"\)/);
  assert.match(end, /if \(!board\.HasExited\) TerminateProcess\(board\.Handle, 1\);/, 'the fallback does not end the board through its held handle');
  assert.doesNotMatch(SECTION, /Process\.GetProcessById/, 'a process is looked up again by its number, which may have been reused');
  assert.match(SECTION, /OpenProcess\(PROCESS_QUERY_LIMITED_INFORMATION \| PROCESS_TERMINATE \| SYNCHRONIZE, false, processId\)/);
});

test('#4543: only a Kosmos board of this user, in this session, is a board to end', () => {
  assert.match(method('internal static bool IsKosmosBoard(HeldProcess process)'), /IsKosmosBoardImage\(ProcessImagePath\(process\.Handle\)\) && ownedByThisUser\(process\)/,
    'another user\'s board, or one whose owner cannot be read, could be ended');
  const owner = method('internal static bool OwnedByThisUser(HeldProcess process)');
  assert.match(owner, /if \(theirs != ours\) return false;/, 'another session is not ruled out');
  assert.match(owner, /return owner\.User != null && owner\.User\.Equals\(me\.User\);/, 'the owner\'s SID is not compared with this user\'s');
  assert.match(owner, /catch \{ return false; \}/, 'an unreadable owner is not "not ours"');
});

test('#4543: the replacement ends the logon task first, ends a surviving listener\'s tree, then runs the task again', () => {
  const replace = method('static StuckBoardOutcome ReplaceStuckBoard(int port, string taskName, List<HeldProcess> stuck)');
  const end = replace.indexOf('RunSchtasks("/End /TN " + QuoteArgument(taskName));');
  const kill = replace.indexOf('foreach (HeldProcess board in survivors) EndProcessTree(board);');
  const run = replace.indexOf('if (taskName != null) RunSchtasks("/Run /TN " + QuoteArgument(taskName));');
  assert.ok(end > 0 && kill > end && run > kill, 'the replacement is not /End, then the listener\'s tree, then /Run');
});

test('#4543: the task name, its boot shim and its engine pointer are the engine\'s, one fact in two files', () => {
  const board = fs.readFileSync(path.join(REPO, 'engine', 'win32board.js'), 'utf8');
  const anchor = fs.readFileSync(path.join(REPO, 'engine', 'win32anchor.js'), 'utf8');
  const task = board.match(/const TASK_NAME = '([^']+)';/);
  const boot = board.match(/const BOOT_NAME = '([^']+)';/);
  const pointer = anchor.match(/const POINTER_NAME = '([^']+)';/);
  assert.ok(task && boot && pointer, 'the engine no longer names its task, boot shim and engine pointer');
  /* Compared as written: both files spell the backslash as an escaped pair. */
  const constant = (name) => { const m = SOURCE.match(new RegExp('(?:internal )?const string ' + name + ' = "([^"]*)";')); assert.ok(m, name + ' is gone'); return m[1]; };
  assert.equal(constant('BoardTaskName'), task[1], 'the launcher ends a different task than the engine registers');
  assert.equal(constant('BoardBootFileName'), boot[1], 'the launcher looks for a different boot shim than the engine writes');
  assert.equal(constant('EnginePointerFileName'), pointer[1], 'the launcher looks for a different engine pointer than the engine writes');
  assert.equal(constant('ManifestFileName'), 'manifest.json');
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
      case "within": Console.Write(KosmosLauncher.AskBoardWithin(int.Parse(a[1]), int.Parse(a[2]))); break;
      case "listeners": Console.Write(string.Join(",", KosmosLauncher.ListenersOnPort(int.Parse(a[1])))); break;
      case "board":
      case "owner": {
        KosmosLauncher.HeldProcess p = KosmosLauncher.HeldProcess.Open(int.Parse(a[1]));
        if (p == null) { Console.Write("unopenable"); break; }
        using (p) Console.Write(a[0] == "board" ? KosmosLauncher.IsKosmosBoard(p) : KosmosLauncher.OwnedByThisUser(p));
        break;
      }
      case "suspend": using (System.Diagnostics.Process p = System.Diagnostics.Process.GetProcessById(int.Parse(a[1]))) Console.Write(NtSuspendProcess(p.Handle)); break;
      case "replace":
        if (a[3] == "any") KosmosLauncher.isKosmosBoardProcess = p => true;
        else if (a[3] == "none") KosmosLauncher.isKosmosBoardProcess = p => false;
        else if (a[3] == "otheruser") KosmosLauncher.ownedByThisUser = p => false;
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
function probeLater(args) {
  return new Promise((resolve) => {
    const child = spawn(probeExe, args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', () => resolve(out));
  });
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

/* A hard link to this node.exe stands in for a build's or the anchor's runtime without copying it. */
function layout(name, files) {
  const runtime = path.join(probeDir, name, 'runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const node = path.join(runtime, 'node.exe');
  try { fs.linkSync(process.execPath, node); } catch { fs.copyFileSync(process.execPath, node); }
  for (const f of files) {
    const at = path.join(probeDir, name, f);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, '');
  }
  return node;
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

test('#4543: the ask reads a timeout as no answer, a refusal as refused, and 200, 401 and 500 as answers', WINDOWS_ONLY, async (t) => {
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
     SYN is retried), so a bound under that reads a refusal as a timeout. */
  assert.equal(probe(['ask', String(nobody.port), '5000']), 'Refused');
  /* Nothing listening: ReplaceBoardIfStuck never asks, and a refusal alone never ends anything. */
  assert.equal(probe(['replace', String(nobody.port), '-', 'any', '5000']), 'NothingListening');
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

test('#4543 STUCK: a frozen board whose backlog is full, so Windows REFUSES new connections, is ended too', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child, port } = await startListener('ok');
  assert.equal(probe(['suspend', String(child.pid)]), '0', 'NtSuspendProcess failed');
  /* Measured on the Windows box: a frozen listener took 232 of 600 connections and refused the rest. */
  const sockets = [];
  const outcomes = await Promise.all(Array.from({ length: 600 }, () => new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    sockets.push(s);
    s.once('connect', () => resolve('accepted'));
    s.once('error', (e) => resolve(e.code));
    s.setTimeout(8000, () => resolve('timeout'));
  })));
  try {
    const refused = outcomes.filter((o) => o === 'ECONNREFUSED').length;
    if (refused === 0) { t.skip('this machine\'s backlog did not fill with 600 connections (' + outcomes.filter((o) => o === 'accepted').length + ' accepted)'); return; }
    assert.equal(probe(['ask', String(port), '5000']), 'Refused', 'the full backlog did not make the ask a refusal, so this test proves nothing');
    assert.equal(probe(['replace', String(port), '-', 'any', '5000']), 'Replaced', 'a frozen board that refuses is left stuck');
    assert.ok(await endedWithin(child, 5000), 'the frozen board is still running');
  } finally {
    for (const s of sockets) s.destroy();
  }
});

test('#4543 (b): a board that goes while the ask waits is not ended, and nothing is ended in its place', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child, port } = await startListener('hang');
  const outcome = probeLater(['replace', String(port), '-', 'any', '3000']);
  await new Promise((r) => setTimeout(r, 1000));
  child.kill();
  await endedWithin(child, 5000);
  assert.equal(await outcome, 'NothingListening', 'the decision used listeners read before the wait');
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

test('#4543: a stuck listener that is not a Kosmos board is left alone', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child, port } = await startListener('hang');
  assert.equal(probe(['replace', String(port), '-', 'none', '1500']), 'NotKosmos');
  assert.ok(alive(child), 'a program that is not Kosmos was ended');
});

test('#4543: a Kosmos board is a node.exe in a build (app\\server.js and manifest.json) or beside the task\'s board-boot.js and engine-path; any other node.exe is not', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const cases = [
    ['build', ['app/server.js', 'manifest.json'], 'True'],
    ['build-no-manifest', ['app/server.js'], 'False'],
    ['anchored', ['runtime/board-boot.js', 'runtime/engine-path'], 'True'],
    ['anchored-no-pointer', ['runtime/board-boot.js'], 'False'],
    ['other', [], 'False'],
  ];
  for (const [name, files, expected] of cases) {
    const { child } = await startListener('ok', layout(name, files));
    assert.equal(probe(['board', String(child.pid)]), expected, name);
    child.kill();
    await endedWithin(child, 5000);
  }
});

test('#4543: a stuck Kosmos board of ANOTHER user is left alone; the same board of this user is ended', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const node = layout('owned', ['app/server.js', 'manifest.json']);
  const theirs = await startListener('hang', node);
  assert.equal(probe(['replace', String(theirs.port), '-', 'otheruser', '1500']), 'NotKosmos', 'another user\'s board was ended');
  assert.ok(alive(theirs.child), 'another user\'s board was ended');
  assert.equal(probe(['replace', String(theirs.port), '-', 'real', '1500']), 'Replaced', 'this user\'s own stuck board was not ended');
  assert.ok(await endedWithin(theirs.child, 5000));
});

test('#4543: the owner check says yes for this user\'s process and no for a system process', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { child } = await startListener('ok');
  assert.equal(probe(['owner', String(child.pid)]), 'True');
  /* wininit.exe runs as SYSTEM in session 0: unopenable without admin, and another owner with it
     (the Windows runner is an administrator). Either way it is not ours. */
  const list = spawnSync('tasklist', ['/FI', 'IMAGENAME eq wininit.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout || '';
  const m = list.match(/"wininit\.exe","(\d+)"/i);
  if (!m) { t.skip('no wininit.exe listed'); return; }
  assert.match(probe(['owner', m[1]]), /^(False|unopenable)$/, 'a SYSTEM process was read as this user\'s');
  assert.match(probe(['board', m[1]]), /^(False|unopenable)$/);
});
