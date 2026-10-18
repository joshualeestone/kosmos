'use strict';

/**
 * #4382, the Windows half, Kosmos.exe's part: a connect computer's window looks for an update at launch
 * and once a day, offers it with the person's consent, carries Update and Roll back to the engine, and
 * never starts the board.
 *
 *   node --test tools.windows-connect-update-4382.test.js
 *
 * The engine's half (the look, the install, the rollback, the board left stopped) is
 * engine/win32connectupdate.test.js. This file has the launcher's two halves, as the other launcher
 * tests do:
 *   - the SOURCE (tools/windows/KosmosLauncher.cs), for the wiring nothing can call from outside: when
 *     the look runs, the daily timer, what each answer does, who may install or roll back;
 *   - a PROBE compiled beside the launcher (Windows only), which reads the engine's own report lines
 *     (win32connectupdate.reportLines, for every answer it gives) through the launcher's parser.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/* The engine file is required below (its actions, its report lines); sandbox every root it could read first. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-connect-update-src-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const REPO = __dirname;
const LAUNCHER = path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs');
const SOURCE = fs.readFileSync(LAUNCHER, 'utf8');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe needs the Windows C# compiler' };

function slice(start, end) {
  const at = SOURCE.indexOf(start);
  assert.notEqual(at, -1, start + ' is gone from KosmosLauncher.cs');
  const to = SOURCE.indexOf(end, at + start.length);
  assert.notEqual(to, -1, 'the end of ' + start + ' is gone');
  return SOURCE.slice(at, to);
}
function method(signature) { return slice(signature, '\n    }\n'); }
function inOrder(text, parts, why) {
  let at = -1;
  for (const part of parts) {
    const next = text.indexOf(part, at + 1);
    assert.ok(next > at, why + ': "' + part + '" is missing or out of order');
    at = next;
  }
}
const count = (text, needle) => text.split(needle).length - 1;
const constant = (name) => {
  const m = SOURCE.match(new RegExp('internal const int ' + name + ' = ([^;]+);'));
  assert.ok(m, name + ' is gone');
  return Function('return (' + m[1] + ')')();
};

test('#4382: the instrument is reading the launcher', () => {
  assert.ok(SOURCE.length > 100000, 'KosmosLauncher.cs read back only ' + SOURCE.length + ' bytes');
});

test('#4382: the launcher runs the engine file that exists, with the actions that file takes', () => {
  assert.match(SOURCE, /internal const string ConnectUpdateScript = "win32connectupdate\.js";/);
  assert.ok(fs.existsSync(path.join(REPO, 'engine', 'win32connectupdate.js')), 'the launcher names an engine file the bundle does not carry');
  const engine = require('./engine/win32connectupdate.js');
  const used = [...SOURCE.matchAll(/LookForUpdate\("([a-z]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), [...engine.ACTIONS].sort(), 'every action the window asks for is one the engine takes, and every engine action is reachable');
  assert.ok(method('internal static string ConnectUpdateArguments(string action, int port, string expect)').includes('" --expect " + expect'), 'the rollback names the version agreed to');
  assert.deepEqual(engine.parseArgs(['--rollback', '--port', '16180', '--report', 'r.txt', '--yes']), { action: 'rollback', port: '16180', report: 'r.txt', expect: null, yes: true, unknown: null },
    'the engine reads what RunEngineHelper sends: the arguments, then --report <file> --yes');
});

test('#4382: a connect launch looks for an update once its stop of the board is done, and again once a day', () => {
  const background = method('void StopBoardInBackground(bool thenSignIn)');
  inOrder(background, ['KosmosLauncher.StopBoardHere(boardPort, task)', 'BeginInvoke(', 'stopsInFlight--;', 'if (stopped && mode == KosmosLauncher.ComputerMode.Connect) StartUpdateLooks();'],
    'the look starts before the stop is done, or on a computer that runs agents');
  /* Both connect entries go through that stop: a connect launch (OnLoad) and a switch to connect (SwitchToConnect). */
  assert.match(slice('protected override void OnLoad(EventArgs e)', 'try'), /else StopBoardInBackground\(false\);/);
  assert.match(method('void SwitchToConnect()'), /StopBoardInBackground\(true\);/);

  const start = method('void StartUpdateLooks()');
  inOrder(start, ['if (mode != KosmosLauncher.ComputerMode.Connect) return;', 'updateTimer = new System.Windows.Forms.Timer();',
    'updateTimer.Interval = KosmosLauncher.UpdateLookEveryMs;',
    'updateTimer.Tick += (sender, args) => { if (KosmosLauncher.UpdateLookIsDue(updateState)) LookForUpdate("look"); };',
    'updateTimer.Start();', 'if (KosmosLauncher.UpdateLookIsDue(updateState)) LookForUpdate("look");'],
    'the daily look, skipped while an installed update waits for its Restart');
  const every = constant('UpdateLookEveryMs');
  const retry = constant('UpdateLookRetryMs');
  assert.ok(every > 0 && every <= 24 * 60 * 60 * 1000, 'a look at least once a day');
  assert.ok(every <= 0x7fffffff, 'a WinForms Timer interval is an int');
  assert.ok(retry > 0 && retry < every, 'a look that could not reach the host is tried again sooner');
  const lookLimit = constant('UpdateLookTimeoutMs');
  assert.ok(lookLimit > (15 + 10) * 60 * 1000 && lookLimit < every, 'the look is given up on only after the engine limits (a 15-minute download, a 10-minute wait), and well before the next look');
  assert.match(method('void UpdateLookDone(KosmosLauncher.ConnectUpdateAnswer answer, string action)'),
    /if \(updateTimer != null && updateTimer\.Interval != updateState\.NextLookMs\) updateTimer\.Interval = updateState\.NextLookMs;/,
    'the next look follows the state (a day, or an hour after a look that could not reach the host)');
  /* Closing the window, or going back to running agents, stops the looks: the board then looks for itself. */
  assert.match(method('protected override void OnFormClosed(System.Windows.Forms.FormClosedEventArgs e)'), /updateTimer\.Stop\(\); updateTimer\.Dispose\(\); updateTimer = null;/);
  assert.match(method('void StopUpdateLooks()'), /updateTimer\.Stop\(\); updateTimer\.Dispose\(\); updateTimer = null;/);
  inOrder(method('void RunAgentsHere()'), ['mode = KosmosLauncher.ComputerMode.Run;', 'StopUpdateLooks();'], 'Run agents');
});

