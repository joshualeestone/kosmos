'use strict';

/**
 * #4381, the Windows half of #4356: Kosmos.exe asks whether this computer runs agents or connects to
 * agents on another computer, and a connect computer never starts its board.
 *
 *   node --test tools.windows-computer-mode-4381.test.js
 *
 * The Windows twin of native-app.computer-mode-4356.test.js (the Mac app) and of main.swift's
 * --kosmos-app-mode-selftest, in two halves, as the other launcher tests do it:
 *   - the SOURCE (tools/windows/KosmosLauncher.cs), for the wiring nothing can call from outside: the
 *     release switch, the order things happen in, who may choose, what a connect computer starts;
 *   - a PROBE compiled beside the launcher (Windows only), which runs the SAME ROWS the Mac selftest
 *     runs for the mode reader and the link rules, plus Windows' own (a CRLF ending, a byte order
 *     mark, a non-ASCII host), the file on disk, the address the window opens, the page's message,
 *     and the connect stop against real listeners. Like the Mac's, a run that does not reach every
 *     row is a failure, never a pass.
 * Kosmos.exe itself carries no selftest flag: tools/build-kosmos-windows.sh runs on a Mac and only
 * copies the committed, signed binary, so it could not run one. The engine half (an update never starts
 * a connect computer's board) is in engine/win32apply.test.js (#4381 cases). The page's half is
 * web.firstrun-choice-4356.test.js (the chrome.webview bridge).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

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

test('#4381: the instrument is reading the launcher', () => {
  assert.ok(SOURCE.length > 100000, 'KosmosLauncher.cs read back only ' + SOURCE.length + ' bytes');
});

test('#4381: THE RELEASE SWITCH IS OFF ON MAIN, as the Mac\'s kosmosFirstRunChoice is, until #4382 lets a connect computer update', () => {
  assert.match(SOURCE, /internal static readonly bool FirstRunChoice = false;/, 'the first-run choice reached a Windows computer before #4382');
  const launch = method('internal static ComputerMode LaunchComputerMode()');
  assert.match(launch, /if \(!FirstRunChoice\) return ComputerMode\.Run;\s*return ReadComputerMode\(computerModeFile\(\)\);/,
    'with the switch off the mode file must not even be read, and every computer runs agents as before');
  const mac = fs.readFileSync(path.join(REPO, 'native-app', 'main.swift'), 'utf8');
  assert.match(mac, /let kosmosFirstRunChoice = false/, 'the Mac\'s switch moved; the two must be turned on together by #4382');
  /* Every place the launcher and the window learn the mode goes through LaunchComputerMode, so the switch covers all of them. */
  const reads = [...SOURCE.matchAll(/ReadComputerMode\(/g)].length;
  assert.equal(reads, 2, 'ReadComputerMode is called somewhere the switch does not cover (its declaration and LaunchComputerMode only)');
  assert.equal([...SOURCE.matchAll(/LaunchComputerMode\(\)/g)].length, 4, 'the declaration, Main (before the board, and after it ended), and the window');
});

