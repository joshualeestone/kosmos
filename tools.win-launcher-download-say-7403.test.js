'use strict';

/**
 * #7403 (Windows parity with the Mac's #7384, #5167): in Kosmos.exe's window, every download the window does not
 * save, and every link it refuses, says why in Kosmos's words ("Kosmos did not save that file: <why>", "Kosmos did
 * not open that link: <why>"), under the Mac's refusalShouldShow guard so a page cannot pile boxes up.
 *
 *   node --test tools.win-launcher-download-say-7403.test.js
 *
 * In two halves, as the other launcher tests do it (tools.windows-computer-mode-4381.test.js):
 *   - the SOURCE (tools/windows/KosmosLauncher.cs): the hand-declared WebView2 COM interfaces, slot by slot against
 *     WebView2.h 1.0.4191.47 (a wrong order calls a different method, silently), and the wiring nothing can call
 *     from outside (which events say what, and that a download is never cancelled or redirected);
 *   - a PROBE compiled beside the launcher (Windows only), which runs the pure decisions with controls: the Mac's
 *     refusalShouldShow rows word for word, the guard's state over time, each sentence. A run that does not reach
 *     every row is a failure, never a pass.
 * The real window was measured on the Windows box (the plan, .claude/plans/windl-say-7403.md, has the run).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
// The slots a [ComImport] interface declares, in order, by the header's name (an _unused_ placeholder is its name).
function slots(name) {
  const body = slice('public interface ' + name + '\n{', '\n}\n');
  return [...body.matchAll(/^\s+(?:\[PreserveSig\]\s+)?\w+\s+(\w+)\(/gm)].map((m) => m[1].replace(/^_unused_/, ''));
}
function guidOf(name) {
  const at = SOURCE.indexOf('public interface ' + name + '\n');
  assert.notEqual(at, -1, name + ' is not declared');
  const head = SOURCE.slice(SOURCE.lastIndexOf('[ComImport', at), at);
  return (head.match(/Guid\("([0-9a-fA-F-]+)"\)/) || [])[1].toLowerCase();
}

/* WebView2.h 1.0.4191.47 (the Microsoft.Web.WebView2 NuGet package, build/native/include), each interface's own
   methods in vtable order, with the header lines they were read from. Copied from the header, not from this file. */