test('#4382: each run is the engine\'s, off the window\'s thread, counted so Run agents cannot start a board under it', () => {
  const look = method('void LookForUpdate(string action)');
  inOrder(look, [
    'if (mode != KosmosLauncher.ComputerMode.Connect) return;',
    'if (updateLookInFlight) return;',
    'updateLookInFlight = true;',
    'stopsInFlight++;',
    'new Thread(',
    'KosmosLauncher.runEngineHelper(Path.Combine(folder, "runtime\\\\node.exe"), folder, KosmosLauncher.ConnectUpdateScript,',
    'KosmosLauncher.ConnectUpdateArguments(action, boardPort, expect), 0, out problem);',
    'KosmosLauncher.ReadConnectUpdateReport(lines);',
    'BeginInvoke(',
    'updateLookInFlight = false;',
    'stopsInFlight--;',
    'UpdateLookDone(answer, action);',
  ], 'the look');
  assert.match(look, /look\.IsBackground = false;/, 'closing the window could cut an install off between its steps');
  /* The window's own look is given up on (its flags let go) after the limit, and nothing is killed. */
  inOrder(look, ['if (action == "look")', 'giveUp.Interval = KosmosLauncher.UpdateLookTimeoutMs;', 'if (finished[0]) return;', 'gaveUp[0] = true;',
    'updateLookInFlight = false;', 'stopsInFlight--;', 'lookThread[0].IsBackground = true;', 'finished[0] = true;', 'if (gaveUp[0])',
    'if (answer.Kind != KosmosLauncher.ConnectUpdateKind.Updated && answer.Kind != KosmosLauncher.ConnectUpdateKind.Pending) return;', 'if (updateLookInFlight) lateInstall = answer;', 'else UpdateLookDone(answer, action);',
    'UpdateLookDone(answer, action);', 'if (lateInstall != null)', 'lateInstall = null;', 'if (RelaunchAfterClose == null && !IsDisposed) UpdateLookDone(late, "look");',
    'lookThread[0] = look;', 'look.Start();'],
    'giving up on a look that hangs (no longer keeping Kosmos.exe open), still recording an install it did, after any run in flight');
  assert.doesNotMatch(look, /\.Kill\(/, 'a kill could land while the engine holds its lock or has written a journal');
  inOrder(method('void RunAgentsHere()'), [
    'if (mode != KosmosLauncher.ComputerMode.Connect) return;',
    'if (updateLookInFlight) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }',
    'if (KosmosLauncher.UpdateUnderWayHere(here)) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }',
    'if (stopsInFlight > 0)',
    'KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Run, file)',
  ], 'Run agents during an update, this window\'s or one a closed window started');
  /* The disk check reads the files the engine writes, where the engine writes them. */
  const here = method('internal static bool UpdateUnderWayHere(string here)');
  const win32update = require('./engine/win32update.js');
  const win32anchor = require('./engine/win32anchor.js');
  assert.match(here, new RegExp('Path\\.Combine\\(Path\\.Combine\\(here, "' + win32update.WORK_DIRNAME.replace(/\./g, '\\.') + '"\\), "' + win32update.LOCK_NAME.replace(/\./g, '\\.') + '"\\)'));
  assert.match(method('internal static string UpdateJournalPath()'), new RegExp('"' + win32anchor.UPDATE_JOURNAL_NAME.replace(/\./g, '\\.') + '"'));
  /* The window still starts no board: the engine's run is the only process it adds, and it is not the board. */
  const form = slice('class BoardWindowForm : System.Windows.Forms.Form', '// The completion handlers and event handlers WebView2 calls back on.');
  assert.doesNotMatch(form, /RunSchtasks\(|"\/Run|OpenerStartInfo|server\.js/);
  assert.equal(count(form, 'KosmosLauncher.runEngineHelper('), 1, 'the window runs an engine helper somewhere other than the update look');
});

test('#4382: the window applies the pure decisions, and nothing else installs, rolls back or restarts', () => {
  const done = method('void UpdateLookDone(KosmosLauncher.ConnectUpdateAnswer answer, string action)');
  inOrder(done, ['updateState = KosmosLauncher.AfterConnectUpdate(updateState, answer, action);',
    'if (updateState.Relaunch != null) { RelaunchAfterClose = updateState.Relaunch; Close(); return; }',
    'ShowUpdateBar(updateState.BarNote, updateState.BarButton);', 'UpdateRunAgentsItem();',
    'if (updateState.Message != null) KosmosLauncher.ShowWindowMessage(updateState.Message, true);'], 'after a run');
  /* The only install and the only rollback are the person's picks, and a rollback is asked first. */
  assert.equal(count(SOURCE, 'LookForUpdate("install")'), 1);
  assert.equal(count(SOURCE, 'LookForUpdate("rollback")'), 1);
  inOrder(method('void UpdatePicked()'), ['KosmosLauncher.UpdatePickedAction(updateState, updateLookInFlight);',
    'if (next == "busy") { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }',
    'if (next == "restart") { RelaunchAfterClose = "update"; Close(); return; }', 'if (next == "install") LookForUpdate("install");'], 'Update');
  inOrder(method('void RollbackPicked()'), ['updateState.Rollback == null || updateState.Installed != null || updateState.Unsettled) return;',
    'if (updateLookInFlight) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }',
    'if (!KosmosLauncher.askYesNo(KosmosLauncher.RollbackQuestion(updateState.Rollback))) return;',
    'if (updateLookInFlight) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }', 'LookForUpdate("rollback");'], 'Roll back, checked again after the question');
  /* The bar is the window's, over the page, never in it (Liu Kang's ruling for the Mac half), and Not now is a field. */
  const bar = method('void ShowUpdateBar(string note, string button)');
  assert.match(bar, /Controls\.Add\(updateBar\);/);
  assert.match(bar, /updateState = KosmosLauncher\.AfterNotNow\(updateState\);/);
  assert.match(bar, /updateBarNotNow\.Visible = !updateLookInFlight;/, 'a note bar has no way to put it away');
  assert.doesNotMatch(bar, /Controls\[/, 'a control picked by its index');
  assert.doesNotMatch(bar, /webView|ExecuteScript|Navigate/, 'the notice was put into the page, which is the other computer\'s');
  assert.match(method('void FitViewToWindow()'), /bounds\.top = client\.Top \+ barHeight;/, 'the bar covers the page');
});

test('#4382: Update and Roll back are in the system menu, only on a connect computer and only while there is one', () => {
  const ids = ['RunAgentsMenuId', 'UpdateMenuId', 'RollbackMenuId'].map(constant);
  assert.equal(new Set(ids).size, ids.length, 'two items share an id');
  for (const id of ids) assert.ok((id & 0xF) === 0 && id < 0xF000, 'a WM_SYSCOMMAND id must keep its low four bits clear and sit below the system\'s own');
  const proc = slice('protected override void WndProc(', 'base.WndProc(ref m);');
  assert.match(proc, /== UpdateMenuId\) \{ UpdatePicked\(\); return; \}/);
  assert.match(proc, /== RollbackMenuId\) \{ RollbackPicked\(\); return; \}/);
  const menu = method('void UpdateRunAgentsItem()');
  inOrder(menu, ['bool want = mode == KosmosLauncher.ComputerMode.Connect;', 'string updateText = !want || updateState.Unsettled ? null',
    'updateState.Installed != null ? KosmosLauncher.RestartMenuText(updateState.Installed)',
    'updateState.Offer != null ? KosmosLauncher.UpdateMenuText(updateState.Offer)',
    'want && updateState.Rollback != null && updateState.Installed == null && !updateState.Unsettled ? KosmosLauncher.RollbackMenuText(updateState.Rollback) : null;',
    'if (systemMenuShown != null) GetSystemMenu(Handle, true);',
    'if (updateText != null) AppendMenuW(menu, MF_STRING, new UIntPtr((uint)UpdateMenuId), updateText);',
    'if (rollbackText != null) AppendMenuW(menu, MF_STRING, new UIntPtr((uint)RollbackMenuId), rollbackText);'], 'the menu');
  assert.match(SOURCE, /internal static string UpdateMenuText\(string version\) \{ return "Update Kosmos to " \+ version; \}/);
  assert.match(SOURCE, /internal static string RollbackMenuText\(string version\) \{ return "Roll back Kosmos to " \+ version; \}/);
});

test('#4382: after an update or rollback the person asked for, the window closes and the Kosmos.exe now in the folder opens, after the lock', () => {
  const run = method('static int RunBoardWindow(string here, string node, string opener, string app, int port)');
  inOrder(run, ['relaunch = form.RelaunchAfterClose;', 'finally { onlyWindow.ReleaseMutex(); }', 'if (relaunch != null)',
    'StartLauncherAt(Path.Combine(here, "Kosmos.exe"), here);', 'RelaunchFailedMessage(here, relaunchProblem, relaunch == "rollback")'], 'the relaunch');
});

test('#4382: the release switch stays off on main: turning the first-run choice on for Windows is its own decision', () => {
  /* This change makes a connect Windows computer able to update and roll back; it does not turn the choice on
     (tools.windows-computer-mode-4381.test.js pins it off). */
  assert.match(SOURCE, /internal static readonly bool FirstRunChoice = false;/);
});

/* ---- the probe ---------------------------------------------------------- */

/* Each stdin line is one row: a command, then fields split by |. "-" is null.
     report|<report lines joined by \n>
     state|offer;installed;rollback;dismissed|<report lines>|<action>
     notnow|offer;installed;rollback;dismissed|<the bar's button or ->
     args|<action>|<expect or ->
     due|offer;installed;rollback;dismissed
     picked|offer;installed;rollback;dismissed|<inflight 0/1>
     disk|<lock age s or ->|<journal text or ->|<journal age s or -> */
const PROBE = String.raw`
using System;
using System.IO;
using System.Text;

static class UpdateProbe
{
    static string N(string s) { return s == "-" ? null : s; }
    static string Show(string s) { return s ?? "-"; }
    static KosmosLauncher.ConnectUpdateState Before(string f)
    {
        string[] p = f.Split(';');
        var s = new KosmosLauncher.ConnectUpdateState();
        s.Offer = N(p[0]); s.Installed = N(p[1]); s.Rollback = N(p[2]); s.Dismissed = N(p[3]);
        s.Unsettled = p.Length > 4 && p[4] == "U";
        return s;
    }
    static string[] Lines(string f) { return f == "-" ? null : f.Split(new[] { "\\n" }, StringSplitOptions.None); }
    static string State(KosmosLauncher.ConnectUpdateState s)
    {
        return "O=" + Show(s.Offer) + "|I=" + Show(s.Installed) + "|R=" + Show(s.Rollback) + "|D=" + Show(s.Dismissed)
            + "|bar=" + Show(s.BarNote) + "|btn=" + Show(s.BarButton) + "|msg=" + Show(s.Message) + "|re=" + Show(s.Relaunch) + "|next=" + s.NextLookMs + "|U=" + (s.Unsettled ? "1" : "0");
    }
    static int Main(string[] a)
    {
        string input = Console.In.ReadToEnd();
        foreach (string row in input.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
        {
            if (row.Length == 0) continue;
            string[] f = row.Split('|');
            if (f[0] == "report")
            {
                var got = KosmosLauncher.ReadConnectUpdateReport(Lines(f[1]));
                Console.WriteLine(got.Kind + "|" + Show(got.Version) + "|" + Show(got.Value) + "|" + Show(got.RollbackVersion));
            }
            else if (f[0] == "state") Console.WriteLine(State(KosmosLauncher.AfterConnectUpdate(Before(f[1]), KosmosLauncher.ReadConnectUpdateReport(Lines(f[2])), f[3])));
            else if (f[0] == "notnow") { var b = Before(f[1]); b.BarNote = "a bar"; b.BarButton = N(f[2]); Console.WriteLine(State(KosmosLauncher.AfterNotNow(b))); }
            else if (f[0] == "args") Console.WriteLine(KosmosLauncher.ConnectUpdateArguments(f[1], 16180, N(f[2])));
            else if (f[0] == "due") Console.WriteLine(KosmosLauncher.UpdateLookIsDue(Before(f[1])) ? "due" : "not-due");
            else if (f[0] == "picked") Console.WriteLine(Show(KosmosLauncher.UpdatePickedAction(Before(f[1]), f[2] == "1")));
            else if (f[0] == "disk")
            {
                DateTime now = new DateTime(2026, 10, 13, 12, 0, 0, DateTimeKind.Utc);
                DateTime? lockAt = f[1] == "-" ? (DateTime?)null : now.AddSeconds(-double.Parse(f[1]));
                DateTime? journalAt = f[3] == "-" ? (DateTime?)null : now.AddSeconds(-double.Parse(f[3]));
                Console.WriteLine(KosmosLauncher.UpdateUnderWayOnDisk(lockAt, N(f[2]), journalAt, now) ? "busy" : "free");
            }
            else Console.WriteLine("bad row");
        }
        return 0;
    }
}
`;

let probeExe = null;
let probeDir = null;
function runProbe(rows) {
  const r = spawnSync(probeExe, [], { input: rows.join('\n') + '\n', encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  const got = r.stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(got.length, rows.length, 'the probe read every row: ' + r.stdout);
  return got;
}
const needsProbe = (t) => { if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return false; } return true; };
/** One state row's output as an object. */
function stateOf(line) {
  const o = {};
  for (const part of line.split('|')) { const at = part.indexOf('='); o[part.slice(0, at)] = part.slice(at + 1); }
  return o;
}

test('#4382: the probe compiles beside the launcher', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-update-probe-'));
  fs.writeFileSync(path.join(probeDir, 'UpdateProbe.cs'), PROBE);
  const out = path.join(probeDir, 'probe.exe');
  const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:UpdateProbe', '/out:' + out, LAUNCHER, path.join(probeDir, 'UpdateProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  probeExe = out;
});

test.after(() => { if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true }); });

