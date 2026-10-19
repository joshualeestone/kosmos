'use strict';

/**
 * #6512: the Windows window signs itself in again after a board restart, and the committed Kosmos.exe
 * cannot fall behind its source again without the Windows build saying so.
 *
 *   node --test tools.win-launcher-signin-6512.test.js
 *
 * #6358 ends every browser session when the board restarts. The page then tells the app
 * ({ kosmosSignin: true } to the Windows window, web signedOutTellApp), and the Mac app signs its
 * window in again (native-app/main.swift pageSaysSignedOut). Before #6512 the Windows window ignored
 * it, so the person had to open Kosmos.exe again. Now the window answers it the way that second
 * double-click does (BoardWindowForm.SignInAgain), paced and capped as the Mac is.
 *
 * Three halves:
 *   - the SOURCE, for the wiring nothing can call from outside;
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only), for the pure parts: what reads as the
 *     sign-in message, and the sign-in / wait / give-up / stay decision;
 *   - the DRIFT: the committed exe is no older than its source (git order, any platform with history),
 *     and on Windows verify-launcher.ps1 reproduces it from the source.
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
const BUILD = fs.readFileSync(path.join(REPO, 'tools', 'build-kosmos-windows.sh'), 'utf8');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'needs the Windows C# compiler' };

function method(signature) {
  const at = SOURCE.indexOf(signature);
  assert.notEqual(at, -1, signature + ' is gone from KosmosLauncher.cs');
  const end = SOURCE.indexOf('\n    }\n', at);
  assert.notEqual(end, -1, 'the end of ' + signature + ' is gone');
  return SOURCE.slice(at, end);
}

test('#6512: the instrument is reading the launcher and the page', () => {
  assert.ok(SOURCE.length > 100000, 'KosmosLauncher.cs read back only ' + SOURCE.length + ' bytes');
  assert.ok(PAGE.length > 1000000, 'web/index.html read back only ' + PAGE.length + ' bytes');
});

test('#6512: the page and the window agree on the message, and the page retells it after the window\'s own limit', () => {
  assert.match(PAGE, /else win\.postMessage\(\{ kosmosSignin: true \}\);/, 'the page no longer tells the Windows window');
  assert.match(SOURCE, /internal const string PageSigninMessageKey = "kosmosSignin";/);
  const retell = Number((PAGE.match(/const SIGNED_OUT_RETELL_MS = (\d+);/) || [])[1]);
  const gap = Number((SOURCE.match(/internal const long SignInAgainMinGapMs = (\d+);/) || [])[1]);
  assert.ok(retell > 0 && gap > 0, 'the retell or the window\'s gap is gone');
  assert.ok(retell > gap, 'a retold sign-out (' + retell + ' ms) would land inside the window\'s limit (' + gap + ' ms) and be set aside again');
});

test('#6512: only the board\'s own page is heard, a connect computer is not, and the message signs in again', () => {
  const on = method('internal void OnWebMessage(');
  const gate = on.indexOf('if (!KosmosLauncher.IsBoardAddress(source, port)) return;');
  const connect = on.indexOf('if (mode == KosmosLauncher.ComputerMode.Connect) return;');
  const signin = on.indexOf('if (KosmosLauncher.IsSigninPageMessage(json)) { PageSaysSignedOut(); return; }');
  assert.ok(gate !== -1 && connect > gate && signin > connect, 'the sign-in message is not behind the board-origin and connect gates');
  const badge = on.slice(on.indexOf('TaskbarBadge.ReadsAsPageMessage'));
  assert.match(badge, /signInAgainGaveUp = false;/, 'a board read that worked does not end a give-up');
  assert.match(badge, /signInsWithoutRead = 0;/, 'a board read that worked does not reset the sign-in count');

  const says = method('void PageSaysSignedOut(');
  assert.match(says, /mode == KosmosLauncher\.ComputerMode\.Connect \|\| !navigatedToBoard \|\| signingInAgain\) return;/);
  assert.match(says, /KosmosLauncher\.SignInAgainDecision\(now, lastSignInAgainAt, TaskbarBadge\.ReadBoardToken\(\) != null, signInAgainGaveUp, signInsWithoutRead\)/);
  const signIn = says.slice(says.indexOf('case KosmosLauncher.SignInAgainStep.SignIn:'), says.indexOf('case KosmosLauncher.SignInAgainStep.GiveUp:'));
  assert.ok(signIn.indexOf('lastSignInAgainAt = now;') !== -1 && signIn.indexOf('signInsWithoutRead++;') !== -1, 'a sign-in is not counted and timed');
  assert.ok(signIn.indexOf('SignInAgain();') > signIn.indexOf('signInsWithoutRead++;'), 'the sign-in is not the double-click path');
  // The sign-in itself is the double-click path: a fresh ?boot= address from open-board.js, never a token in a URL.
  const again = method('internal void SignInAgain(');
  assert.match(again, /fresh\.Contains\("\?boot="\)/);
  assert.doesNotMatch(says, /token=/, 'the window must never put the board token into an address');
});

// ---- the probe ----

const PROBE = `
using System;
static class SigninProbe
{
    static int Main(string[] args)
    {
        if (args[0] == "msg") { Console.Write(KosmosLauncher.IsSigninPageMessage(Console.In.ReadToEnd()) ? "yes" : "no"); return 0; }
        if (args[0] == "decide")
        {
            long now = long.Parse(args[1]);
            long? last = args[2] == "none" ? (long?)null : long.Parse(args[2]);
            Console.Write(KosmosLauncher.SignInAgainDecision(now, last, args[3] == "token", args[4] == "gaveup", int.Parse(args[5])));
            return 0;
        }
        return 2;
    }
}
`;

let probeExe = null;
let probeDir = null;
function probe(args, input) {
  const r = spawnSync(probeExe, args, { input: input || '', encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, 'the probe failed: ' + r.stdout + r.stderr);
  return r.stdout;
}
const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

test('#6512: the probe compiles beside the launcher', WINDOWS_ONLY, (t) => {
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-signin-probe-'));
  fs.writeFileSync(path.join(probeDir, 'SigninProbe.cs'), PROBE);
  const out = path.join(probeDir, 'probe.exe');
  const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:SigninProbe', '/out:' + out, LAUNCHER, path.join(probeDir, 'SigninProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  probeExe = out;
});

test.after(() => { if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true }); });

const needsProbe = (t) => { if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return false; } return true; };

test('#6512: only { kosmosSignin: true } is the sign-in message', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  assert.equal(probe(['msg'], JSON.stringify({ kosmosSignin: true })), 'yes');
  assert.equal(probe(['msg'], '{ "kosmosSignin" : true }'), 'yes');
  for (const no of ['{"kosmosSignin":false}', '{"kosmosSignin":"true"}', '{"kosmosSignin":1}', '{"kosmosBadge":3}',
    '{"kosmosMode":"run"}', '{"x":{"kosmosSignin":true}}', 'true', '"kosmosSignin"', '', '{"kosmosSignin":true']) {
    assert.equal(probe(['msg'], no), 'no', no + ' read as the sign-in message');
  }
});

test('#6512: sign in at once, then once a minute, give up after three fruitless tries or with no token, then stay out', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const d = (now, last, token, gaveUp, tries) => probe(['decide', String(now), last == null ? 'none' : String(last), token ? 'token' : 'none', gaveUp ? 'gaveup' : 'no', String(tries)]);
  assert.equal(d(5000, null, true, false, 0), 'SignIn', 'the first sign-out signs in at once');
  assert.equal(d(100000, 100000 - 59999, true, false, 1), 'Wait', 'under a minute since the last try: wait');
  assert.equal(d(100000, 100000 - 60000, true, false, 1), 'SignIn', 'a minute later: again');
  assert.equal(d(100000, 0, true, false, 3), 'GiveUp', 'three sign-ins with no board read: give up');
  assert.equal(d(100000, null, false, false, 0), 'GiveUp', 'no board token to sign in with: give up');
  assert.equal(d(100000, 0, true, true, 0), 'Stay', 'after giving up: stay out of it until a board read works');
});

// ---- the drift ----

test('#6512: the Windows build refuses an exe older than its source', () => {
  assert.match(BUILD, /git -C "\$REPO" merge-base --is-ancestor "\$LAUNCHER_SRC_AT" "\$LAUNCHER_EXE_AT" \|\| \{/);
  const check = BUILD.indexOf('merge-base --is-ancestor "$LAUNCHER_SRC_AT"');
  const copy = BUILD.indexOf('cp "$LAUNCHER" "$STAGE/Kosmos.exe"');
  assert.ok(check !== -1 && copy > check, 'the order check must come before the exe is staged');
});

test('#6512: the committed Kosmos.exe is no older than KosmosLauncher.cs (git order)', (t) => {
  const last = (file) => spawnSync('git', ['-C', REPO, 'log', '-1', '--format=%H', '--', file], { encoding: 'utf8' });
  const src = last('tools/windows/KosmosLauncher.cs');
  const exe = last('tools/windows/Kosmos.exe');
  if (src.status !== 0 || exe.status !== 0 || !src.stdout.trim() || !exe.stdout.trim()) { t.skip('no git history for the launcher here'); return; }
  const r = spawnSync('git', ['-C', REPO, 'merge-base', '--is-ancestor', src.stdout.trim(), exe.stdout.trim()], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'KosmosLauncher.cs changed in ' + src.stdout.trim() + ' after Kosmos.exe was last rebuilt in ' + exe.stdout.trim()
    + ': rebuild and re-sign it (tools/windows/README.md)');
});

test('#6512: verify-launcher.ps1 reproduces the committed Kosmos.exe from its source', WINDOWS_ONLY, (t) => {
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'tools', 'windows', 'verify-launcher.ps1')],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.equal(r.status, 0, 'verify-launcher.ps1 says the committed exe does not match its source:\n' + r.stdout + r.stderr);
  assert.match(r.stdout, /^OK: /m);
});