const H = {
  ICoreWebView2: { lines: '3019-3218', guid: '76eceacb-0462-4d94-ac83-423a6793775e', methods: ['get_Settings', 'get_Source', 'Navigate', 'NavigateToString', 'add_NavigationStarting', 'remove_NavigationStarting', 'add_ContentLoading', 'remove_ContentLoading', 'add_SourceChanged', 'remove_SourceChanged', 'add_HistoryChanged', 'remove_HistoryChanged', 'add_NavigationCompleted', 'remove_NavigationCompleted', 'add_FrameNavigationStarting', 'remove_FrameNavigationStarting', 'add_FrameNavigationCompleted', 'remove_FrameNavigationCompleted', 'add_ScriptDialogOpening', 'remove_ScriptDialogOpening', 'add_PermissionRequested', 'remove_PermissionRequested', 'add_ProcessFailed', 'remove_ProcessFailed', 'AddScriptToExecuteOnDocumentCreated', 'RemoveScriptToExecuteOnDocumentCreated', 'ExecuteScript', 'CapturePreview', 'Reload', 'PostWebMessageAsJson', 'PostWebMessageAsString', 'add_WebMessageReceived', 'remove_WebMessageReceived', 'CallDevToolsProtocolMethod', 'get_BrowserProcessId', 'get_CanGoBack', 'get_CanGoForward', 'GoBack', 'GoForward', 'GetDevToolsProtocolEventReceiver', 'Stop', 'add_NewWindowRequested', 'remove_NewWindowRequested', 'add_DocumentTitleChanged', 'remove_DocumentTitleChanged', 'get_DocumentTitle', 'AddHostObjectToScript', 'RemoveHostObjectFromScript', 'OpenDevToolsWindow', 'add_ContainsFullScreenElementChanged', 'remove_ContainsFullScreenElementChanged', 'get_ContainsFullScreenElement', 'add_WebResourceRequested', 'remove_WebResourceRequested', 'AddWebResourceRequestedFilter', 'RemoveWebResourceRequestedFilter', 'add_WindowCloseRequested', 'remove_WindowCloseRequested'] },
  ICoreWebView2_2: { lines: '5318-5345', methods: ['add_WebResourceResponseReceived', 'remove_WebResourceResponseReceived', 'NavigateWithWebResourceRequest', 'add_DOMContentLoaded', 'remove_DOMContentLoaded', 'get_CookieManager', 'get_Environment'] },
  ICoreWebView2_3: { lines: '6130-6150', methods: ['TrySuspend', 'Resume', 'get_IsSuspended', 'SetVirtualHostNameToFolderMapping', 'ClearVirtualHostNameToFolderMapping'] },
  ICoreWebView2_4: { lines: '6891-6909', guid: '20d02d59-6df2-42dc-bd06-f98a694b1302', methods: ['add_FrameCreated', 'remove_FrameCreated', 'add_DownloadStarting', 'remove_DownloadStarting'] },
  ICoreWebView2DownloadStartingEventHandler: { lines: '7599-7607', guid: 'efedc989-c396-41ca-83f7-07f845a55724', methods: ['Invoke'] },
  ICoreWebView2DownloadOperation: { lines: '43345-43406', guid: '3d6b6cf2-afe1-44c7-a995-c65117714336', methods: ['add_BytesReceivedChanged', 'remove_BytesReceivedChanged', 'add_EstimatedEndTimeChanged', 'remove_EstimatedEndTimeChanged', 'add_StateChanged', 'remove_StateChanged', 'get_Uri', 'get_ContentDisposition', 'get_MimeType', 'get_TotalBytesToReceive', 'get_BytesReceived', 'get_EstimatedEndTime', 'get_ResultFilePath', 'get_State', 'get_InterruptReason', 'Cancel', 'Pause', 'Resume', 'get_CanResume'] },
  ICoreWebView2StateChangedEventHandler: { lines: '43799-43807', guid: '81336594-7ede-4ba9-bf71-acf0a95b58dd', methods: ['Invoke'] },
  ICoreWebView2DownloadStartingEventArgs: { lines: '43885-43913', guid: 'e99bbe21-43e9-4544-a732-282764eafa60', methods: ['get_DownloadOperation', 'get_Cancel', 'put_Cancel', 'get_ResultFilePath', 'put_ResultFilePath', 'get_Handled', 'put_Handled', 'GetDeferral'] },
  ICoreWebView2NavigationCompletedEventArgs: { lines: '54616-54629', methods: ['get_IsSuccess', 'get_WebErrorStatus', 'get_NavigationId'] },
  ICoreWebView2NavigationCompletedEventArgs2: { lines: '54722-54729', guid: 'fdf8b738-ee1e-4db2-a329-8d7d7b74d792', methods: ['get_HttpStatusCode'] },
};
// A declaration runs from the header's first slot to the last one this file calls: a PREFIX of the header's order.
function assertPrefix(name, expected) {
  const got = slots(name);
  assert.ok(got.length > 0 && got.length <= expected.length, name + ' declares ' + got.length + ' slots, the header has ' + expected.length);
  assert.deepEqual(got, expected.slice(0, got.length), name + ': a slot is out of the header\'s order (WebView2.h)');
}

test('#7403: the instrument is reading the launcher', () => {
  assert.ok(SOURCE.length > 100000, 'KosmosLauncher.cs read back only ' + SOURCE.length + ' bytes');
  // NEGATIVE CONTROL for slots(): it must see the existing ICoreWebView2's slots, or every order check below is empty.
  assert.deepEqual(slots('ICoreWebView2').slice(0, 3), ['get_Settings', 'get_Source', 'Navigate']);
});

test('#7403: ICoreWebView2_4 restates ICoreWebView2, _2 and _3 slot for slot, then its own, in WebView2.h order', () => {
  const all = [...H.ICoreWebView2.methods, ...H.ICoreWebView2_2.methods, ...H.ICoreWebView2_3.methods, ...H.ICoreWebView2_4.methods];
  assert.equal(H.ICoreWebView2.methods.length + H.ICoreWebView2_2.methods.length + H.ICoreWebView2_3.methods.length, 70);
  const got = slots('ICoreWebView2_4');
  assert.equal(got.length, 73, 'ICoreWebView2_4 must reach add_DownloadStarting, slot 73 after IUnknown');
  assert.deepEqual(got, all.slice(0, 73));
  assert.equal(got[72], 'add_DownloadStarting');
  assert.equal(guidOf('ICoreWebView2_4'), H.ICoreWebView2_4.guid);
  // CONTROL: the order check catches a swap (two neighbours exchanged is the classic slip).
  const swapped = all.slice(0, 73); [swapped[5], swapped[6]] = [swapped[6], swapped[5]];
  assert.notDeepEqual(got, swapped);
});