test('#4382: the launcher reads every answer the engine gives as the engine meant it, and a garbled one as unknown', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const { reportLines } = require('./engine/win32connectupdate.js');
  const rows = [
    /* What the engine writes, through its own reportLines. */
    [{ answer: ['current', '0.7.46'], rollback: null }, 'Current|0.7.46|-|-'],
    [{ answer: ['newer', '0.7.50'], rollback: '0.7.40' }, 'Newer|0.7.50|-|0.7.40'],
    [{ answer: ['updated', '0.7.50'], rollback: '0.7.46' }, 'Updated|0.7.50|-|0.7.46'],
    [{ answer: ['rolledback', '0.7.46'], rollback: null }, 'RolledBack|0.7.46|-|-'],
    [{ answer: ['failed', '0.7.50', 'The update did not take. Kosmos is still on 0.7.46.'], rollback: null }, 'Failed|0.7.50|The update did not take. Kosmos is still on 0.7.46.|-'],
    [{ answer: ['pending', 'the update to 0.7.50 has not been seen to finish yet'], rollback: '0.7.46' }, 'Pending|-|the update to 0.7.50 has not been seen to finish yet|0.7.46'],
    [{ answer: ['board'], rollback: '0.7.40' }, 'Board|-|-|0.7.40'],
    [{ answer: ['unknown', 'the release host could not be reached'], rollback: null }, 'Unknown|-|the release host could not be reached|-'],
    [{ answer: ['refused', 'an agent may not update Kosmos; the person who runs this computer does'], rollback: null }, 'Refused|-|an agent may not update Kosmos; the person who runs this computer does|-'],
  ].map(([result, want]) => ['report|' + reportLines(result).join('\\n'), want]);
  /* And what must never read as an answer it is not. */
  rows.push(
    ['report|-', 'Unknown|-|-|-'],
    ['report|newer 0.7', 'Unknown|-|-|-'],
    ['report|current v0.7.46', 'Unknown|-|-|-'],
    ['report|updated 0.7.50 extra', 'Unknown|-|-|-'],
    ['report|board now', 'Unknown|-|-|-'],
    ['report|rollback 0.7.40', 'Unknown|-|-|-'],
    ['report|current 0.7.46\\nrollback 0.7', 'Current|0.7.46|-|-'],
    ['report|\\n  \\nnewer 1.2.3', 'Newer|1.2.3|-|-'],
    ['report|failed no version here', 'Failed|-|no version here|-'],
  );
  const got = runProbe(rows.map((row) => row[0]));
  rows.forEach(([input, want], i) => assert.equal(got[i], want, 'for ' + JSON.stringify(input)));
});

