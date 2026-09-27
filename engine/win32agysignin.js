'use strict';
/**
 * #3568 / #3998 on Windows: sign Gemini's Google subscription in so the person sees ONLY Google's
 * page and a code box in Kosmos. No terminal, no agy window, no menu.
 *
 * WHAT agy 1.2.11 DOES, MEASURED on Windows 11 with a throwaway --gemini_dir and never signed in
 * (C:\Users\joshu\work\agy-probe\L, 2026-09-26):
 *   1. agy has no login command. Any print-mode run while signed out prints, on stderr:
 *        Authentication required. Please visit the URL to log in:
 *          https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=...
 *            &code_challenge=...&code_challenge_method=S256&prompt=consent
 *            &redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&scope=...&state=...
 *        Waiting for authentication (timeout 60s)...
 *        Or, paste the authorization code here and press Enter:
 *      and calls `rundll32 url.dll,FileProtocolHandler <link>` from PATH (our stub: no browser).
 *      Print mode shows no login-method menu (the Mac's interactive screen does, #3998).
 *   2. The redirect is Google's own page (antigravity.google/oauth-callback), which shows a code to
 *      copy (Josh's Mac screenshot, #3998). There is no localhost callback, so the code must be typed
 *      back into agy.
 *   3. agy reads that code from the CONSOLE (CONIN$), not from stdin: a code written to a stdin pipe
 *      is ignored (measured: it still timed out). Written into agy's console input buffer (AttachConsole
 *      + WriteConsoleInput, done by a small PowerShell helper), it is read at once: a made-up code came
 *      back in 3 s as `token exchange failed: oauth2: "invalid_grant" "Malformed auth code."` and exit 1.
 *      So the path from the code box to Google's token endpoint is proven; a REAL code is not.
 *   4. After 60 s with no code agy prints "Error: authentication timed out." and exits 1. That window is
 *      hard: nothing measured lengthens it, and a code is tied to the run that printed its link (PKCE),
 *      so a late code cannot be given to a new run. The screen says so and offers a fresh start.
 *   5. A signed-out `agy models` exits 1 in under a second with "Please sign in"; signed in it is
 *      presumably exit 0 (UNPROVEN). Success here is: agy exits 0 AND `agy models` agrees.
 *
 * The surface (start/status/code/stop, NOT_MINE) is engine/agysignin.js's on #3998's branch, so the
 * same screen can drive either platform.
 */
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const agy = require('./win32agy');