test('#7403: every new interface is a prefix of the header\'s order, under the header\'s GUID', () => {
  for (const name of ['ICoreWebView2DownloadStartingEventHandler', 'ICoreWebView2DownloadOperation', 'ICoreWebView2StateChangedEventHandler', 'ICoreWebView2DownloadStartingEventArgs']) {
    assertPrefix(name, H[name].methods);
    assert.equal(guidOf(name), H[name].guid, name + ' GUID');
  }
  assert.deepEqual(slots('ICoreWebView2NavigationCompletedEventArgs2'), [...H.ICoreWebView2NavigationCompletedEventArgs.methods, ...H.ICoreWebView2NavigationCompletedEventArgs2.methods],
    'the second args interface restates the first\'s three, then get_HttpStatusCode');
  assert.equal(guidOf('ICoreWebView2NavigationCompletedEventArgs2'), H.ICoreWebView2NavigationCompletedEventArgs2.guid);
  // The existing declarations these build on still agree with the header too.
  assertPrefix('ICoreWebView2', H.ICoreWebView2.methods);
  assertPrefix('ICoreWebView2NavigationCompletedEventArgs', H.ICoreWebView2NavigationCompletedEventArgs.methods);
  assert.match(slice('public interface ICoreWebView2DownloadOperation', '\n}\n'), /void get_State\(out int downloadState\);\n\s+void get_InterruptReason\(out int interruptReason\);/);
  assert.match(slice('public interface ICoreWebView2StateChangedEventHandler', '\n}\n'), /Invoke\(ICoreWebView2DownloadOperation sender, \[MarshalAs\(UnmanagedType\.IUnknown\)\] object args\)/);
});

test('#7403: a download goes exactly as before: the handler only watches, never cancels, handles or redirects', () => {
  const start = method('internal void OnDownloadStarting(');
  assert.doesNotMatch(start, /put_Cancel|put_Handled|put_ResultFilePath|GetDeferral|\.Cancel\(/);
  assert.match(start, /add_StateChanged\(new DownloadStateChanged\(this\), out token\)/);
  assert.doesNotMatch(slice('public interface ICoreWebView2DownloadStartingEventArgs', '\n}\n'), /put_/, 'nothing that could change a download is even declared');
  const ready = method('internal void ControllerReady(');
  assert.match(ready, /webView as ICoreWebView2_4/, 'reached by a QueryInterface, never assumed');
  assert.match(ready, /try\s*\{\s*ICoreWebView2_4 webView4[^}]*add_DownloadStarting\(new DownloadStarting\(this\), out token\);\s*\}\s*catch/, 'a failure to register must not stop the board loading');
  assert.ok(ready.indexOf('add_DownloadStarting') < ready.indexOf('NavigateToBoard()'), 'registered before the first load');
  const changed = method('internal void OnDownloadStateChanged(');
  assert.match(changed, /KosmosLauncher\.DownloadInterruptedSays\(reason\)/);
  assert.match(changed, /TellRefusal\(says\)/);
  // Review 1 (nit 3): a pause is INTERRUPTED with USER_PAUSED, and no list of handlers is kept that a pause could
  // leave wrong (WebView2 holds each handler while its download can raise it).
  assert.match(changed, /A pause arrives as INTERRUPTED with USER_PAUSED/);
  assert.doesNotMatch(SOURCE, /downloadsWatched/);
});

test('#7403: a refused link says why, on both refusal paths, but not twice for a connect computer\'s first load', () => {
  const nav = method('internal void OnNavigationStarting(');
  assert.match(nav, /else if \(decided == KosmosLauncher\.ConnectLink\.Block && !refusedFirstLoad\) TellRefusal\(KosmosLauncher\.LinkBlockedSays\(uri\)\);/);
  const popup = method('internal void OnNewWindowRequested(');
  assert.match(popup, /else TellRefusal\(KosmosLauncher\.LinkBlockedSays\(uri\)\);/);
});