test('#4382: what each answer does: the same consent as the board, never a restart unasked, a failed install can be tried again', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const EVERY = String(constant('UpdateLookEveryMs'));
  const RETRY = String(constant('UpdateLookRetryMs'));
  const rows = [
    /* updates off: offered, Update on the bar, nothing installed */
    ['state|-;-;-;-|newer 0.7.50|look', { O: '0.7.50', I: '-', btn: 'Update', re: '-', next: EVERY }],
    /* updates on (the engine installed): never a restart unasked, a Restart offer instead */
    ['state|-;-;-;-|updated 0.7.50\\nrollback 0.7.46|look', { O: '-', I: '0.7.50', R: '0.7.46', btn: 'Restart', re: '-' }],
    /* the person picked Update: the window closes and the new Kosmos.exe opens */
    ['state|0.7.50;-;-;-|updated 0.7.50\\nrollback 0.7.46|install', { re: 'update', O: '-' }],
    ['state|-;-;0.7.46;-|rolledback 0.7.46|rollback', { re: 'rollback', I: '-', O: '-' }],
    /* MUST FIX 1: an automatic install that failed: the version stays on offer, so Update can try again */
    ['state|-;-;-;-|failed 0.7.50 The update did not take.|look', { O: '0.7.50', btn: 'Update', re: '-' }],
    /* an update or roll back not seen to finish: no button, and nothing more starts until Kosmos opens again */
    ['state|0.7.50;-;-;-|pending the update to 0.7.50 has not been seen to finish yet|install', { btn: '-', U: '1', re: '-' }],
    /* a failure with no version to retry: said, and no button that would do nothing */
    ['state|-;-;-;-|failed something broke|look', { O: '-', btn: '-' }],
    /* a failed rollback is a box, and the offer bar stays as it was */
    ['state|0.7.50;-;0.7.46;-|failed 0.7.46 no|rollback', { O: '0.7.50', btn: 'Update' }],
    /* MUST FIX 2: a later "newer" never loses the Restart prompt of an installed update */
    ['state|-;0.7.50;0.7.46;-|newer 0.7.51\\nrollback 0.7.46|look', { I: '0.7.50', O: '0.7.51', btn: 'Restart' }],
    /* could not look: an hour, and what was on offer stays on offer; said only when asked */
    ['state|0.7.50;-;0.7.46;-|unknown host down|look', { O: '0.7.50', R: '0.7.46', btn: 'Update', next: RETRY }],
    ['state|0.7.50;-;-;-|unknown host down|install', { btn: '-', next: EVERY }],
    ['state|0.7.50;-;-;-|refused an update is already under way|install', { btn: '-' }],
    ['state|0.7.50;-;-;-|board|look', { O: '0.7.50', btn: 'Update' }],
    /* a refused look (another update's lock, a resumer still running) is tried again within the hour */
    ['state|0.7.50;-;-;-|refused an earlier update has not finished|look', { O: '0.7.50', next: RETRY }],
    /* current: nothing newer, and the rollback offer follows the answer */
    ['state|0.7.50;-;0.7.46;-|current 0.7.46|look', { O: '-', R: '-', bar: '-', btn: '-' }],
    /* the person picked Update and nothing is newer any more: said, not a bar that silently vanishes */
    ['state|0.7.50;-;-;-|current 0.7.46|install', { O: '-', btn: '-' }],
    /* the window's own look failing again on a version put away with Not now: the menu only */
    ['state|0.7.50;-;-;0.7.50|failed 0.7.50 again|look', { O: '0.7.50', bar: '-', btn: '-' }],
    /* a version put away with Not now stays off the bar (the menu keeps it) */
    ['state|-;-;-;0.7.50|newer 0.7.50|look', { O: '0.7.50', bar: '-' }],
    /* a roll back not seen to finish, and the window's own look: the same, a note and nothing more started */
    ['state|-;-;0.7.46;-|pending the roll back to 0.7.46 has not been seen to finish yet|rollback', { btn: '-', U: '1', re: '-', msg: '-' }],
    ['state|-;-;-;-|pending the update to 0.7.50 has not been seen to finish yet|look', { btn: '-', U: '1' }],
    /* once unsettled, it stays so whatever a later answer says, until Kosmos opens again */
    ['state|-;-;-;-;U|updated 0.7.50|look', { U: '1' }],
  ];
  const got = runProbe(rows.map((r) => r[0]));
  rows.forEach(([input, want], i) => {
    const s = stateOf(got[i]);
    for (const [k, v] of Object.entries(want)) assert.equal(s[k], v, `${input}: ${k} (got ${got[i]})`);
  });
  /* The words on the bar, for the rows whose wording is the point. An offer is worded for every `newer`
     answer, which is also a version held after a roll back, or one whose automatic install could not start. */
  assert.equal(stateOf(got[0]).bar, 'Kosmos 0.7.50 is ready. Press Update to install it.', 'never claims updates are off');
  assert.match(stateOf(got[4]).bar, /^Kosmos could not update \(The update did not take\.\)\. Press Update to try again\.$/);
  assert.equal(stateOf(got[5]).bar, 'Kosmos has not finished (the update to 0.7.50 has not been seen to finish yet). Close Kosmos and open it again in a few minutes to see which version it is on.',
    'an update that may still finish invites no retry, and says the way on');
  assert.doesNotMatch(stateOf(got[6]).bar, /Press Update/, 'a note that names a button the bar does not have');
  assert.equal(stateOf(got[7]).msg, 'The roll back did not finish: no.', 'a failed roll back never claims which version is in place');
  assert.notEqual(stateOf(got[10]).bar, '-', 'the person asked and heard nothing');
  assert.equal(stateOf(got[15]).bar, 'Kosmos is up to date.', 'the person pressed Update and saw nothing happen');
  const args = runProbe(['args|rollback|0.7.46', 'args|look|0.7.46', 'args|rollback|0.7.46 --yes', 'args|rollback|-', 'args|install|0.7.50']);
  assert.deepEqual(args, ['--rollback --port 16180 --expect 0.7.46', '--look --port 16180', '--rollback --port 16180', '--rollback --port 16180', '--install --port 16180 --expect 0.7.50'],
    'a rollback and an install name the version agreed to, a look none, and only a real version reaches the command line');
  const engine = require('./engine/win32connectupdate.js');
  assert.equal(engine.parseArgs(args[0].split(' ')).expect, '0.7.46', 'the engine reads what the launcher sends');
});

