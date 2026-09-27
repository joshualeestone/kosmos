'use strict';

/**
 * #3996, the Windows half: the waiting count on Kosmos's taskbar button.
 *
 *   node --test tools.win-taskbar-badge-3996.test.js
 *
 * The number is the board's (engine/status.js waitingTotal, served as counts.waiting on /api/status,
 * tested in engine/status.waiting-3996.test.js and server.test.js). The Windows app only shows it:
 * the window (Kosmos.exe --window, tools/windows/KosmosLauncher.cs) hears it from the page
 * (chrome.webview.postMessage in web/index.html tick()) and, when the page has gone quiet, reads
 * /api/status itself with the board token, then sets ITaskbarList3's overlay icon on its button.
 *
 * Two halves, as tools.win-launcher-native.test.js does it:
 *   - the SOURCE, for the wiring nothing can call from outside (the timer, the page gate, the
 *     three-miss rule, the COM slot order, the icon's lifetime, the page's post);
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only), which drives the pure parts: what
 *     reads as a count, a status, a page message; the label and the screen-reader words; the data
 *     folder the token is read from, compared with engine/store.js dataRootFor itself; and the drawn
 *     icon's pixels.
 * The overlay on a real taskbar was proven by hand on the Windows box (screenshots on the PR).
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
const PAGE = fs.readFileSync(path.join(REPO, 'web', 'index.html'), 'utf8');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe needs the Windows C# compiler' };

function slice(start, end) {
  const at = SOURCE.indexOf(start);
  assert.notEqual(at, -1, start + ' is gone from KosmosLauncher.cs');
  const to = SOURCE.indexOf(end, at + start.length);
  assert.notEqual(to, -1, 'the end of ' + start + ' is gone');
  return SOURCE.slice(at, to);
}
function method(signature) { return slice(signature, '\n    }\n'); }

test('#3996: the instrument is reading the launcher and the page', () => {
  assert.ok(SOURCE.length > 100000, 'KosmosLauncher.cs read back only ' + SOURCE.length + ' bytes');
  assert.ok(PAGE.length > 1000000, 'web/index.html read back only ' + PAGE.length + ' bytes');
});

test('#3996: the page hands the window its count on every poll, as { kosmosBadge: n }, after the counts are read', () => {
  const tickAt = PAGE.indexOf('async function tick(');
  assert.notEqual(tickAt, -1, 'tick() moved');
  const tick = PAGE.slice(tickAt, PAGE.indexOf('\n}\n', tickAt));
  const counts = tick.indexOf('const c = data.counts');
  const post = tick.indexOf("if (wv) wv.postMessage({ kosmosBadge: typeof c.waiting === 'number' ? c.waiting : null });");
  assert.ok(counts !== -1 && post > counts, 'the page does not hand the count to the Windows window inside tick(), after the counts are read');
  assert.match(tick, /const wv = window\.chrome && window\.chrome\.webview;/, 'the post is not limited to the WebView2 window');
  assert.match(SOURCE, /internal const string PageMessageKey = "kosmosBadge";/, 'the page and the window disagree on the message key');
});

test('#3996: only the board\'s own page is heard, and a page post stands in for the window\'s own read', () => {
  assert.match(SOURCE, /webView\.add_WebMessageReceived\(new WebMessageReceived\(this\), out token\);/, 'the window never listens for the page');
  const heard = method('internal void OnWebMessage(ICoreWebView2WebMessageReceivedEventArgs args)');
  assert.match(heard, /if \(!KosmosLauncher\.IsBoardAddress\(source, port\)\) return;/, 'another site in the window could set the badge');
  assert.match(heard, /if \(!TaskbarBadge\.ReadsAsPageMessage\(json, out waiting\)\) return;/);
  assert.match(heard, /pageSaidWaiting\.Restart\(\);/);
  assert.match(heard, /badgeMisses = 0;/, 'misses from before a page stretch add up to a later "three in a row"');
  assert.match(heard, /ShowBadge\(waiting, \+\+badgeAsked\);/);
});

test('#3996: the window reads /api/status itself only when the page has gone quiet, on its own 10 s timer', () => {
  assert.match(SOURCE, /internal const int PollEveryMs = 10000;/);
  assert.match(SOURCE, /internal const int PageSilentMs = 8000;/, 'the page gate must sit above the page\'s 5 s poll and below the 10 s tick');
  assert.match(SOURCE, /internal const int MissesBeforeClear = 3;/);
  const start = method('void StartBadge()');
  assert.match(start, /badgeTimer\.Interval = TaskbarBadge\.PollEveryMs;/);
  assert.match(start, /badgeTimer\.Start\(\);\n\s+RefreshBadge\(\);/, 'no first read before the first tick');
  assert.match(slice('protected override void OnLoad(EventArgs e)', 'try'), /StartBadge\(\);/, 'the badge never starts');
  const refresh = method('void RefreshBadge()');
  assert.match(refresh, /if \(pageSaidWaiting\.IsRunning && pageSaidWaiting\.ElapsedMilliseconds < TaskbarBadge\.PageSilentMs\) return;/,
    'the window polls the heaviest route even while the page is handing it the count');
  assert.match(refresh, /if \(badgeReadInFlight\) return;/, 'a slow board piles up reads');
  assert.match(refresh, /ThreadPool\.QueueUserWorkItem/, 'the read blocks the window');
  const answered = method('void BoardAnswered(bool answered, int? waiting, int asked)');
  assert.match(answered, /if \(answered \|\| badgeMisses >= TaskbarBadge\.MissesBeforeClear\) ShowBadge\(answered \? waiting : null, asked\);/, 'one slow answer blanks the badge');
  const show = method('void ShowBadge(int? waiting, int asked)');
  assert.match(show, /if \(asked < badgeShownAsked\) return;/, 'an older answer can overwrite a newer one');
  const closed = method('protected override void OnFormClosed(System.Windows.Forms.FormClosedEventArgs e)');
  assert.match(closed, /badgeTimer\.Stop\(\); badgeTimer\.Dispose\(\);/, 'the timer outlives the window');
});

test('#3996: the read carries the board token from the board\'s own data folder, and never the system proxy', () => {
  const read = method('internal static bool ReadBoard(int port, out int? waiting)');
  assert.match(read, /"http:\/\/127\.0\.0\.1:" \+ port \+ "\/api\/status"/);
  assert.match(read, /request\.Proxy = null;/);
  assert.match(read, /if \(token != null\) request\.Headers\[BoardTokenHeader\] = token;/, 'an enforcing board refuses a read without its token');
  assert.match(read, /return ReadsAsStatus\(body, out waiting\);/, 'a 200 that does not read as the status counts as an answer');
  const auth = fs.readFileSync(path.join(REPO, 'engine', 'boardauth.js'), 'utf8');
  const file = auth.match(/const TOKEN_FILE = '([^']+)';/);
  const header = auth.match(/const HEADER_NAME = '([^']+)';/);
  assert.ok(file && header, 'engine/boardauth.js no longer names its token file and header');
  assert.match(SOURCE, new RegExp('internal const string BoardTokenFileName = "' + file[1].replace('.', '\\.') + '";'));
  assert.match(SOURCE, new RegExp('internal const string BoardTokenHeader = "' + header[1] + '";'));
  const store = require('./engine/store.js');
  assert.match(SOURCE, new RegExp('internal const string StoreLeaf = "' + store.APP + '";'), 'the data folder\'s leaf drifted from engine/store.js APP');
});

/* shobjidl_core.h: ITaskbarList (HrInit, AddTab, DeleteTab, ActivateTab, SetActiveAlt), ITaskbarList2
   (MarkFullscreenWindow), then ITaskbarList3 in order up to SetOverlayIcon. COM calls by slot, so a
   line out of place calls another method with no compile error. */
