'use strict';
/**
 * #6916: the Windows board window refuses, before it leaves, every request its page starts to this computer on a
 * port other than the board's.
 *
 *   node --test tools.win32-launcher-crossport-6916.test.js
 *
 * The window keeps the board's sign-in cookie, scoped to the host and NOT the port (SameSite does not help: another
 * port on the same host is the same site). Measured on the Windows box with the served 0.8.15 Kosmos.exe --window and
 * a second listener on another 127.0.0.1 port: a fetch, an image and a navigation the board page started all reached
 * it carrying the session cookie. NavigationStarting cannot stop that, because WebView2 has sent the request by then
 * (#6882). With this change WebResourceRequested sees each request first and answers one to this computer on another
 * port with a local 403, so it never leaves; the same rig then saw no request at all, and the board kept working.
 *
 * Two halves, as the other launcher tests do it:
 *   - the SOURCE (every platform): the hook is wired before any page loads, in every mode, with filters for the
 *     addresses that name this computer; a failure to wire it closes the window (CouldNotHost), never carries on without it; a
 *     request that cannot be read is refused; and the COM slots follow WebView2.h's order;
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only): RefusedLoopbackRequest over the addresses that matter.
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const REPO = __dirname;
const LAUNCHER = path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs');
const SOURCE = fs.readFileSync(LAUNCHER, 'utf8').replace(/\r\n/g, '\n');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe needs the Windows C# compiler' };

function between(start, end) {
  const at = SOURCE.indexOf(start);
  assert.notEqual(at, -1, start + ' is gone from KosmosLauncher.cs');
  const stop = SOURCE.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, end + ' is gone after ' + start);
  return SOURCE.slice(at, stop);
}

test('#6916: the window wires the request check before any page loads, in every mode, and never goes on without it', () => {
  const ready = between('internal void ControllerReady(', 'FitViewToWindow();');
  const wired = ready.indexOf('webView.add_WebResourceRequested(new WebResourceRequested(this), out token);');
  assert.ok(wired > 0, 'ControllerReady no longer adds the WebResourceRequested handler');
  // Review 4: only addresses that name this computer are held (a filtered request's body is buffered, measured), as
  // substrings so a user part or another spelling Chromium rewrites to 127.0.0.1 still matches (measured), every context.
  for (const pattern of ['*127.0.0.1*', '*localhost*', '*[::1]*']) {
    assert.ok(ready.indexOf('webView.AddWebResourceRequestedFilter("' + pattern + '", 0);') > wired, 'no ' + pattern + ' filter for every resource context');
  }
  assert.doesNotMatch(ready, /AddWebResourceRequestedFilter\("\*", /, 'every request is held, a connect window\'s uploads elsewhere included');
  // Review 1: never gated on the starting mode. A connect window can become one that runs this computer's board while it
  // is open (RunAgentsHere, PageChoseMode) and loads it in the same view, which would then go unchecked.
  // Review 2: from the top of ControllerReady, so a mode check wrapped around the comment and the calls together counts.
  const wiring = ready.slice(0, wired);
  assert.doesNotMatch(wiring, /ComputerMode|\bmode\b\s*[!=]=/, 'the check is gated on the window\'s mode');
  const failed = ready.slice(ready.indexOf('catch (Exception x)', wired));
  assert.match(failed, /controller\.Close\(\);[\s\S]*controller = null;[\s\S]*CouldNotHost\(/, 'a window that cannot wire the check does not close');
  assert.match(failed, /return;/, 'the window carries on loading after it could not wire the check');
  // The board is loaded only after the check is in place.
  const rest = between('internal void ControllerReady(', '\n    }\n');
  assert.ok(rest.indexOf('NavigateToBoard();') > rest.indexOf('add_WebResourceRequested'), 'the board loads before the check is wired');
});

test('#6916: a request to this computer on another port is answered with a local 403; one that cannot be read is refused too', () => {
  const on = between('internal void OnWebResourceRequested(', '\n    }\n');
  // Review 5: the calls and their order, not their layout.
  const order = (text, calls, what) => {
    let at = -1;
    for (const c of calls) { const next = text.indexOf(c, at + 1); assert.ok(next > at, what + ': ' + c + ' is missing or out of order'); at = next; }
  };
  order(between('internal void OnWebResourceRequested(', '\n    }\n'),
    ['request.get_Uri(out uri)', 'Marshal.ReleaseComObject(request)', 'KosmosLauncher.RefusedLoopbackRequest(uri, port)', 'RefuseRequest(args)'], 'OnWebResourceRequested');
  const refuse = between('internal void RefuseRequest(', '\n    }\n');
  order(refuse, ['webEnvironment.CreateWebResourceResponse(IntPtr.Zero, 403,', 'args.put_Response(refusal)', 'Marshal.ReleaseComObject(refusal)'], 'RefuseRequest');
  assert.match(refuse, /finally \{ Marshal\.ReleaseComObject\(refusal\); \}/, 'the refusal is not released when put_Response throws');
  // Review 5: the wiring makes one refusal too, so a response factory that does not work closes the window at start.
  const wiringTry = between('webView.add_WebResourceRequested(new WebResourceRequested(this), out token);', 'catch (Exception x)');
  order(wiringTry, ['webEnvironment.CreateWebResourceResponse(IntPtr.Zero, 403,', 'if (probe == null) throw', 'Marshal.ReleaseComObject(probe)'], 'the wiring\'s throwaway refusal');
  const handler = between('public class WebResourceRequested :', '\n}\n');
  assert.match(handler, /try \{ form\.OnWebResourceRequested\(args\); \}\s*catch \{ try \{ form\.RefuseRequest\(args\); \}/, 'a request the check could not read is let through');
  assert.match(between('internal void EnvironmentReady(', '\n    }\n'), /webEnvironment = environment;/, 'the environment that makes the refusal is not kept');
});

test('#6916: the COM declarations follow WebView2.h', () => {
  // ICoreWebView2, on from add_NewWindowRequested (WebView2.h's order, the run ICoreWebView2_4 repeats).
  const base = between('public interface ICoreWebView2\n{', '\n}\n');
  const tail = base.slice(base.lastIndexOf('\n', base.indexOf('add_NewWindowRequested(')) + 1).split('\n').map((l) => l.trim()).filter((l) => /^void /.test(l))
    .map((l) => l.replace(/^void (_unused_)?/, '').replace(/\(.*$/, ''));
  assert.deepEqual(tail, ['add_NewWindowRequested', 'remove_NewWindowRequested', 'add_DocumentTitleChanged', 'remove_DocumentTitleChanged',
    'get_DocumentTitle', 'AddHostObjectToScript', 'RemoveHostObjectFromScript', 'OpenDevToolsWindow', 'add_ContainsFullScreenElementChanged',
    'remove_ContainsFullScreenElementChanged', 'get_ContainsFullScreenElement', 'add_WebResourceRequested', 'remove_WebResourceRequested',
    'AddWebResourceRequestedFilter']);
  // The same slots in ICoreWebView2_4's flattened copy, so the two cannot drift apart.
  const four = between('public interface ICoreWebView2_4', '\n}\n');
  for (const slot of ['_unused_add_WebResourceRequested', '_unused_remove_WebResourceRequested', '_unused_AddWebResourceRequestedFilter']) {
    assert.ok(four.includes(slot), slot + ' moved in ICoreWebView2_4');
  }
  assert.match(SOURCE, /Guid\("ab00b74c-15f1-4646-80e8-e76341d25d71"\)[^\n]*\npublic interface ICoreWebView2WebResourceRequestedEventHandler/);
  assert.match(SOURCE, /Guid\("453e667f-12c7-49d4-be6d-ddbe7956f57a"\)[^\n]*\npublic interface ICoreWebView2WebResourceRequestedEventArgs\n\{\n    void get_Request\(out ICoreWebView2WebResourceRequest request\);\n    void _unused_get_Response\(\);\n    void put_Response\(ICoreWebView2WebResourceResponse response\);/);
  assert.match(SOURCE, /Guid\("97055cd4-512c-4264-8b5f-e3f446cea6a5"\)[^\n]*\npublic interface ICoreWebView2WebResourceRequest\n\{\n    void get_Uri\(/);
  assert.match(SOURCE, /Guid\("aafcc94f-fa27-48fd-97df-830ef75aaec9"\)[^\n]*\npublic interface ICoreWebView2WebResourceResponse/);
  const env = between('public interface ICoreWebView2Environment\n{', '\n}\n');
  assert.match(env, /void CreateCoreWebView2Controller\([^\n]*\n[\s\S]*void CreateWebResourceResponse\(IntPtr content, int statusCode, \[MarshalAs\(UnmanagedType\.LPWStr\)\] string reasonPhrase,\s*\[MarshalAs\(UnmanagedType\.LPWStr\)\] string headers, out ICoreWebView2WebResourceResponse response\);/,
    'CreateWebResourceResponse is not the environment\'s second method with WebView2.h\'s parameters');
});

test('#6916: RefusedLoopbackRequest refuses this computer on any other port or scheme, and nothing else', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-crossport-'));
  try {
    const probeSource = path.join(base, 'CrossPortProbe.cs');
    fs.writeFileSync(probeSource, [
      'class CrossPortProbe {',
      '  static int Main(string[] a) {',
      // An address too long for a command line (Windows caps it near 32k) comes in a file: @<path>.
      '    string address = a.Length == 0 ? null : a[0].StartsWith("@") ? System.IO.File.ReadAllText(a[0].Substring(1)) : a[0];',
      '    System.Console.Write(KosmosLauncher.RefusedLoopbackRequest(address, 16180));',
      '    return 0;',
      '  }',
      '}',
      '',
    ].join('\n'));
    const probe = path.join(base, 'probe.exe');
    const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:CrossPortProbe', '/out:' + probe, LAUNCHER, probeSource], { encoding: 'utf8', windowsHide: true });
    assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
    const refused = (address) => String(spawnSync(probe, address === null ? [] : [address], { encoding: 'utf8', windowsHide: true }).stdout).trim();
    // The board itself: never refused, however it is spelt.
    for (const board of ['http://127.0.0.1:16180/', 'http://127.0.0.1:16180/api/status?x=1', 'http://localhost:16180/settings', 'http://[::1]:16180/', 'http://LOCALHOST:16180/']) {
      assert.equal(refused(board), 'False', board + ' is the board');
    }
    // This computer anywhere else: refused, whatever the scheme (the cookie has no Secure flag, so https gets it too).
    for (const other of ['http://127.0.0.1:16301/n', 'http://127.0.0.1:3000/', 'http://localhost:5173/', 'http://[::1]:8080/', 'https://127.0.0.1:16180/',
      'https://localhost/', 'http://127.0.0.1/', 'http://localhost./x', 'ws://127.0.0.1:9000/', 'http://[0:0:0:0:0:0:0:1]:3000/',
      'http://127.0.0.2:16301/']) {
      assert.equal(refused(other), 'True', other + ' would carry the board session out (or is this computer anyway)');
    }
    // A loopback alias on the board's own port is let through by design: the cookie belongs to the board's host
    // only (127.0.0.1), so another spelling of this computer on that port never gets it.
    for (const alias of ['http://127.0.0.2:16180/', 'http://[::1]:16180/x']) assert.equal(refused(alias), 'False', alias + ' on the board\'s port');
    // Everywhere else: not this rule's business (the cookie is never sent there). The window's own pages included.
    for (const elsewhere of ['https://installkosmos.com/', 'https://example.com:16180/', 'http://10.0.0.5:16301/', 'about:blank', 'data:text/html,x',
      'blob:http://127.0.0.1:16180/1b2c']) {
      assert.equal(refused(elsewhere), 'False', elsewhere + ' is not this computer\'s board host');
    }
    // Review 2: an address .NET's Uri cannot parse (over about 65,500 characters, measured; Chromium sends up to 2 MB) is
    // read by where it goes, not let through as unreadable.
    const longFile = (address) => { const f = path.join(base, 'long-' + Math.random().toString(36).slice(2) + '.txt'); fs.writeFileSync(f, address); return '@' + f; };
    const tail = '?' + 'a'.repeat(70000);
    assert.equal(refused(longFile('http://127.0.0.1:3000/' + tail)), 'True', 'a 70k address to another port slips through as unreadable');
    assert.equal(refused(longFile('http://localhost:5173' + tail)), 'True', 'a 70k address with no path');
    assert.equal(refused(longFile('http://127.0.0.1:16180/' + tail)), 'False', 'a 70k request to the board itself is the board');
    assert.equal(refused(longFile('https://example.com/' + tail)), 'False', 'a 70k address elsewhere is not this rule\'s business');
    assert.equal(refused(longFile('data:text/html,' + 'x'.repeat(70000))), 'False', 'a long data: page is the window\'s own');
    // Whatever still cannot be read is refused (fail closed): never let through as unreadable.
    for (const unreadable of ['not a url', '', 'http://', 'http:///x']) assert.equal(refused(unreadable), 'True', JSON.stringify(unreadable) + ' is let through');
    assert.equal(refused(null), 'True', 'no address is let through');
  } finally { fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
