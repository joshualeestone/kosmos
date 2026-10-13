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
  assert.match(method('internal static string ConnectUpdateArguments(string action, int port)'), /return "--" \+ action \+ " --port " \+ port;/);
  assert.deepEqual(engine.parseArgs(['--rollback', '--port', '16180', '--report', 'r.txt', '--yes']), { action: 'rollback', port: '16180', report: 'r.txt', yes: true, unknown: null },
    'the engine reads what RunEngineHelper sends: the arguments, then --report <file> --yes');
});

test('#4382: a connect launch looks for an update once its stop of the board is done, and again once a day', () => {
  const background = method('void StopBoardInBackground(bool thenSignIn)');
  inOrder(background, ['KosmosLauncher.StopBoardHere(boardPort, task)', 'BeginInvoke(', 'stopsInFlight--;', 'if (mode == KosmosLauncher.ComputerMode.Connect) StartUpdateLooks();'],
    'the look starts before the stop is done, or on a computer that runs agents');
  /* Both connect entries go through that stop: a connect launch (OnLoad) and a switch to connect (SwitchToConnect). */
  assert.match(slice('protected override void OnLoad(EventArgs e)', 'try'), /else StopBoardInBackground\(false\);/);
  assert.match(method('void SwitchToConnect()'), /StopBoardInBackground\(true\);/);

  const start = method('void StartUpdateLooks()');
  inOrder(start, ['if (mode != KosmosLauncher.ComputerMode.Connect) return;', 'updateTimer = new System.Windows.Forms.Timer();',
    'updateTimer.Interval = KosmosLauncher.UpdateLookEveryMs;', 'updateTimer.Tick += (sender, args) => LookForUpdate("look");', 'updateTimer.Start();', 'LookForUpdate("look");'],
    'the daily look');
  const every = constant('UpdateLookEveryMs');
  const retry = constant('UpdateLookRetryMs');
  assert.ok(every > 0 && every <= 24 * 60 * 60 * 1000, 'a look at least once a day');
  assert.ok(every <= 0x7fffffff, 'a WinForms Timer interval is an int');
  assert.ok(retry > 0 && retry < every, 'a look that could not reach the host is tried again sooner');
  assert.match(method('void UpdateLookDone(KosmosLauncher.ConnectUpdateAnswer answer, string action)'),
    /int next = answer\.Kind == KosmosLauncher\.ConnectUpdateKind\.Unknown && !asked \? KosmosLauncher\.UpdateLookRetryMs : KosmosLauncher\.UpdateLookEveryMs;/);
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
    'KosmosLauncher.ConnectUpdateArguments(action, boardPort), 0, out problem);',
    'KosmosLauncher.ReadConnectUpdateReport(lines);',
    'BeginInvoke(',
    'updateLookInFlight = false;',
    'stopsInFlight--;',
    'UpdateLookDone(answer, action);',
  ], 'the look');
  assert.match(look, /look\.IsBackground = false;/, 'closing the window could cut an install off between its steps');
  inOrder(method('void RunAgentsHere()'), [
    'if (mode != KosmosLauncher.ComputerMode.Connect) return;',
    'if (updateLookInFlight) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }',
    'if (stopsInFlight > 0)',
  ], 'Run agents during an update');
  /* The window still starts no board: the engine's run is the only process it adds, and it is not the board. */
  const form = slice('class BoardWindowForm : System.Windows.Forms.Form', '// The completion handlers and event handlers WebView2 calls back on.');
  assert.doesNotMatch(form, /RunSchtasks\(|"\/Run|OpenerStartInfo|server\.js/);
  assert.equal(count(form, 'KosmosLauncher.runEngineHelper('), 1, 'the window runs an engine helper somewhere other than the update look');
});

test('#4382: the same consent as the board: nothing installs unless updates are on or the person picked it, and nothing restarts unasked', () => {
  const done = method('void UpdateLookDone(KosmosLauncher.ConnectUpdateAnswer answer, string action)');
  assert.match(done, /bool asked = action != "look";/);
  /* Newer (updates off): an offer only. */
  inOrder(slice('case KosmosLauncher.ConnectUpdateKind.Newer:', 'break;'), ['updateOffer = answer.Value;', 'ShowCurrentOffer();'], 'the offer');
  /* Updated: a relaunch only when the person asked; an unasked install waits for the person's Restart. */
  inOrder(slice('case KosmosLauncher.ConnectUpdateKind.Updated:', 'break;'),
    ['if (asked) { RelaunchAfterClose = true; Close(); return; }', 'updateInstalled = answer.Value;', 'ShowCurrentOffer();'], 'after an install');
  /* The only install and the only rollback are the person's picks, and a rollback is asked first. */
  assert.equal(count(SOURCE, 'LookForUpdate("install")'), 1);
  assert.equal(count(SOURCE, 'LookForUpdate("rollback")'), 1);
  inOrder(method('void UpdatePicked()'), ['if (mode != KosmosLauncher.ComputerMode.Connect || updateLookInFlight) return;',
    'if (updateInstalled != null) { RelaunchAfterClose = true; Close(); return; }', 'if (updateOffer != null) LookForUpdate("install");'], 'Update');
  inOrder(method('void RollbackPicked()'), ['rollbackOffer == null) return;', 'if (!KosmosLauncher.askYesNo(KosmosLauncher.RollbackQuestion(rollbackOffer))) return;',
    'LookForUpdate("rollback");'], 'Roll back');
  /* The bar is the window's, over the page, never in it (Liu Kang's ruling for the Mac half). */
  const bar = method('void ShowUpdateBar(string note, string button)');
  assert.match(bar, /Controls\.Add\(updateBar\);/);
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
  inOrder(menu, ['bool want = mode == KosmosLauncher.ComputerMode.Connect;', 'updateInstalled != null ? KosmosLauncher.RestartMenuText(updateInstalled)',
    'updateOffer != null ? KosmosLauncher.UpdateMenuText(updateOffer)', 'want && rollbackOffer != null ? KosmosLauncher.RollbackMenuText(rollbackOffer) : null;',
    'if (updateText != null) AppendMenuW(menu, MF_STRING, new UIntPtr((uint)UpdateMenuId), updateText);',
    'if (rollbackText != null) AppendMenuW(menu, MF_STRING, new UIntPtr((uint)RollbackMenuId), rollbackText);'], 'the menu');
  assert.match(SOURCE, /internal static string UpdateMenuText\(string version\) \{ return "Update Kosmos to " \+ version; \}/);
  assert.match(SOURCE, /internal static string RollbackMenuText\(string version\) \{ return "Roll back Kosmos to " \+ version; \}/);
  /* The menu follows each answer. */
  assert.match(method('void UpdateLookDone(KosmosLauncher.ConnectUpdateAnswer answer, string action)'), /UpdateRunAgentsItem\(\);\s*$/);
});