const TASKBAR_SLOTS = ['HrInit', 'AddTab', 'DeleteTab', 'ActivateTab', 'SetActiveAlt', 'MarkFullscreenWindow',
  'SetProgressValue', 'SetProgressState', 'RegisterTab', 'UnregisterTab', 'SetTabOrder', 'SetTabActive',
  'ThumbBarAddButtons', 'ThumbBarUpdateButtons', 'ThumbBarSetImageList', 'SetOverlayIcon'];

test('#3996: ITaskbarList3 is declared with shobjidl\'s ids and slot order', () => {
  assert.match(SOURCE, /\[ComImport, Guid\("56FDF344-FD6D-11d0-958A-006097C9A090"\)\]\n\s+internal class TaskbarListObject \{ \}/, 'CLSID_TaskbarList');
  const m = SOURCE.match(/\[ComImport, InterfaceType\(ComInterfaceType\.InterfaceIsIUnknown\), Guid\("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"\)\]\n\s+internal interface ITaskbarList3\n\s+\{\n([\s\S]*?)\n\s+\}/);
  assert.ok(m, 'IID_ITaskbarList3 is not declared as expected');
  const slots = m[1].split('\n').map((line) => line.match(/^\s+void (?:_unused_)?(\w+)\(/)).filter(Boolean).map((x) => x[1]);
  assert.deepEqual(slots, TASKBAR_SLOTS, 'ITaskbarList3\'s methods are not in shobjidl\'s order');
});

test('#3996: the overlay waits for the taskbar button, is set only on a change, and every drawn icon is destroyed', () => {
  assert.match(SOURCE, /taskbarButtonCreatedMessage = KosmosLauncher\.RegisterWindowMessage\("TaskbarButtonCreated"\);/);
  const proc = method('protected override void WndProc(ref System.Windows.Forms.Message m)');
  assert.match(proc, /\(uint\)m\.Msg == taskbarButtonCreatedMessage\)\n\s+\{\n\s+taskbarButtonReady = true;\n\s+badgeEverApplied = false;[^\n]*\n\s+ApplyBadge\(\);/,
    'an Explorer restart leaves the new button without its badge');
  const apply = method('void ApplyBadge()');
  assert.match(apply, /if \(!taskbarButtonReady \|\| IsDisposed\) return;/, 'the overlay is set before the button exists, and lost');
  assert.match(apply, /if \(badgeEverApplied && count == badgeOnTaskbar\) return;/, 'the icon is redrawn on every poll');
  assert.match(apply, /taskbar\.HrInit\(\);/, 'ITaskbarList3 is used without HrInit');
  assert.match(apply, /taskbar\.SetOverlayIcon\(Handle, icon, TaskbarBadge\.Description\(count\)\);/);
  assert.match(apply, /finally \{ if \(icon != IntPtr\.Zero\) TaskbarBadge\.DestroyIcon\(icon\); \}/, 'a drawn HICON leaks');
});

/* ---- the probe ---------------------------------------------------------- */

const PROBE = `
using System;
using System.IO;
class BadgeProbe {
  static string Show(int? n) { return n.HasValue ? n.Value.ToString() : "null"; }
  static int? Arg(string s) { return s == "null" ? (int?)null : int.Parse(s); }
  static int Main(string[] a) {
    string input = Console.In.ReadToEnd();
    int? w;
    switch (a[0]) {
      case "label": Console.Write(TaskbarBadge.Label(Arg(a[1])) ?? "null"); break;
      case "desc": Console.Write(TaskbarBadge.Description(Arg(a[1]))); break;
      case "count": Console.Write(Show(TaskbarBadge.CountFromJsonValue(input))); break;
      case "status": Console.Write(TaskbarBadge.ReadsAsStatus(input, out w) + ":" + Show(w)); break;
      case "page": Console.Write(TaskbarBadge.ReadsAsPageMessage(input, out w) + ":" + Show(w)); break;
      case "root": Console.Write(TaskbarBadge.BoardDataRoot(Environment.GetEnvironmentVariable, a[1])); break;
      case "icon": {
        int size = int.Parse(a[2]);
        IntPtr h = TaskbarBadge.DrawIcon(a[1], size);
        using (System.Drawing.Icon icon = System.Drawing.Icon.FromHandle(h))
        using (System.Drawing.Bitmap b = icon.ToBitmap()) {
          System.Drawing.Color corner = b.GetPixel(0, 0);
          System.Drawing.Color rim = b.GetPixel(size / 2, 1);
          int white = 0;
          for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) { System.Drawing.Color c = b.GetPixel(x, y); if (c.A > 200 && c.R > 200 && c.G > 200 && c.B > 200) white++; }
          Console.Write(b.Width + "x" + b.Height + " corner=" + corner.A + " rim=" + rim.A + "," + rim.R + "," + rim.G + "," + rim.B + " white=" + white);
        }
        Console.Write(" destroyed=" + TaskbarBadge.DestroyIcon(h));
        break;
      }
    }
    return 0;
  }
}
`;

let probeExe = null;
let probeDir = null;
function probe(args, input, env) {
  const r = spawnSync(probeExe, args, { input: input || '', encoding: 'utf8', windowsHide: true, env: env || process.env });
  assert.equal(r.status, 0, 'the probe failed: ' + r.stdout + r.stderr);
  return r.stdout;
}

test('#3996: the probe compiles beside the launcher', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-badge-probe-'));
  fs.writeFileSync(path.join(probeDir, 'BadgeProbe.cs'), PROBE);
  const out = path.join(probeDir, 'probe.exe');
  const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:BadgeProbe', '/out:' + out, LAUNCHER, path.join(probeDir, 'BadgeProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  probeExe = out;
});