test('#4381: the mode file is where the engine reads it, and a reinstall asks again', () => {
  assert.match(SOURCE, /internal const string ComputerModeFolderName = "Kosmos";/);
  assert.match(SOURCE, /internal const string ComputerModeFileName = "mode";/);
  assert.match(SOURCE, /Path\.Combine\(Path\.Combine\(LocalAppDataFolder\(\), ComputerModeFolderName\), ComputerModeFileName\)/);
  const apply = require('./engine/win32apply.js');
  assert.equal(apply.COMPUTER_MODE_FOLDER_NAME, 'Kosmos', 'the updater reads another folder than Kosmos.exe writes');
  assert.equal(apply.COMPUTER_MODE_FILE_NAME, 'mode');
  /* Outside the Kosmos folder: the updater's swap moves exactly ENTRIES, and `mode` is not among them. */
  const update = require('./engine/win32update.js');
  assert.ok(!update.ENTRIES.includes('mode'), 'an update would move the mode file');
  /* The uninstall removes %LOCALAPPDATA%\Kosmos (item 8), which holds it. */
  assert.match(fs.readFileSync(path.join(REPO, 'engine', 'win32uninstall.js'), 'utf8'), /8\. %LOCALAPPDATA%\\Kosmos \(the anchor's folder\) goes/);
});

test('#4381: the mode is read in Main BEFORE the board, the opener or a stuck-board replacement is started, and a connect launch starts neither', () => {
  const main = slice('static int Main(string[] args)', '\n    // The board\'s port: PORT when');
  inOrder(main, [
    'int? endedByInstallerDuties = RunInstallerDuties(here, node, port);',
    'bool connects = LaunchComputerMode() == ComputerMode.Connect;',
    'if (showMessageBoxes && !connects)',
    'ReplaceBoardIfStuck(',
    'if (File.Exists(opener) && (!connects || Environment.UserInteractive))',
    'Process.Start(o);',
    'if (connects)',
    'return browserProblem != null ? 1 : 0;',
    'ProcessStartInfo s = new ProcessStartInfo(node, "\\"" + server + "\\"");',
  ], 'a connect launch reaches the board');
  /* A board serving from this launcher that Connect ended is not "Kosmos stopped unexpectedly" (measured: it
     said so, over Kosmos Plus sign-in, before this). With the switch off LaunchComputerMode is Run, so no change. */
  assert.match(main, /bool endedByConnect = p\.ExitCode != 0 && LaunchComputerMode\(\) == ComputerMode\.Connect;\s*if \(p\.ExitCode != 0 && !stoppedByPerson && !endedByConnect\)/,
    'a board the person\'s Connect ended is reported as a crash');
  /* The one thing a connect launch starts is the window (BoardWindowStartInfo); with nobody at the
     desktop, not the opener either. */
  assert.match(main, /ProcessStartInfo o = Environment\.UserInteractive\s*\? BoardWindowStartInfo\(here\)\s*: OpenerStartInfo\(here, node, opener, app, port, false\);/);
  /* The window asks open-board.js nothing on a connect computer: it would wait for a board never started. */
  const show = slice('static BoardWindowForm ShowBoardWindow(', 'static string ResolveBoardAddress(');
  inOrder(show, ['ComputerMode mode = LaunchComputerMode();', 'new BoardWindowForm(', 'if (mode != ComputerMode.Connect) form.ResolveBoardAddressInBackground();', 'System.Windows.Forms.Application.Run(form);'],
    'a connect window runs open-board.js');
  assert.doesNotMatch(show, /new Thread\(/, 'a second, unconditional resolve is still started');
  const resolved = method('internal void BoardAddressResolved(string address)');
  assert.match(resolved, /if \(mode == KosmosLauncher\.ComputerMode\.Connect\) return;/, 'a late address loads the stopped board');
  assert.match(resolved, /boardAddress = KosmosLauncher\.WithModeQuery\(address, mode\);/, 'the page is not told the choice');
  const ready = method('internal void ControllerReady(int hr, ICoreWebView2Controller created)');
  assert.match(ready, /if \(mode == KosmosLauncher\.ComputerMode\.Connect\) LoadConnect\(\);\s*else if \(boardAddress != null\) NavigateToBoard\(\);/,
    'a connect window does not open straight at Kosmos Plus');
  assert.match(SOURCE, /internal const string KosmosPlusSignIn = "https:\/\/login\.kosmosplus\.com\/";/);
});

test('#4381: only the board\'s own page, and only while the window is asking, can choose', () => {
  const heard = method('internal void OnWebMessage(ICoreWebView2WebMessageReceivedEventArgs args)');
  inOrder(heard, ['if (!KosmosLauncher.IsBoardAddress(source, port)) return;', 'string chosen = KosmosLauncher.ModeFromPageMessage(json);', 'if (chosen != null) { PageChoseMode(chosen); return; }'],
    'a Kosmos Plus page, or any other site, can set the mode');
  const chose = method('void PageChoseMode(string choice)');
  assert.match(chose.split('\n').slice(1, 4).join('\n'), /if \(mode != KosmosLauncher\.ComputerMode\.Unset && mode != KosmosLauncher\.ComputerMode\.Unreadable\) return;/,
    'a page can change a choice already made');
  assert.match(SOURCE, /internal const string PageModeMessageKey = "kosmosMode";/);
  const page = fs.readFileSync(path.join(REPO, 'web', 'index.html'), 'utf8');
  assert.match(page, /wv\.postMessage\(\{ kosmosMode: mode \}\)/, 'the page and the window disagree on the message');
  /* A choice that cannot be saved is said, and Connect then changes nothing. */
  assert.match(chose, /if \(!KosmosLauncher\.WriteComputerMode\(chosen, file\)\) Say\(KosmosLauncher\.ChoiceNotSavedMessage\(folder\), true\);/);
  inOrder(chose, ['case "connect":', 'if (!KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Connect, file))', 'Say(KosmosLauncher.ConnectNotSavedMessage(folder), true);', 'return;', 'SwitchToConnect();'],
    'a Connect that could not be saved still stops the board');
  /* Boxes never inside WebView2's callback. */
  assert.match(method('void Say(string text, bool isError)'), /BeginInvoke\(/);
});

test('#4381: Connect runs in the spec\'s order: the badge, then the task switched off, then the board ended, then sign-in; a failed stop is said', () => {
  const sw = method('void SwitchToConnect()');
  inOrder(sw, ['mode = KosmosLauncher.ComputerMode.Connect;', 'StopBadge();', 'UpdateRunAgentsItem();', 'StopBoardInBackground(true);'], 'Connect');
  const badge = method('void StopBadge()');
  assert.match(badge, /badgeTimer\.Stop\(\); badgeTimer\.Dispose\(\); badgeTimer = null;/);
  assert.match(badge, /badgeWanted = null;\s*ApplyBadge\(\);/, 'the overlay is left on the taskbar button');
  const stop = method('internal static bool StopBoardHere(int port, string taskName)');
  inOrder(stop, [
    'if (taskName != null && RunSchtasks("/Query /TN " + QuoteArgument(taskName)) == 0)',
    'RunSchtasks("/Change /TN " + QuoteArgument(taskName) + " /DISABLE") != 0',
    'RunSchtasks("/End /TN " + QuoteArgument(taskName));',
    'return EndKosmosBoardsOnPort(port) && ok;',
  ], 'the board is ended before its task is switched off, so a sign-in can bring it back');
  const background = method('void StopBoardInBackground(bool thenSignIn)');
  inOrder(background, ['stopsInFlight++;', 'new Thread(', 'KosmosLauncher.StopBoardHere(boardPort, task)', 'BeginInvoke(', 'stopsInFlight--;',
    'if (thenSignIn && mode == KosmosLauncher.ComputerMode.Connect) LoadConnect();', 'if (!stopped) KosmosLauncher.ShowWindowMessage(KosmosLauncher.BoardStillRunningMessage, true);'],
    'the stop runs on the window\'s thread, or sign-in loads before it, or a failed stop is silent');
  assert.match(background, /stop\.IsBackground = false;/, 'closing the window can cut a stop off between its steps');
  /* A launch that set PORT (a throwaway board) never touches the logon task. */
  assert.match(method('internal static string BoardTaskForThisPort()'), /string\.IsNullOrEmpty\(Environment\.GetEnvironmentVariable\("PORT"\)\) \? BoardTaskName : null/);
  assert.match(SOURCE, /boardTask = KosmosLauncher\.BoardTaskForThisPort\(\);/);
  /* Only Kosmos boards of this user are ended, held open from the moment they are judged. */
  const end = method('internal static bool EndKosmosBoardsOnPort(int port)');
  inOrder(end, ['HeldProcess.Open(pid)', 'List<int> again = ListenersOnPort(port);', 'isKosmosBoardProcess(p)', 'EndProcessTree(board);', 'WaitForPortRelease(port, held);'], 'the connect stop');
});

test('#4381: every launch of a connect computer stops a leftover board, shows no badge, and nothing in the window ever starts the board but "Run agents"', () => {
  const load = slice('protected override void OnLoad(EventArgs e)', 'try');
  assert.match(load, /if \(mode != KosmosLauncher\.ComputerMode\.Connect\) StartBadge\(\);\s*else StopBoardInBackground\(false\);/);
  assert.match(method('internal void OnWebMessage(ICoreWebView2WebMessageReceivedEventArgs args)'), /if \(mode == KosmosLauncher\.ComputerMode\.Connect\) return;\s*int\? waiting;/, 'a board page still on screen sets the badge');
  assert.match(method('void BoardAnswered(bool answered, int? waiting, int asked)'), /if \(mode == KosmosLauncher\.ComputerMode\.Connect\) return;/, 'a read asked before Connect sets the badge');
  /* Reload and "open Kosmos again": nothing starts the board. */
  const again = method('internal void SignInAgain()');
  assert.match(again, /if \(mode == KosmosLauncher\.ComputerMode\.Connect\) \{ if \(connectLoadFailed\) LoadConnect\(\); return; \}/);
  const form = slice('class BoardWindowForm : System.Windows.Forms.Form', '// The completion handlers and event handlers WebView2 calls back on.');
  assert.doesNotMatch(form, /RunSchtasks\(|"\/Run|OpenerStartInfo|server\.js/, 'the window starts the board some way other than Run agents');
  assert.equal([...form.matchAll(/KosmosLauncher\.startLauncher\(/g)].length, 1, 'the window opens Kosmos.exe from somewhere other than Run agents');
  assert.equal([...form.matchAll(/KosmosLauncher\.EnableBoardTask\(/g)].length, 1);
});

test('#4381: "Run agents on this computer" is in the system menu only on a connect computer, waits for a stop, and says a failed save', () => {
  const run = method('void RunAgentsHere()');
  inOrder(run, [
    'if (mode != KosmosLauncher.ComputerMode.Connect) return;',
    'if (stopsInFlight > 0) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillStoppingMessage, false); return; }',
    'if (!KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Run, file))',
    'KosmosLauncher.RunAgentsNotSavedMessage(',
    'return;',
    'mode = KosmosLauncher.ComputerMode.Run;',
    'KosmosLauncher.EnableBoardTask(task);',
    'KosmosLauncher.startLauncher(exe, folder);',
    'StartBadge();',
    'ResolveBoardAddressInBackground();',
  ], 'Run agents');
  const item = method('void UpdateRunAgentsItem()');
  assert.match(item, /bool want = mode == KosmosLauncher\.ComputerMode\.Connect;/);
  assert.match(item, /AppendMenuW\(menu, MF_STRING, new UIntPtr\(\(uint\)RunAgentsMenuId\), KosmosLauncher\.RunAgentsMenuText\);/);
  assert.match(item, /GetSystemMenu\(Handle, true\);/, 'the item stays after the computer runs agents again');
  assert.match(SOURCE, /internal const string RunAgentsMenuText = "Run agents on this computer";/);
  const id = SOURCE.match(/internal const int RunAgentsMenuId = 0x([0-9A-Fa-f]+);/);
  assert.ok(id && (parseInt(id[1], 16) & 0xF) === 0 && parseInt(id[1], 16) < 0xF000, 'a WM_SYSCOMMAND id must keep its low four bits clear and sit below the system\'s own');
  assert.match(slice('protected override void WndProc(', 'base.WndProc(ref m);'), /if \(m\.Msg == WM_SYSCOMMAND && \(\(long\)m\.WParam & 0xFFF0\) == RunAgentsMenuId\) \{ RunAgentsHere\(\); return; \}/);
  assert.match(slice('protected override void OnLoad(EventArgs e)', 'try'), /UpdateRunAgentsItem\(\);/, 'a connect launch has no way back');
});

test('#4381: a connect window follows the connect link rules; Kosmos Plus not answering is said', () => {
  const nav = method('internal void OnNavigationStarting(ICoreWebView2NavigationStartingEventArgs args)');
  inOrder(nav, ['if (mode == KosmosLauncher.ComputerMode.Connect)', 'args.get_IsUserInitiated(out userInitiated);', 'KosmosLauncher.ConnectLinkDecision(uri, userInitiated != 0)',
    'if (decided == KosmosLauncher.ConnectLink.InApp) return;', 'args.put_Cancel(1);', 'OpenInPersonsBrowser(uri, true)', 'return;', 'KosmosLauncher.IsBoardAddress(uri, port)'], 'the connect rules');
  const popup = method('internal void OnNewWindowRequested(ICoreWebView2NewWindowRequestedEventArgs args)');
  assert.match(popup, /KosmosLauncher\.ConnectLinkDecision\(uri, true\)/);
  const done = method('internal void OnNavigationCompleted(ICoreWebView2NavigationCompletedEventArgs args)');
  assert.match(done, /if \(mode != KosmosLauncher\.ComputerMode\.Connect \|\| !connectLoadPending\) return;/);
  assert.match(done, /connectLoadFailed = success == 0 && status != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED;/);
  assert.match(done, /KosmosLauncher\.KosmosPlusUnreachableMessage/);
  /* WebView2.h 1.0.4191.47: the handler's and the args' ids, and add_NavigationCompleted's slot. */
  assert.match(SOURCE, /\[ComImport, Guid\("d33a35bf-1c49-4f98-93ab-006e0533fe1c"\), InterfaceType\(ComInterfaceType\.InterfaceIsIUnknown\)\]\npublic interface ICoreWebView2NavigationCompletedEventHandler/);
  assert.match(SOURCE, /\[ComImport, Guid\("30d68b7d-20d9-4752-a9ca-ec8448fbb5c1"\), InterfaceType\(ComInterfaceType\.InterfaceIsIUnknown\)\]\npublic interface ICoreWebView2NavigationCompletedEventArgs\n\{\n    void get_IsSuccess\(out int isSuccess\);\n    void get_WebErrorStatus\(out int webErrorStatus\);\n\}/);
  const core = slice('public interface ICoreWebView2\n{', '\n}\n');
  const slots = core.split('\n').map((l) => l.match(/^\s+void (?:_unused_)?(\w+)\(/)).filter(Boolean).map((m) => m[1]);
  assert.equal(slots.indexOf('add_NavigationCompleted'), 12, 'add_NavigationCompleted is not ICoreWebView2\'s 13th method');
  const starting = slice('public interface ICoreWebView2NavigationStartingEventArgs\n{', '\n}\n');
  assert.deepEqual(starting.split('\n').map((l) => l.match(/^\s+void (?:_unused_)?(\w+)\(/)).filter(Boolean).map((m) => m[1]),
    ['get_Uri', 'get_IsUserInitiated', 'get_IsRedirected', 'get_RequestHeaders', 'get_Cancel', 'put_Cancel']);
});

test('#4381: the updater\'s board starts obey the mode too (engine/win32apply.js), so an update never brings a connect computer\'s board back', () => {
  const apply = fs.readFileSync(path.join(REPO, 'engine', 'win32apply.js'), 'utf8');
  const confirm = apply.slice(apply.indexOf('async function startAndConfirm('), apply.indexOf('/* â”€â”€â”€ H5 and H6'));
  assert.ok(confirm.indexOf('if (!deps.mayStartBoard())') > -1 && confirm.indexOf('if (!deps.mayStartBoard())') < confirm.indexOf('deps.board.runNow()'), 'H7/H8 /Run before the mode is read');
  const restart = apply.slice(apply.indexOf('function restartBoardAfterExit('), apply.indexOf('function finishRun('));
  assert.ok(restart.indexOf('if (!ctx.deps.mayStartBoard())') > -1 && restart.indexOf('if (!ctx.deps.mayStartBoard())') < restart.indexOf('ctx.deps.board.runNow()'), 'the post-exit /Run before the mode is read');
  assert.equal([...apply.matchAll(/board\.runNow\(\)/g)].length, 2, 'win32apply starts the board somewhere the mode is not read');
});

/* ---- the probe ---------------------------------------------------------- */

/* The Mac's --kosmos-app-mode-selftest rows, word for word where they are the same rule, then Windows' own. */
const PROBE = String.raw`
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;

static class ModeProbe
{
    static int bad, ran;
    static void Row(bool ok, string label, string why) { ran++; if (!ok) bad++; Console.WriteLine((ok ? "PASS  " : "FAIL  ") + label.PadRight(11) + why); }
    static byte[] B(string s) { return s == null ? null : Encoding.UTF8.GetBytes(s); }
    static void Mode(byte[] bytes, KosmosLauncher.ComputerMode want, string why) { var got = KosmosLauncher.ComputerModeFromBytes(bytes); Row(got == want, got.ToString().ToLowerInvariant(), why); }
    static void Link(string s, bool clicked, KosmosLauncher.ConnectLink want, string why) { var got = KosmosLauncher.ConnectLinkDecision(s, clicked); Row(got == want, got.ToString(), why); }

    static int Main(string[] a)
    {
        if (a[0] == "rows") return Rows(a[1]);
        if (a[0] == "withmode") { Console.Write(KosmosLauncher.WithModeQuery(a[2], (KosmosLauncher.ComputerMode)Enum.Parse(typeof(KosmosLauncher.ComputerMode), a[1], true))); return 0; }
        if (a[0] == "pagemode") { Console.Write(KosmosLauncher.ModeFromPageMessage(Console.In.ReadToEnd()) ?? "null"); return 0; }
        if (a[0] == "end")
        {
            // A listener on this port, judged ours or not by the seam (a second user's board cannot be made here).
            bool ours = a[2] == "ours";
            KosmosLauncher.isKosmosBoardProcess = p => ours;
            Console.Write(KosmosLauncher.StopBoardHere(int.Parse(a[1]), null) ? "stopped" : "still");
            return 0;
        }
        return 2;
    }

    static int Rows(string scratch)
    {
        Mode(null, KosmosLauncher.ComputerMode.Unset, "no file: never chosen, behaves as today");
        Mode(B("run"), KosmosLauncher.ComputerMode.Run, "run");
        Mode(B("run\n"), KosmosLauncher.ComputerMode.Run, "run with the newline the app writes");
        Mode(B("run\n\n"), KosmosLauncher.ComputerMode.Run, "trailing newlines dropped, as the installer's $(cat) does");
        Mode(B("connect\n"), KosmosLauncher.ComputerMode.Connect, "connect");
        Mode(B("both\n"), KosmosLauncher.ComputerMode.Both, "both (runs agents, and connects to other computers)");
        Mode(B(" run"), KosmosLauncher.ComputerMode.Unreadable, "a space is not dropped (the installer would not match it either)");
        Mode(B("run\r\n"), KosmosLauncher.ComputerMode.Unreadable, "a CR is not dropped either");
        Mode(B("RUN"), KosmosLauncher.ComputerMode.Unreadable, "case matters, as in the installer");
        Mode(B(""), KosmosLauncher.ComputerMode.Unreadable, "AN EMPTY FILE ASKS AGAIN, it does not become run");
        Mode(B("unset"), KosmosLauncher.ComputerMode.Unreadable, "unset is not a stored choice");
        Mode(new byte[] { 0xff, 0xfe }, KosmosLauncher.ComputerMode.Unreadable, "bytes that are not text");
        // Windows' own: what Notepad writes, decided on purpose (CRLF asks again, as on the Mac).
        Mode(B("connect\r\n"), KosmosLauncher.ComputerMode.Unreadable, "WINDOWS: A NOTEPAD CRLF ENDING ASKS AGAIN, the Mac rule, never a guess");
        Mode(new byte[] { 0xef, 0xbb, 0xbf, 0x72, 0x75, 0x6e }, KosmosLauncher.ComputerMode.Unreadable, "WINDOWS: a byte order mark is not dropped");
        Mode(B("both\r"), KosmosLauncher.ComputerMode.Unreadable, "WINDOWS: a lone CR is not a newline");

        Link("https://login.kosmosplus.com/", false, KosmosLauncher.ConnectLink.InApp, "sign-in stays in the window");
        Link("https://login.kosmosplus.com/signin?open=josh.kosmosplus.com", false, KosmosLauncher.ConnectLink.InApp, "slice 2's open intent stays in the window");
        Link("https://josh.kosmosplus.com/#kst=abc", false, KosmosLauncher.ConnectLink.InApp, "a computer's board, after the handoff");
        Link("https://LOGIN.KosmosPlus.com/", false, KosmosLauncher.ConnectLink.InApp, "hosts are not case sensitive");
        Link("https://josh.kosmosplus.com:443/", false, KosmosLauncher.ConnectLink.InApp, "443 is the default port");
        Link("https://josh.kosmosplus.com:8443/", false, KosmosLauncher.ConnectLink.Browser, "another port is not ours");
        Link("https://a.b.kosmosplus.com/", false, KosmosLauncher.ConnectLink.Browser, "two labels deep is not a computer");
        Link("https://-x.kosmosplus.com/", false, KosmosLauncher.ConnectLink.Browser, "a label must not start with a hyphen");
        Link("https://x-.kosmosplus.com/", false, KosmosLauncher.ConnectLink.Browser, "nor end with one");
        Link("https://a_b.kosmosplus.com/", false, KosmosLauncher.ConnectLink.Browser, "an underscore is not a host label (iOS refuses it too)");
        Link("https://xn--80ak6aa92e.kosmosplus.com/", false, KosmosLauncher.ConnectLink.Browser, "a punycode lookalike goes to the browser");
        Link("https://" + new string('a', 64) + ".kosmosplus.com/", false, KosmosLauncher.ConnectLink.Browser, "a label over 63 characters is not a host");
        Link("https://kosmosplus.com.evil.example/", false, KosmosLauncher.ConnectLink.Browser, "a lookalike suffix goes to the browser");
        Link("https://user@login.kosmosplus.com/", false, KosmosLauncher.ConnectLink.Browser, "a user part is not ours");
        Link("https://stripe.com/pay", false, KosmosLauncher.ConnectLink.Browser, "any other site goes to the browser, even from a redirect");
        Link("http://127.0.0.1:16180/", false, KosmosLauncher.ConnectLink.Block, "THIS COMPUTER'S STOPPED BOARD IS NEVER LOADED by a script or redirect");
        Link("http://example.com/", true, KosmosLauncher.ConnectLink.Browser, "plain http, clicked, goes to the browser");
        Link("mailto:help@kosmosplus.com", true, KosmosLauncher.ConnectLink.Browser, "a clicked mail link opens Mail");
        Link("mailto:help@kosmosplus.com", false, KosmosLauncher.ConnectLink.Block, "a scripted mail link does not");
        Link("javascript:alert(1)", true, KosmosLauncher.ConnectLink.Block, "javascript: is refused");
        Link("file:///etc/passwd", true, KosmosLauncher.ConnectLink.Block, "file: is refused");
        Link("about:blank", false, KosmosLauncher.ConnectLink.InApp, "about:blank for the page's own use");
        // Windows' own.
        Link("https://j\u00f6sh.kosmosplus.com/", false, KosmosLauncher.ConnectLink.Browser, "WINDOWS: a non-ASCII host is not ours");
        Link("http://127.0.0.1:16180/", true, KosmosLauncher.ConnectLink.Browser, "WINDOWS: even a click on this board goes to the browser, never this window");
        Link("tel:+15555550100", true, KosmosLauncher.ConnectLink.Browser, "WINDOWS: a clicked phone link opens the phone app");
        Link("ms-settings:privacy", true, KosmosLauncher.ConnectLink.Block, "WINDOWS: an app scheme is refused, clicked or not");
        Link("about:srcdoc", false, KosmosLauncher.ConnectLink.Block, "WINDOWS: only about:blank");
        Link("data:text/html,<b>x</b>", false, KosmosLauncher.ConnectLink.Block, "WINDOWS: a data: page never replaces sign-in");

        // The file itself: a write the reader reads back, a missing file, one that cannot be read.
        string file = Path.Combine(scratch, "Kosmos\\mode");
        Row(KosmosLauncher.ReadComputerMode(file) == KosmosLauncher.ComputerMode.Unset, "disk", "no file (not even its folder) reads unset");
        Row(KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Connect, file) && KosmosLauncher.ReadComputerMode(file) == KosmosLauncher.ComputerMode.Connect, "disk", "connect written reads back connect");
        Row(File.ReadAllText(file) == "connect\n", "disk", "the bytes are the word and one LF, as the Mac writes them");
        Row(KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Run, file) && KosmosLauncher.ReadComputerMode(file) == KosmosLauncher.ComputerMode.Run, "disk", "run written over it reads back run");
        Row(KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Both, file) && KosmosLauncher.ReadComputerMode(file) == KosmosLauncher.ComputerMode.Both, "disk", "both written reads back both");
        Row(!KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Unreadable, file) && !KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Unset, file) && KosmosLauncher.ReadComputerMode(file) == KosmosLauncher.ComputerMode.Both, "disk", "only the three choices can be written, and a refused write changes nothing");
        Row(Directory.GetFiles(Path.GetDirectoryName(file)).Length == 1, "disk", "no temp file is left beside it");
        File.Delete(file);
        Directory.CreateDirectory(file);
        Row(KosmosLauncher.ReadComputerMode(file) == KosmosLauncher.ComputerMode.Unreadable, "disk", "a mode that cannot be read (a folder in its place) reads unreadable, not unset");
        Row(!KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Connect, file) && Directory.GetFiles(Path.GetDirectoryName(file)).Length == 0, "disk", "a write that cannot land says so, and leaves no temp file");
        KosmosLauncher.computerModeFile = () => file;
        Row(KosmosLauncher.LaunchComputerMode() == KosmosLauncher.ComputerMode.Run, "switch", "WITH THE SWITCH OFF every computer runs agents, whatever the file holds");

        const int expected = 53;
        if (ran != expected) { Console.WriteLine("\nmode-check: only " + ran + " of " + expected + " rows ran, so this proved nothing"); return 1; }
        if (bad > 0) { Console.WriteLine("\nmode-check: " + bad + " row(s) wrong"); return 1; }
        Console.WriteLine("\nmode-check: all good (" + ran + " rows)");
        return 0;
    }
}
`;

let probeExe = null;
let probeDir = null;
function probe(args, input) {
  const r = spawnSync(probeExe, args, { input: input || '', encoding: 'utf8', windowsHide: true });
  return r;
}

test('#4381: the probe compiles beside the launcher', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-mode-probe-'));
  fs.writeFileSync(path.join(probeDir, 'ModeProbe.cs'), PROBE);
  const out = path.join(probeDir, 'probe.exe');
  const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:ModeProbe', '/out:' + out, LAUNCHER, path.join(probeDir, 'ModeProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  probeExe = out;
});

test.after(() => { if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true }); });

const needsProbe = (t) => { if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return false; } return true; };

test('#4381: the Mac selftest\'s rows, and Windows\' own, all run and all pass (a run short of a row proves nothing)', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const r = probe(['rows', fs.mkdtempSync(path.join(probeDir, 'disk-'))]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\nmode-check: all good \(53 rows\)\s*$/, 'the probe exited 0 without its verdict: ' + r.stdout);
  assert.equal((r.stdout.match(/^PASS /gm) || []).length, 53, r.stdout);
  assert.doesNotMatch(r.stdout, /^FAIL /m, r.stdout);
  /* The Mac's rows are all here, by their words: a row dropped on one side is a rule the two no longer share. */
  const mac = fs.readFileSync(path.join(REPO, 'native-app', 'main.swift'), 'utf8');
  const selftest = mac.slice(mac.indexOf('if CommandLine.arguments.contains("--kosmos-app-mode-selftest")'), mac.indexOf('/* #3996: the Dock badge\'s number'));
  const macWhys = [...selftest.matchAll(/^\s+(?:mode|link)\([^\n]*, "([^"]+)"\)$/gm)].map((m) => m[1]);
  assert.equal(macWhys.length, 34, 'the Mac selftest\'s rows could not be read');
  for (const why of macWhys) assert.ok(r.stdout.includes(why), 'the Mac row "' + why + '" is not run on Windows');
});

test('#4381: the window opens the board with what the page must know, keeping the boot nonce', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const at = (mode, address) => probe(['withmode', mode, address]).stdout;
  assert.equal(at('unset', 'http://127.0.0.1:16180'), 'http://127.0.0.1:16180/?mode=unset');
  assert.equal(at('unset', 'http://127.0.0.1:16180/?boot=abc123'), 'http://127.0.0.1:16180/?boot=abc123&mode=unset', 'the nonce is lost');
  assert.equal(at('unreadable', 'http://127.0.0.1:16180/?boot=abc123'), 'http://127.0.0.1:16180/?boot=abc123&mode=unreadable');
  assert.equal(at('both', 'http://127.0.0.1:16180/?boot=abc123'), 'http://127.0.0.1:16180/?boot=abc123&mode=both');
  assert.equal(at('unset', 'http://127.0.0.1:16180/?boot=abc123#x'), 'http://127.0.0.1:16180/?boot=abc123&mode=unset#x');
  assert.equal(at('run', 'http://127.0.0.1:16180/?boot=abc123'), 'http://127.0.0.1:16180/?boot=abc123', 'run adds nothing');
  assert.equal(at('connect', 'http://127.0.0.1:16180/?boot=abc123'), 'http://127.0.0.1:16180/?boot=abc123');
});

test('#4381: the page\'s { kosmosMode } is read as its word, and nothing else is', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const said = (json) => probe(['pagemode'], json).stdout;
  assert.equal(said('{"kosmosMode":"connect"}'), 'connect');
  assert.equal(said('{"kosmosMode":"both"}'), 'both');
  assert.equal(said('{"kosmosMode":"run","other":1}'), 'run');
  assert.equal(said('{"kosmosBadge":3}'), 'null', 'the badge message is read as a choice');
  assert.equal(said('{"kosmosMode":3}'), 'null');
  assert.equal(said('"connect"'), 'null', 'a bare string is not the page\'s message');
  assert.equal(said('{"kosmosMode":"connect"'), 'null', 'a message cut off is read');
});

/* The connect stop against a REAL listener, with no task (taskName null, as a launch that set PORT has):
   one judged a Kosmos board of this user is ended with its tree; one that is not is left alone. */
function listener() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', "const s=require('net').createServer(()=>{});s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port)+'\\n')});setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    child.stdout.once('data', (d) => resolve({ child, port: Number(String(d).trim()) }));
    child.once('error', reject);
  });
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

test('#4381: the connect stop ends a Kosmos board of ours on the port with its tree, and leaves anybody else\'s alone', { ...WINDOWS_ONLY, timeout: 60000 }, async (t) => {
  if (!needsProbe(t)) return;
  const ours = await listener();
  try {
    assert.equal(await listening(ours.port), true, 'the control: the listener is up');
    const r = spawnSync(probeExe, ['end', String(ours.port), 'ours'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(r.stdout, 'stopped', r.stdout + r.stderr);
    await new Promise((res) => setTimeout(res, 200));
    assert.equal(alive(ours.child.pid), false, 'the board was not ended');
    assert.equal(await listening(ours.port), false, 'the port is still held');
  } finally { try { ours.child.kill(); } catch { /* ended */ } }
  const theirs = await listener();
  try {
    const r = spawnSync(probeExe, ['end', String(theirs.port), 'theirs'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(r.stdout, 'stopped', 'a listener that is not ours is not a board of ours still running: ' + r.stdout + r.stderr);
    assert.equal(alive(theirs.child.pid), true, 'somebody else\'s listener was ended');
    assert.equal(await listening(theirs.port), true);
  } finally { try { theirs.child.kill(); } catch { /* ended */ } }
  /* Nothing listening at all is a stop that held. */
  const free = await listener();
  free.child.kill();
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(spawnSync(probeExe, ['end', String(free.port), 'ours'], { encoding: 'utf8', windowsHide: true }).stdout, 'stopped');
});