test('#7403: a board 204 to a navigation is said only after the window has seen no download come of it', () => {
  const done = method('internal void OnNavigationCompleted(');
  assert.match(done, /KosmosLauncher\.NoContentNavigationSays\(false, webError, httpStatus, toBoard, address\)/);
  assert.match(done, /SayUnlessADownloadStarted\(address, refused, boardNav\);\s*boardNav = false;/, 'decided in one place, with whether it was this computer\'s board');
  assert.ok(done.indexOf('SayUnlessADownloadStarted') < done.indexOf('if (boardNav && success == 0)'), 'decided before the failed-load handling');
  const settle = method('internal void SayUnlessADownloadStarted(');
  // Review 1 (warning 1): any download in the window counts, not only one whose address text matches.
  assert.match(settle, /KosmosLauncher\.AnyDownloadCameOfNavigation\(downloadStarts, endedAt, KosmosLauncher\.DownloadSettleMs\)/);
  assert.doesNotMatch(settle, /TryGetValue\(address/);
  // Review 1 (warning 2): the board is checked first, off the window's thread; one that does not prove goes to the
  // existing not-confirmed check, never to a sentence blaming the file.
  const tick = settle.slice(settle.indexOf('if (!checkBoard)'));
  assert.match(tick, /ThreadPool\.QueueUserWorkItem\(unused =>\s*\{\s*KosmosLauncher\.ReuseCheck check = KosmosLauncher\.CheckBoardBeforeReuse\(boardPort, KosmosLauncher\.ReuseQuickCheckMs\);/);
  assert.match(tick, /if \(KosmosLauncher\.NoContentRefusalStands\(check\)\) TellRefusal\(sentence\);\s*else\s*\{[^}]*CheckThenShowNotConfirmed\(KosmosLauncher\.MayNavigateSignedIn\);/);
  assert.match(tick, /if \(visit != boardVisit\) return;/, 'an answer after the window moved on is dropped');
  // Review 1 (nit 4): pruned as each download is added.
  assert.match(method('internal void OnDownloadStarting('), /KosmosLauncher\.PruneDownloadStarts\(downloadStarts, now\);\s*downloadStarts\.Add\(now\);/);
});

test('#7403: one box at a time, modal to the window, from its own thread, every refusal logged first', () => {
  const tell = method('internal void TellRefusal(');
  assert.ok(tell.indexOf('NoteRefusal(sentence)') < tell.indexOf('refusals.Ask('), 'logged before the guard decides, so a refusal kept off screen is still logged');
  assert.match(tell, /BeginInvoke\(new Action\(/);
  assert.match(tell, /MessageBox\.Show\(this, sentence,/, 'owned by the window: modal to it');
  assert.match(tell, /finally \{ refusals\.Answered\(/, 'the guard counts the box down whatever happens');
  assert.match(tell, /catch \{ refusals\.Answered\(/, 'a box that could not be queued is never left counted as up');
  assert.match(method('internal void OnContentLoading('), /\)\s*\{\s*pageCommits\+\+;/,'every commit is a page, before the mode check returns');
});

test('#7403: no em dash in anything the window says', () => {
  const said = slice('// ---- #7403 (Windows parity', 'internal static void NoteRefusal(');
  assert.doesNotMatch(said, /\u2014/);
});

/* ---- the probe ---------------------------------------------------------- */

const PROBE = String.raw`
using System;

static class DlProbe
{
    static int bad, ran;
    static void Row(bool ok, string label, string why) { ran++; if (!ok) bad++; Console.WriteLine((ok ? "PASS  " : "FAIL  ") + label.PadRight(11) + why); }
    // The Mac's shows(): now 1_000_000 s, window 10 s, two per page; lastAgo in seconds.
    static void Shows(bool up, bool asking, double? lastAgo, int page, bool want, string why)
    {
        long now = 1000000000;
        bool got = KosmosLauncher.RefusalShouldShow(up, asking, lastAgo.HasValue ? (long?)(now - (long)(lastAgo.Value * 1000)) : null, now, 10000, page, 2);
        Row(got == want, got ? "shown" : "logged", why);
    }
    static void Says(int reason, string wantPart, string why)
    {
        string got = KosmosLauncher.DownloadInterruptedSays(reason);
        bool ok = wantPart == null ? got == null : (got != null && got.StartsWith("Kosmos did not save that file: ") && got.Contains(wantPart) && got.IndexOf('\u2014') < 0);
        Row(ok, "reason " + reason, why + " (said: " + (got ?? "nothing") + ")");
    }
    static void Link(string address, string wantPart, string why)
    {
        string got = KosmosLauncher.LinkBlockedSays(address);
        Row(got.StartsWith("Kosmos did not open that link: ") && got.Contains(wantPart) && got.IndexOf('\u2014') < 0, "link", why + " (said: " + got + ")");
    }
    static void NoContent(bool success, int web, int http, bool toBoard, string address, bool want, string why)
    {
        bool got = KosmosLauncher.NoContentNavigationSays(success, web, http, toBoard, address) != null;
        Row(got == want, got ? "said" : "nothing", why);
    }

    static int Main(string[] a)
    {
        // The Mac's selftest rows (main.swift, refusalShouldShow), word for word.
        Shows(false, false, null, 0, true, "A REFUSAL IS SAID ON SCREEN (an outside report: a logged-only refusal reads as nothing happening)");
        Shows(true, false, null, 0, false, "not while another download alert is on screen (a repeating page cannot pile them up)");
        Shows(false, true, null, 0, false, "not while the Allow question is up (a Return meant for one must not answer the other)");
        Shows(true, true, null, 0, false, "not while both are up");
        Shows(false, false, 3, 0, false, "ANY refusal within the window after the last OK is logged only (review 1: two alternating sentences trapped the person)");
        Shows(true, false, 3, 0, false, "not while an alert is up, inside the window too");
        Shows(false, false, 10, 0, true, "CONTROL: once the window has passed, a refusal is said again");
        Shows(false, false, null, 2, false, "AT MOST TWO OF ONE SENTENCE ON ONE PAGE (review 2: a page retrying on a timer put one up every window)");
        Shows(false, false, null, 1, true, "CONTROL: the second of a sentence on a page is said");
        Row(KosmosLauncher.RefusalRepeatMs == 10000 && KosmosLauncher.RefusalsPerPage == 2, "consts", "WINDOWS: the Mac's ten seconds and two per page");

        // The guard's state over time (RefusalGate), as the window drives it.
        var g = new KosmosLauncher.RefusalGate();
        Row(g.Ask("A", 0, 1), "gate", "WINDOWS: the first refusal on a page is shown");
        Row(!g.Ask("B", 100, 1), "gate", "WINDOWS: a second one while the first box is up (not yet answered) is not");
        g.Answered(5000);
        Row(g.Up == 0, "gate", "WINDOWS: an OK counts the box down");
        Row(!g.Ask("B", 9999, 1), "gate", "WINDOWS: ANY sentence inside ten seconds of the OK is not shown");
        Row(g.Ask("B", 15000, 1), "gate", "WINDOWS CONTROL: another sentence ten seconds after the OK is");
        g.Answered(15000);
        Row(g.Ask("A", 25000, 1), "gate", "WINDOWS CONTROL: the second of one sentence on a page is shown");
        g.Answered(25000);
        Row(!g.Ask("A", 40000, 1), "gate", "WINDOWS: the third of one sentence on one page is not");
        Row(g.Ask("A", 40000, 2), "gate", "WINDOWS CONTROL: on the next page it is shown again");
        g.Answered(40000); g.Answered(40001);
        Row(g.Up == 0, "gate", "WINDOWS: an extra Answered never counts below zero (a stuck count would silence every later box)");

        // Every interrupted download says why, except the ones the person chose.
        Says(26, null, "WINDOWS: the person cancelled it in the Downloads panel: nothing to say");
        Says(27, null, "WINDOWS: the person closed Kosmos: nothing to say");
        Says(28, null, "WINDOWS: the person paused it: nothing to say");
        Says(0, null, "WINDOWS: NONE is not an interruption");
        Says(19, "not there", "WINDOWS: a board 404 (Chromium's No file, measured as case 2a) says the file is not there");
        Says(22, "refused to send it", "WINDOWS: a 403 says it was refused");
        Says(25, "somewhere Kosmos does not save from", "WINDOWS: a redirect to another origin, in the Mac's words");
        Says(3, "space", "WINDOWS: a full disk says so");
        Says(12, "connection dropped", "WINDOWS: a dropped connection says so");
        Says(6, "harmful", "WINDOWS: Windows security says so");
        Says(99, "stopped before it finished", "WINDOWS: a reason this file does not know is still said, generically");
        bool every = true;
        for (int r = 1; r <= 29; r++) { if (r >= 26 && r <= 28) continue; string s = KosmosLauncher.DownloadInterruptedSays(r); if (s == null || !s.StartsWith("Kosmos did not save that file: ")) every = false; }
        Row(every, "1..29", "WINDOWS: EVERY reason the person did not choose is said (WebView2.h 2524-2556)");

        Link("https://example.com/file.zip", "example.com on its own", "WINDOWS: an unclicked foreign link (case 3) names the site and why");
        Link("https://xn--80ak6aa92e.kosmosplus.com/", "xn--80ak6aa92e.kosmosplus.com", "WINDOWS: a lookalike host is named in punycode, as it really is");
        Link("https://\u0430pple.com/", "xn--", "WINDOWS: a non-ASCII host is named in punycode, never as the lookalike");
        Link("https://" + new string('a', 200) + ".com/", "...", "WINDOWS: a very long host is cut short");
        Link("mailto:help@kosmosplus.com", "mail, phone or text link", "WINDOWS: an unclicked mail link");
        Link("file:///C:/Windows/win.ini", "that kind of link", "WINDOWS: another scheme");
        Link("not a link", "not an address", "WINDOWS: an address that does not parse");

        NoContent(false, 9, 0, true, "http://127.0.0.1:16180/api/agent/a/files/download?name=x.txt", true, "WINDOWS: a refused agent file by navigation (measured: CONNECTION_ABORTED, status 0) is said");
        NoContent(false, 9, 0, true, "http://127.0.0.1:16180/api/agent/a/files/download-folder?path=x", true, "WINDOWS: a refused folder zip too");
        NoContent(false, 0, 204, true, "http://127.0.0.1:16180/api/project/p1/file-download?name=x", true, "WINDOWS: a refused project file, reported as 204 by a Runtime that does");
        NoContent(true, 0, 200, true, "http://127.0.0.1:16180/api/agent/a/files/download?name=x.txt", false, "WINDOWS CONTROL: a navigation that succeeded is not");
        NoContent(false, 9, 0, false, "https://example.com/api/agent/a/files/download", false, "WINDOWS CONTROL: not the board: nothing");
        NoContent(false, 9, 0, true, "http://127.0.0.1:16180/", false, "WINDOWS CONTROL: a board page that is not a download route: nothing (that is a load failure, handled as before)");
        NoContent(false, 14, 0, true, "http://127.0.0.1:16180/api/agent/a/files/download?name=x", false, "WINDOWS CONTROL: a navigation the window itself cancelled (OPERATION_CANCELED) is not a refusal");
        NoContent(false, 9, 0, true, "http://127.0.0.1:16180/api/agent/a/files/open", false, "WINDOWS CONTROL: another files verb is not a download route");
        NoContent(false, 9, 0, true, "http://127.0.0.1:16180/api/agent/a/b/files/download", false, "WINDOWS CONTROL: a deeper path is not the route");

        Row(KosmosLauncher.DownloadCameOfNavigation(1016, 1000, 1500), "settle", "WINDOWS: a download that starts just after its navigation ends (measured: 16 ms) came of it");
        Row(KosmosLauncher.DownloadCameOfNavigation(500, 1000, 1500), "settle", "WINDOWS: one a moment before it, too");
        Row(!KosmosLauncher.DownloadCameOfNavigation(1000, 70000, 1500), "settle", "WINDOWS CONTROL: a download of the same file a minute earlier does not hide a refusal now");
        Row(!KosmosLauncher.DownloadCameOfNavigation(4000, 1000, 1500), "settle", "WINDOWS CONTROL: nor one after the wait is over");

        // Review 1 (warning 1): ANY download that started in the window counts, whatever its address.
        var starts = new System.Collections.Generic.List<long> { 1016 };
        Row(KosmosLauncher.AnyDownloadCameOfNavigation(starts, 1000, 1500), "any", "REVIEW 1: a download started with the navigation counts whatever its address (a redirect, another encoding): no refusal said for a saved file");
        Row(!KosmosLauncher.AnyDownloadCameOfNavigation(new System.Collections.Generic.List<long>(), 1000, 1500), "any", "REVIEW 1 CONTROL: no download at all: the refusal is said");
        Row(!KosmosLauncher.AnyDownloadCameOfNavigation(new System.Collections.Generic.List<long> { 100, 9000 }, 5000, 1500), "any", "REVIEW 1 CONTROL: downloads well before or after the window do not hide it");
        Row(KosmosLauncher.AnyDownloadCameOfNavigation(new System.Collections.Generic.List<long> { 100, 5200, 9000 }, 5000, 1500), "any", "REVIEW 1: one inside the window among others counts");
        // Review 1 (nit 4): pruning keeps exactly what a running wait could still ask about.
        var kept = new System.Collections.Generic.List<long> { 0, 6499, 6500, 9000 };
        KosmosLauncher.PruneDownloadStarts(kept, 10000);
        Row(kept.Count == 2 && kept[0] == 6500 && kept[1] == 9000, "prune", "REVIEW 1: starts older than 3.5 s are dropped, the boundary and newer kept (kept " + string.Join(",", kept) + ")");
        Row(KosmosLauncher.DownloadStartsKeptMs == KosmosLauncher.DownloadBeforeNavigationEndMs + KosmosLauncher.DownloadSettleMs, "prune", "REVIEW 1: what is kept covers the latest a wait can look back (2 s before an end 1.5 s ago)");
        // Review 1 (warning 2): the refusal is said only once the board is known to have answered.
        Row(KosmosLauncher.NoContentRefusalStands(KosmosLauncher.ReuseCheck.Proved), "board", "REVIEW 1: a board that proves answered: the refusal is said");
        Row(KosmosLauncher.NoContentRefusalStands(KosmosLauncher.ReuseCheck.NotEnforcing), "board", "REVIEW 1: a board that does not enforce sign-in, as the window's own rule for staying");
        Row(!KosmosLauncher.NoContentRefusalStands(KosmosLauncher.ReuseCheck.NoListener), "board", "REVIEW 1: nothing listening (the board died): no refusal, the not-confirmed check instead");
        Row(!KosmosLauncher.NoContentRefusalStands(KosmosLauncher.ReuseCheck.NoAnswer), "board", "REVIEW 1: no answer in time: no refusal");
        Row(!KosmosLauncher.NoContentRefusalStands(KosmosLauncher.ReuseCheck.NotProven), "board", "REVIEW 1: something that is not this board: no refusal");
        Row(!KosmosLauncher.NoContentRefusalStands(KosmosLauncher.ReuseCheck.TokenUnreadable), "board", "REVIEW 1: a token that cannot be read: no refusal");

        const int expected = 63;
        if (ran != expected) { Console.WriteLine("\ndl-check: only " + ran + " of " + expected + " rows ran, so this proved nothing"); return 1; }
        if (bad > 0) { Console.WriteLine("\ndl-check: " + bad + " row(s) wrong"); return 1; }
        Console.WriteLine("\ndl-check: all good (" + ran + " rows)");
        return 0;
    }
}
`;

let probeDir = null;
test.after(() => { if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true }); });

test('#7403: the probe compiles beside the launcher, and every row runs and passes', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dl-probe-'));
  fs.writeFileSync(path.join(probeDir, 'DlProbe.cs'), PROBE);
  const out = path.join(probeDir, 'probe.exe');
  const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:DlProbe', '/out:' + out, LAUNCHER, path.join(probeDir, 'DlProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  const r = spawnSync(out, [], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\ndl-check: all good \(63 rows\)\s*$/, 'the probe exited 0 without its verdict: ' + r.stdout);
  assert.equal((r.stdout.match(/^PASS /gm) || []).length, 63, r.stdout);
  assert.doesNotMatch(r.stdout, /^FAIL /m, r.stdout);
  /* The Mac's refusalShouldShow rows are all here, by their words: a row dropped on one side is a rule the two no
     longer share. */
  const mac = fs.readFileSync(path.join(REPO, 'native-app', 'main.swift'), 'utf8');
  const macWhys = [...mac.matchAll(/^\s+shows\([^\n]*, "([^"]+)"\)$/gm)].map((m) => m[1]);
  assert.equal(macWhys.length, 9, 'the Mac selftest\'s refusalShouldShow rows could not be read');
  for (const why of macWhys) assert.ok(r.stdout.includes(why), 'the Mac row "' + why + '" is not run on Windows');
});