const PROMPT = 'Reply with the single word ok';
const AUTH_WAIT_MS = 60000;           // agy's own, measured
const RUN_CAP_MS = AUTH_WAIT_MS + 90000; // the wait, the exchange and the one-line prompt, then we stop it
const NOT_MINE = 'that sign-in has ended or been replaced';
const GOOGLE_LINK = /https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?[^\s"'<>]+/;
const PRINTED_LINK = /Please visit the URL to log in:\s*(\S+)\s/;

/* Only Google's own sign-in page for agy's own callback is ever opened. It rides on rundll32's raw
   command line (win32signin.openInDefaultBrowser), where a comma, quote or space could change what
   is parsed, so one carrying any is not opened (the screen still shows it as a link). */
function linkToOpen(printed) {
  let u;
  try { u = new URL(String(printed || '')); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'accounts.google.com' || u.pathname !== '/o/oauth2/auth') return null;
  if (u.searchParams.get('redirect_uri') !== 'https://antigravity.google/oauth-callback') return null;
  if (!u.searchParams.get('code_challenge') || !u.searchParams.get('state')) return null;
  const link = String(printed);
  return /[,"\s]/.test(link) ? null : link;
}

/* What the person pasted, as the code agy wants, or null. Google's codes look like 4/0AXl...; a
   pasted callback URL (…/oauth-callback?code=…) is accepted too, its code taken out. */
function cleanCode(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (/^https?:\/\//i.test(s)) {
    try { s = new URL(s).searchParams.get('code') || ''; } catch { return null; }
  }
  s = s.replace(/\s+/g, '');
  if (s.length < 10 || s.length > 512) return null;
  return /^[A-Za-z0-9/_.~-]+$/.test(s) ? s : null;
}

/* ---- typing into agy's console ------------------------------------------------------------ */

/* The PowerShell helper. The pid is a number we put in; the code arrives on the helper's STDIN, so
   it is never on a command line another process can read. It leaves its own console, attaches to
   agy's, and writes the code and Enter as key presses. Exit 0 typed; 2 attach, 3 CONIN$, 4 write,
   5 no code. */
function typerScript(pid) {
  return [
    '$ErrorActionPreference = "Stop"',
    '$code = [Console]::In.ReadLine()',
    'if (-not $code) { exit 5 }',
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices;',
    'public static class KosmosConIn {',
    '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();',
    '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);',
    '  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);',
    '  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);',
    '  [StructLayout(LayoutKind.Explicit, CharSet=CharSet.Unicode)] public struct KEY { [FieldOffset(0)] public int Down; [FieldOffset(4)] public ushort Repeat; [FieldOffset(6)] public ushort Vk; [FieldOffset(8)] public ushort Scan; [FieldOffset(10)] public char Ch; [FieldOffset(12)] public uint Ctl; }',
    '  [StructLayout(LayoutKind.Explicit)] public struct REC { [FieldOffset(0)] public ushort Type; [FieldOffset(4)] public KEY Key; }',
    '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool WriteConsoleInputW(IntPtr h, REC[] r, uint n, out uint w);',
    '  public static int Type(uint pid, string text) {',
    '    FreeConsole();',
    '    if (!AttachConsole(pid)) return 2;',
    '    IntPtr h = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);',
    '    if (h == new IntPtr(-1)) { FreeConsole(); return 3; }',
    '    string s = text + "\\r"; REC[] r = new REC[s.Length * 2];',
    '    for (int i = 0; i < s.Length; i++) for (int d = 0; d < 2; d++) { REC x = new REC(); x.Type = 1; x.Key.Down = d == 0 ? 1 : 0; x.Key.Repeat = 1; x.Key.Ch = s[i]; x.Key.Vk = (ushort)(s[i] == 13 ? 13 : 0); r[i * 2 + d] = x; }',
    '    uint w; bool ok = WriteConsoleInputW(h, r, (uint)r.Length, out w);',
    '    CloseHandle(h); FreeConsole();',
    '    return ok && w == r.Length ? 0 : 4;',
    '  }',
    '}',
    '"@',
    'exit [KosmosConIn]::Type([uint32]' + Number(pid) + ', $code.Trim())',
  ].join('\r\n');
}

/* The typing seam: (pid, code) => Promise<{ ok, because? }>. */
let typerFn = null;
function setTyper(fn) { typerFn = typeof fn === 'function' ? fn : null; }
function typeIntoConsole(pid, code) {
  if (typerFn) return Promise.resolve(typerFn(pid, code));
  return new Promise((resolve) => {
    if (!Number.isInteger(pid) || pid <= 0) { resolve({ ok: false, because: 'no Antigravity to hand the code to' }); return; }
    const ps = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const encoded = Buffer.from(typerScript(pid), 'utf16le').toString('base64');
    let child;
    try {
      child = execFile(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, timeout: 30000 }, (err) => {
          const code2 = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
          resolve(code2 === 0 ? { ok: true } : { ok: false, because: 'Kosmos could not hand the code to Antigravity (' + code2 + ')' });
        });
    } catch { resolve({ ok: false, because: 'Kosmos could not hand the code to Antigravity' }); return; }
    try { child.stdin.end(code + '\n'); } catch { /* the exit code says so */ }
  });
}

/* ---- the sign-in ------------------------------------------------------------------------- */

let spawnFn = null;
function setSpawn(fn) { spawnFn = typeof fn === 'function' ? fn : null; }
let openerFn = null;
function setOpener(fn) { openerFn = typeof fn === 'function' ? fn : null; }
function openPage(link) {
  if (openerFn) { try { openerFn(link); } catch { /* the screen's own link is the fallback */ } return; }
  require('./win32signin').openInDefaultBrowser(link);
}
let binFn = null;
function setBinForTests(fn) { binFn = typeof fn === 'function' ? fn : null; }
function agyBin() {
  if (binFn) return binFn();
  const r = require('./runners').resolveBin('antigravity');
  return r && r.present ? r.bin : null;
}

/* The one sign-in. States:
     starting   agy started, its link not seen yet
     waiting    Google's page is open; the code box is showing (until `deadline`)
     checking   the code was typed into agy; waiting for agy to trade it and answer
     signed-in  agy finished and `agy models` agrees
     failed     it ended without signing in; `because` says why in words */
let cur = null;

function publicState(s) {
  if (!s) return { state: 'idle' };
  const out = { id: s.id, state: s.state };
  if (s.state === 'waiting') {
    out.link = s.link || null;
    out.secondsLeft = Math.max(0, Math.round((s.deadline - Date.now()) / 1000));
  }
  if (s.because) out.because = s.because;
  return out;
}
function status() { return publicState(cur); }

function end(s, state, because) {
  if (!s || s.ended) return;
  s.ended = true;
  s.state = state;
  if (because) s.because = because;
  clearTimeout(s.cap);
  if (s.child && s.alive) agy.killTree(s.child);
}

/* Why agy ended, from what it printed. */
function failureFrom(text, s) {
  if (/invalid_grant|malformed auth code|token exchange failed/i.test(text)) {
    return s.codeSent
      ? 'Google did not accept that code. Codes work once and only for the page they came from: press Sign in with Google for a fresh page'
      : 'Google refused the sign-in: press Sign in with Google to try again';
  }
  if (/timed out/i.test(text)) {
    return 'Google\'s page gives about a minute to paste the code, and that minute ran out. Press Sign in with Google again: if you stay signed in to Google in your browser it only takes a few seconds';
  }
  return 'Antigravity stopped before the sign-in finished. Press Sign in with Google to try again';
}

/**
 * Start a sign-in (replacing any other). Returns { ok, id, state } or { ok: false, because }.
 * The link is opened in the person's default browser by Kosmos itself as soon as agy prints it.
 */
function start(opts) {
  const o = opts || {};
  if (cur && !cur.ended) end(cur, 'failed', 'a newer sign-in replaced this one');
  const bin = o.bin || agyBin();
  if (!bin) return { ok: false, because: 'Antigravity is not installed on this computer' };
  const home = o.home || agy.signinHome();
  try { fs.mkdirSync(home.geminiDir, { recursive: true }); fs.mkdirSync(home.workspace, { recursive: true }); }
  catch { return { ok: false, because: 'Kosmos could not make the folder the sign-in runs in' }; }
  let env;
  try { env = agy.agyEnv(o.env || process.env, home.tmp); }
  catch { return { ok: false, because: 'Kosmos could not make sure Antigravity would not open a second browser window, so it did not start' }; }
  const s = { id: crypto.randomUUID(), state: 'starting', link: null, deadline: 0, child: null, alive: false, ended: false, codeSent: false, out: '', err: '' };
  cur = s;
  const check = o.check || agy.modelsCheck;
  /* The sign-in is one per Windows user (MEASURED after a real sign-in, 2026-09-26: Credential
     Manager holds it once, and a brand-new --gemini_dir lists models without signing in). So ask
     first: already signed in is done at once, without spending a prompt or showing Google's page. */
  Promise.resolve(check(bin, home.geminiDir, { env: o.env, tmp: home.tmp })).then((r) => {
    if (s.ended) return;
    if (r && r.signedIn === true) { end(s, 'signed-in'); return; }
    run(s, bin, home, env, o, check);
  }, () => { if (!s.ended) run(s, bin, home, env, o, check); });
  s.cap = setTimeout(() => end(s, 'failed', failureFrom('timed out', s)), o.capMs || RUN_CAP_MS);
  if (s.cap.unref) s.cap.unref();
  return { ok: true, ...publicState(s) };
}

/* Run agy's print mode signed out: it prints Google's link, which Kosmos opens, and waits for the
   code on its console. */
function run(s, bin, home, env, o, check) {
  /* The sign-in runs in a Kosmos-owned folder, never the home folder (#3998: trusting the home folder
     grants agy all of it); that folder is pre-trusted in the sign-in's own agy home. */
  try { require('./agytrust').trustAgyFolder(home.workspace, { home: home.root }); } catch { /* agy may ask; seen as a failure */ }
  let child;
  try {
    /* windowsHide with every stdio piped gives agy a console with no window (libuv adds
       CREATE_NO_WINDOW), which is what it reads the code from. */
    child = (spawnFn || spawn)(bin, ['--gemini_dir=' + home.geminiDir, '--print=' + PROMPT, '--output-format', 'json'], {
      cwd: home.workspace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) { end(s, 'failed', 'Kosmos could not start Antigravity (' + ((e && e.code) || 'unknown') + ')'); return; }
  s.child = child; s.alive = true;
  if (s.ended) { agy.killTree(child); return; }
  const seen = () => {
    if (s.link || s.ended) return;
    const text = s.err + '\n' + s.out;
    // agy's own words introduce the link; whatever address follows them is judged, Google's or not.
    const m = text.match(PRINTED_LINK) || text.match(GOOGLE_LINK);
    if (!m) return;
    s.link = linkToOpen(m[1] || m[0]) || null;
    if (!s.link) { end(s, 'failed', 'Antigravity showed a sign-in address Kosmos does not recognise, so it was not opened'); return; }
    s.state = 'waiting';
    s.deadline = Date.now() + (o.authWaitMs || AUTH_WAIT_MS);
    openPage(s.link);
  };
  if (child.stdout) child.stdout.on('data', (d) => { if (s.out.length < 1e6) s.out += String(d); seen(); });
  if (child.stderr) child.stderr.on('data', (d) => { if (s.err.length < 1e6) s.err += String(d); seen(); });
  child.on('error', () => { s.alive = false; end(s, 'failed', 'Kosmos could not start Antigravity'); });
  child.on('close', (code) => {
    s.alive = false;
    if (s.ended) return;
    const text = s.err + '\n' + s.out;
    if (code !== 0) { end(s, 'failed', failureFrom(text, s)); return; }
    /* agy finished its prompt, so it was signed in; `agy models` must agree before Kosmos says so. */
    s.state = 'checking';
    Promise.resolve(check(bin, home.geminiDir, { env: o.env, tmp: home.tmp })).then((r) => {
      if (s.ended) return;
      if (r && r.signedIn === true) end(s, 'signed-in');
      else end(s, 'failed', 'Antigravity finished, but Kosmos could not confirm the sign-in. Press Sign in with Google to try again');
    }, () => end(s, 'failed', 'Kosmos could not confirm the sign-in. Press Sign in with Google to try again'));
  });
}

/** Hand agy the code the person pasted. Resolves { ok } or { ok: false, because }. */
async function code(raw, id) {
  const s = cur;
  if (!s || s.id !== id) return { ok: false, because: NOT_MINE };
  if (s.ended) return { ok: false, because: s.because || NOT_MINE };
  if (s.state !== 'waiting') return { ok: false, because: s.codeSent ? 'Kosmos is already checking a code' : 'Google\'s page is not open yet' };
  const c = cleanCode(raw);
  if (!c) return { ok: false, because: 'that does not look like the code from Google\'s page. Copy it with the page\'s Copy button and paste it here' };
  s.codeSent = true;
  s.state = 'checking';
  const r = await typeIntoConsole(s.child && s.child.pid, c);
  if (!r.ok) { end(s, 'failed', r.because || 'Kosmos could not hand the code to Antigravity'); return { ok: false, because: s.because }; }
  return { ok: true };
}

/** Stop the sign-in `id` names. */
function stop(id) {
  const s = cur;
  if (!s || s.id !== id) return { ok: false, because: NOT_MINE };
  end(s, 'failed', 'stopped');
  return { ok: true };
}

function resetForTests() { if (cur && !cur.ended) end(cur, 'failed', 'reset'); cur = null; typerFn = null; spawnFn = null; openerFn = null; binFn = null; }

module.exports = {
  start, status, code, stop, NOT_MINE, PROMPT, AUTH_WAIT_MS,
  linkToOpen, cleanCode, typerScript, typeIntoConsole, failureFrom,
  setSpawn, setOpener, setTyper, setBinForTests, resetForTests,
};