test.after(() => { if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true }); });

const needsProbe = (t) => { if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return false; } return true; };

test('#3996: 1 to 9 is the number, 10 and up is "9+", and zero or none is no badge; the words say how many', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  assert.equal(probe(['label', '3']), '3');
  assert.equal(probe(['label', '9']), '9');
  assert.equal(probe(['label', '10']), '9+');
  assert.equal(probe(['label', '12']), '9+');
  assert.equal(probe(['label', '0']), 'null', 'ZERO CLEARS IT');
  assert.equal(probe(['label', 'null']), 'null');
  assert.equal(probe(['desc', '1']), '1 thing waiting for you');
  assert.equal(probe(['desc', '12']), '12 things waiting for you', 'the words carry the real count, not "9+"');
  assert.equal(probe(['desc', '0']), '');
});

test('#3996: a count is a whole number of at least 1; anything else is no badge', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  for (const [raw, want] of [['3', '3'], ['12', '12'], ['1e1', '10'], ['0', 'null'], ['null', 'null'], ['-2', 'null'],
    ['2.5', 'null'], ['true', 'null'], ['"3"', 'null'], ['', 'null'], ['99999999999', String(2147483647)]]) {
    assert.equal(probe(['count'], raw), want, JSON.stringify(raw));
  }
});