test('#4382: Not now, the daily look, and Update: pure decisions', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const got = runProbe([
    'notnow|0.7.50;-;-;-|Update', 'notnow|-;0.7.50;-;-|Restart', 'notnow|0.7.50;-;-;-|-',
    'due|-;-;-;-', 'due|0.7.50;-;-;-', 'due|-;0.7.50;-;-',
    'picked|0.7.50;-;-;-|0', 'picked|-;0.7.50;-;-|0', 'picked|0.7.50;-;-;-|1', 'picked|-;-;-;-|0',
    'due|0.7.50;-;-;-;U', 'picked|0.7.50;-;-;-;U|0', 'picked|-;0.7.50;-;-;U|0',
  ]);
  assert.deepEqual([stateOf(got[0]).D, stateOf(got[0]).bar, stateOf(got[1]).D], ['0.7.50', '-', '0.7.50'], 'Not now puts the offer, or the Restart, away');
  /* MUST FIX 2: no look (so no second install, whose cleanup would delete the folder this window runs from) while a Restart waits */
  assert.deepEqual(got.slice(3, 6), ['due', 'due', 'not-due']);
  assert.deepEqual(got.slice(6, 10), ['install', 'restart', 'busy', '-'], 'Update installs, restarts into an installed one, or says a run is under way');
  /* An update or roll back not seen to finish: no look, and Update does nothing, until Kosmos opens again. */
  assert.deepEqual(got.slice(10, 13), ['not-due', '-', '-']);
  /* Not now on a note with no button (could not reach the host, say) puts away the note, not the offer under it. */
  assert.deepEqual([stateOf(got[2]).D, stateOf(got[2]).bar, stateOf(got[2]).O], ['-', '-', '0.7.50']);
});

test('#4382: an update on its way on disk holds Run agents, a stale or finished one does not', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const fresh = String(Math.floor(constant('UpdateOnDiskFreshMs') / 1000));
  assert.ok(constant('UpdateOnDiskFreshMs') > constant('UpdateLookTimeoutMs'),
    'once the window gives up on a look, the files it left must still hold Run agents while that run can still be going');
  const unfinished = '{  "token": "t",  "finished": false }'.replace(/\s+/g, ' ');
  const finished = '{ "token": "t", "finished": true }';
  const got = runProbe([
    'disk|-|-|-',
    'disk|10|-|-',
    `disk|${fresh}|-|-`,
    `disk|-|${unfinished}|10`,
    `disk|-|${finished}|10`,
    `disk|-|{	"finished":	true}|10`,
    `disk|-|${unfinished}|${fresh}`,
  ]);
  assert.deepEqual(got, ['free', 'busy', 'free', 'busy', 'free', 'free', 'free']);
});