test('#4382: after an update or rollback the person asked for, the window closes and the Kosmos.exe now in the folder opens, after the lock', () => {
  const run = method('static int RunBoardWindow(string here, string node, string opener, string app, int port)');
  inOrder(run, ['relaunch = form.RelaunchAfterClose;', 'finally { onlyWindow.ReleaseMutex(); }', 'if (relaunch)',
    'StartLauncherAt(Path.Combine(here, "Kosmos.exe"), here);', 'RelaunchFailedMessage(here, relaunchProblem)'], 'the relaunch');
});

test('#4382: the release switch stays off on main: turning the first-run choice on for Windows is its own decision', () => {
  /* This change makes a connect Windows computer able to update and roll back; it does not turn the choice on
     (tools.windows-computer-mode-4381.test.js pins it off). */
  assert.match(SOURCE, /internal static readonly bool FirstRunChoice = false;/);
});

/* ---- the probe ---------------------------------------------------------- */

const PROBE = String.raw`
using System;
using System.IO;
using System.Text;

static class UpdateProbe
{
    static int Main(string[] a)
    {
        // One report per line of stdin, its lines joined by a literal \n; the answer as kind|value|rollback.
        string input = Console.In.ReadToEnd();
        foreach (string row in input.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
        {
            if (row.Length == 0) continue;
            string[] lines = row == "<null>" ? null : row.Split(new[] { "\\n" }, StringSplitOptions.None);
            var got = KosmosLauncher.ReadConnectUpdateReport(lines);
            Console.WriteLine(got.Kind + "|" + (got.Value ?? "<null>") + "|" + (got.RollbackVersion ?? "<null>"));
        }
        return 0;
    }
}
`;

let probeExe = null;
let probeDir = null;

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
  if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return; }
  const { reportLines } = require('./engine/win32connectupdate.js');
  const rows = [
    /* What the engine writes, through its own reportLines. */
    [{ answer: ['current', '0.7.46'], rollback: null }, 'Current|0.7.46|<null>'],
    [{ answer: ['newer', '0.7.50'], rollback: '0.7.40' }, 'Newer|0.7.50|0.7.40'],
    [{ answer: ['updated', '0.7.50'], rollback: '0.7.46' }, 'Updated|0.7.50|0.7.46'],
    [{ answer: ['rolledback', '0.7.46'], rollback: null }, 'RolledBack|0.7.46|<null>'],
    [{ answer: ['failed', 'The update did not take. Kosmos is still on 0.7.46.'], rollback: null }, 'Failed|The update did not take. Kosmos is still on 0.7.46.|<null>'],
    [{ answer: ['board'], rollback: '0.7.40' }, 'Board|<null>|0.7.40'],
    [{ answer: ['unknown', 'the release host could not be reached'], rollback: null }, 'Unknown|the release host could not be reached|<null>'],
    [{ answer: ['refused', 'an agent may not update Kosmos; the person who runs this computer does'], rollback: null }, 'Refused|an agent may not update Kosmos; the person who runs this computer does|<null>'],
  ].map(([result, want]) => [reportLines(result).join('\\n'), want]);
  /* And what must never read as an answer it is not. */
  rows.push(
    ['<null>', 'Unknown|<null>|<null>'],
    ['newer 0.7', 'Unknown|<null>|<null>'],
    ['current v0.7.46', 'Unknown|<null>|<null>'],
    ['updated 0.7.50 extra', 'Unknown|<null>|<null>'],
    ['board now', 'Unknown|<null>|<null>'],
    ['rollback 0.7.40', 'Unknown|<null>|<null>'],
    ['current 0.7.46\\nrollback 0.7', 'Current|0.7.46|<null>'],
    ['\\n  \\nnewer 1.2.3', 'Newer|1.2.3|<null>'],
  );
  const r = spawnSync(probeExe, [], { input: rows.map((row) => row[0]).join('\n') + '\n', encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  const got = r.stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(got.length, rows.length, 'the probe read every row: ' + r.stdout);
  rows.forEach(([input, want], i) => assert.equal(got[i], want, 'for ' + JSON.stringify(input)));
});