test('#3996: what reads as the board\'s status, and its count', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const status = (body) => probe(['status'], body);
  assert.equal(status(JSON.stringify({ agents: [], counts: { needsYou: 1, waiting: 3 } })), 'True:3');
  assert.equal(status(JSON.stringify({ counts: { waiting: 12 }, other: 1 })), 'True:12');
  assert.equal(status(JSON.stringify({ counts: { waiting: null } })), 'True:null', '#4025 switch off: an answer that clears');
  assert.equal(status(JSON.stringify({ counts: { needsYou: 2 } })), 'True:null', 'an older board with no count: an answer that clears');
  assert.equal(status(JSON.stringify({ counts: { waiting: 0 } })), 'True:null');
  /* Keys and braces inside strings, and a "waiting" somewhere else, are not the count. */
  assert.equal(status(JSON.stringify({ agents: [{ note: '"counts":{"waiting":7}}{', waiting: 8 }], counts: { waiting: 2 } })), 'True:2');
  assert.equal(status(JSON.stringify({ waiting: 5, counts: { nested: { waiting: 6 }, waiting: 4 } })), 'True:4');
  /* A 200 cut off mid-body, or anything that is not the status, is a miss (the three-miss rule). */
  const whole = JSON.stringify({ counts: { waiting: 3 }, agents: [{ name: 'a' }] });
  assert.equal(status(whole.slice(0, whole.length - 5)), 'False:null', 'a truncated body read as an answer');
  assert.equal(status(whole.slice(0, 30)), 'False:null');
  assert.equal(status('{}'), 'False:null');
  assert.equal(status('[]'), 'False:null');
  assert.equal(status(JSON.stringify({ counts: 3 })), 'False:null');
  assert.equal(status('<html>not the board</html>'), 'False:null');
  assert.equal(status(''), 'False:null');
});

test('#3996: what reads as the page\'s message, and its count', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const page = (json) => probe(['page'], json);
  assert.equal(page(JSON.stringify({ kosmosBadge: 3 })), 'True:3');
  assert.equal(page(JSON.stringify({ kosmosBadge: null })), 'True:null', 'the switch off clears the badge through the page too');
  assert.equal(page(JSON.stringify({ kosmosBadge: 0 })), 'True:null');
  assert.equal(page(JSON.stringify({ other: 3 })), 'False:null', 'someone else\'s message is not a count');
  assert.equal(page('"3"'), 'False:null');
  assert.equal(page('3'), 'False:null');
});

test('#3996: the token is read from the folder engine/store.js dataRootFor names on Windows', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const store = require('./engine/store.js');
  const base = { SystemRoot: process.env.SystemRoot };
  const cases = [
    [{ APPDATA: 'C:\\Users\\pat\\AppData\\Roaming' }, 'C:\\Users\\pat'],
    [{}, 'C:\\Users\\pat'],
    [{ AGENT_WORKFORCE_HOME: 'D:\\sandbox', APPDATA: 'C:\\Users\\pat\\AppData\\Roaming' }, 'D:\\sandbox'],
    [{ AGENT_WORKFORCE_DATA: 'E:\\kosmos-data', AGENT_WORKFORCE_HOME: 'D:\\sandbox', APPDATA: 'C:\\Users\\pat\\AppData\\Roaming' }, 'D:\\sandbox'],
  ];
  for (const [env, home] of cases) {
    const want = path.win32.normalize(store.dataRootFor('win32', home, env));
    const got = path.win32.normalize(probe(['root', home], '', { ...base, ...env }));
    assert.equal(got, want, 'for ' + JSON.stringify(env));
  }
});

test('#3996: the icon is a red circle with white text on a clear ground, at the size asked, and destroys cleanly', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  for (const [label, size] of [['3', 16], ['9+', 16], ['7', 24], ['9+', 32]]) {
    const said = probe(['icon', label, String(size)]);
    const m = said.match(/^(\d+)x(\d+) corner=(\d+) rim=(\d+),(\d+),(\d+),(\d+) white=(\d+) destroyed=(\w+)$/);
    assert.ok(m, 'the probe said ' + said);
    assert.equal(Number(m[1]), size); assert.equal(Number(m[2]), size);
    assert.equal(Number(m[3]), 0, 'the corner outside the circle is not transparent');
    assert.ok(Number(m[4]) > 200 && Number(m[5]) > 150 && Number(m[6]) < 90 && Number(m[7]) < 90, label + '@' + size + ': the circle is not red (' + said + ')');
    assert.ok(Number(m[8]) >= size / 2, label + '@' + size + ': no white text drawn (' + said + ')');
    assert.equal(m[9], 'True', 'DestroyIcon refused the drawn icon');
  }
});
