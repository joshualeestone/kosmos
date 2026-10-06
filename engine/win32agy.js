'use strict';
/**
 * #3568 on Windows: Gemini on a Google SUBSCRIPTION through Google's Antigravity CLI (`agy`),
 * one headless turn per message, the way win32keyed.js drives Gemini and Grok.
 *
 * MEASURED on a Windows 11 box with agy 1.2.11, never signed in (C:\Users\joshu\work\agy-probe,
 * 2026-09-26). Everything below that says "unproven" needs one real sign-in to confirm.
 *
 *  - A turn is `agy --gemini_dir=<abs> --print=<msg> --output-format json [--conversation <id>]
 *    --dangerously-skip-permissions [--model <m>]`. Go's flag package: global flags must come
 *    BEFORE a subcommand (`agy --gemini_dir=X models`; `agy models --gemini_dir=X` is refused).
 *    `--print=<msg>` keeps a message that starts with a dash from being read as a flag.
 *  - `--gemini_dir=<absolute>` (hidden) moves ALL of agy's state; HOME is ignored and a relative
 *    path is silently ignored. So every agent gets its own absolute home (agentHome).
 *  - The output is ONE line of JSON: {conversation_id, status, response, error, ...}. Signed out it
 *    is {"status":"ERROR","error":"authentication failed or timed out"} after a 60 s wait. The
 *    success shape (status word) is unproven; a turn is ok on exit 0 with no error.
 *  - Signed out, agy prints Google's sign-in link and OPENS A BROWSER through `rundll32
 *    url.dll,FileProtocolHandler` found on PATH. A `rundll32.cmd` first on the child's PATH is run
 *    instead (measured every time), so a background agent can never pop a browser (stubDir).
 *    Nothing shortens that 60 s wait (closed stdin, --print-timeout, AGY_CLI_NONINTERACTIVE_HEADLESS
 *    and a console-less start all measured: still 60 s). So before a turn, `agy models` (0.2 to 0.6 s,
 *    no browser) says whether it is signed in, and a signed-out agent fails at once, in words.
 *  - Credentials live in Windows Credential Manager (`jetski-standalone-oauth-token`, read from the
 *    binary), so every agent of one Windows user very likely shares the one sign-in. UNPROVEN.
 *  - agy starts helpers (a language server, a self-updater check), so a stop or a turn that runs too
 *    long kills the whole process TREE (taskkill /T /F).
 */
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RUNNER = 'antigravity';

/* ---- the Windows switch ------------------------------------------------------------------ */

/* Built off by default; turned ON by default once the signed-in half was proven on a real Windows
   sign-in (2026-09-26: a real install, three real turns, and an agent's `kosmos reply` landing on a
   throwaway board; see the PR for #3568). It can still be turned off on one computer, either:
     - the environment: AGENT_WORKFORCE_ANTIGRAVITY_WINDOWS=0 (or false/off/no; =1 forces it on and
       wins over the file), or
     - a file named `antigravity-windows.off` in the board's data folder (store.ROOT, on Windows
       %APPDATA%\Kosmos), which needs no restart: it is read on every ask. Delete it to turn it back on.
   The Mac never reads either. AGENT_WORKFORCE_ANTIGRAVITY=0 still turns Antigravity off everywhere. */
const SWITCH_ENV = 'AGENT_WORKFORCE_ANTIGRAVITY_WINDOWS';
const SWITCH_FILE = 'antigravity-windows.off';
const DEFAULT_ON = true;
let switchForTests = null;
function switchFile() {
  try { return path.join(dataRoot(), SWITCH_FILE); } catch { return null; }
}
function switchOn() {
  if (typeof switchForTests === 'function') return !!switchForTests();
  const v = String(process.env[SWITCH_ENV] || '').trim();
  if (/^(1|true|on|yes)$/i.test(v)) return true;
  if (/^(0|false|off|no)$/i.test(v)) return false;
  const f = switchFile();
  try { if (f && fs.statSync(f).isFile()) return false; } catch { /* no off file */ }
  return DEFAULT_ON;
}
function setSwitchForTests(fn) { switchForTests = typeof fn === 'function' ? fn : null; }

/* ---- where things live ------------------------------------------------------------------ */

/* Kosmos-owned folders under the board's data root. NOT inside the agent's own folder: agy (like
   the Gemini CLI) may read <workspace>\.gemini as project settings, and an agent could edit its own
   sign-in state from there. */
let rootForTests = null;
function dataRoot() {
  if (rootForTests) return rootForTests;
  return require('./store').ROOT;
}
function setRootForTests(dir) { rootForTests = dir || null; }

/* A name safe as one folder name. */
function safeName(name) { return String(name || 'agent').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'agent'; }

/** An agent's own agy home: { root, geminiDir, tmp }. root is what agytrust calls `home`. */
function agentHome(name) {
  const root = path.join(dataRoot(), 'agy-home', safeName(name));
  return { root, geminiDir: path.join(root, '.gemini'), tmp: path.join(root, 'tmp') };
}
/** The sign-in's own home and its throwaway workspace (never the person's home folder). */
function signinHome() {
  const root = path.join(dataRoot(), 'agy-signin');
  return { root, geminiDir: path.join(root, '.gemini'), tmp: path.join(root, 'tmp'), workspace: path.join(root, 'workspace') };
}

/* The stub that stands in for rundll32 on an agy child's PATH, so agy's "open the browser" does
   nothing. `exit 0` (not `exit /b`) ends cmd.exe at once: agy's link rides unquoted on the stub's
   command line, and cmd would otherwise read each `&` in it as the start of another command. */
const STUB_BODY = '@rem Written by Kosmos (#3568): stands in for rundll32 so Antigravity never opens a browser by itself.\r\n@exit 0\r\n';
function stubDir() {
  const dir = path.join(dataRoot(), 'agy-nobrowser');
  const file = path.join(dir, 'rundll32.cmd');
  try {
    let same = false;
    try { same = fs.readFileSync(file, 'utf8') === STUB_BODY; } catch { same = false; }
    if (!same) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, STUB_BODY); }
  } catch { /* the check below says so */ }
  return fs.existsSync(file) ? dir : null;
}

/**
 * The environment for any agy child: the stub first on PATH, and its own TEMP (agy leaves a
 * ~460 KB schema file in TEMP on every run). Returns a NEW object. Throws only if the stub cannot
 * be written, because an agy that might open a browser must not be started at all.
 */
function agyEnv(base, tmp) {
  const env = Object.assign({}, base || process.env);
  const stub = stubDir();
  if (!stub) throw new Error('the no-browser stub could not be written');
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = env[pathKey] ? stub + path.win32.delimiter + env[pathKey] : stub;
  if (tmp) {
    try { fs.mkdirSync(tmp, { recursive: true }); } catch { /* agy falls back to its own */ }
    for (const k of Object.keys(env)) if (k.toUpperCase() === 'TEMP' || k.toUpperCase() === 'TMP') delete env[k];
    env.TEMP = tmp; env.TMP = tmp;
  }
  // A Claude variable an agy agent has no use for (win32launch.childEnv writes it for a named account), in any spelling.
  require('./win32env').envDelete(env, 'CLAUDE_CONFIG_DIR');
  return env;
}

/* ---- killing a tree ---------------------------------------------------------------------- */

let treeKillFn = null;
function setTreeKill(fn) { treeKillFn = typeof fn === 'function' ? fn : null; }
/** Kill `child` and everything it started. Never throws. */
function killTree(child) {
  if (!child) return;
  if (treeKillFn) { try { treeKillFn(child); } catch { /* best effort */ } return; }
  const pid = child.pid;
  if (process.platform === 'win32' && Number.isInteger(pid)) {
    try {
      const k = spawn(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      k.on('error', () => { try { child.kill(); } catch { /* gone */ } });
      return;
    } catch { /* fall through */ }
  }
  try { child.kill('SIGKILL'); } catch { /* gone */ }
}

/* ---- is it signed in? -------------------------------------------------------------------- */

const MODELS_MS = 15000;
const SIGNED_OUT = /please sign in|not signed in|authentication required|launch the cli without arguments to sign in/i;

/* The run seam: (file, args, opts, done(err, stdout, stderr)). */
let execFn = null;
function setExec(fn) { execFn = typeof fn === 'function' ? fn : null; }

/**
 * `agy --gemini_dir=<dir> models`: signed out answers exit 1 "Please sign in to view available
 * models." in under a second, with no browser (measured). Signed in is exit 0 (UNPROVEN, read as
 * the plain opposite). Resolves { signedIn: true|false|null, because? }: null is "could not tell".
 */
function modelsCheck(bin, geminiDir, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let env;
    try { env = agyEnv(o.env || process.env, o.tmp); } catch { resolve({ signedIn: null, because: 'Kosmos could not make sure Antigravity would not open a browser, so it did not ask it' }); return; }
    const run = execFn || execFile;
    try {
      run(bin, ['--gemini_dir=' + geminiDir, 'models'], { env, cwd: o.cwd || undefined, timeout: MODELS_MS, windowsHide: true, maxBuffer: 256 * 1024 },
        (err, stdout, stderr) => {
          const text = String(stdout || '') + '\n' + String(stderr || '');
          if (SIGNED_OUT.test(text)) { resolve({ signedIn: false, because: 'Antigravity is not signed in to Google on this computer' }); return; }
          if (!err) { resolve({ signedIn: true }); return; }
          resolve({ signedIn: null, because: 'Antigravity did not answer whether it is signed in' });
        });
    } catch { resolve({ signedIn: null, because: 'Antigravity could not be started' }); }
  });
}

/* ---- one turn ---------------------------------------------------------------------------- */

/**
 * The argv for one turn. Pure. Global flags first (Go's flag package stops at the first
 * non-flag), the message glued to --print so it is one element and never a flag.
 */
function turnArgs(opts) {
  const o = opts || {};
  const a = ['--gemini_dir=' + String(o.geminiDir), '--print=' + String(o.message), '--output-format', 'json',
    '--dangerously-skip-permissions'];
  if (o.sessionId) a.push('--conversation', String(o.sessionId));
  if (o.model) a.push('--model', String(o.model));
  return a;
}

/* The last JSON object on its own line in `text`, or null. */
function lastJson(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t || t[0] !== '{') continue;
    try { const v = JSON.parse(t); if (v && typeof v === 'object') return v; } catch { /* not one line */ }
  }
  return null;
}

/** Read a turn's output. Pure. { response, sessionId, error, signedOut }. */
function parseTurn(stdout, stderr) {
  const ev = lastJson(stdout) || lastJson(stderr) || {};
  const response = typeof ev.response === 'string' ? ev.response.trim() : '';
  const sessionId = typeof ev.conversation_id === 'string' && ev.conversation_id ? ev.conversation_id : null;
  let error = null;
  if (typeof ev.error === 'string' && ev.error) error = ev.error;
  else if (ev.error && typeof ev.error.message === 'string') error = ev.error.message;
  else if (String(ev.status || '').toUpperCase() === 'ERROR') error = 'Antigravity reported an error';
  const all = String(stdout || '') + '\n' + String(stderr || '');
  const signedOut = /authentication required|authentication failed or timed out/i.test(all);
  return { response, sessionId, error, signedOut };
}

const LOST_CONVERSATION = /conversation[^\n]{0,60}(not found|does not exist|unknown|invalid)|no such conversation/i;
/* 60 s is agy's own sign-in wait; a turn that is still going after this long is killed, tree and
   all. Generous, because a real turn does real work (the Mac pane has no limit at all). */
const TURN_MS = 60000 + 45 * 60000;

let spawnFn = null;
function setSpawn(fn) { spawnFn = typeof fn === 'function' ? fn : null; }

/**
 * Run one turn. Never rejects. The surface is win32keyed.runKeyedTurn's, so win32codexsup drives it
 * the same way. `opts.name` names the agent (its own agy home); `opts.env` is the turn environment.
 * Before the turn: the agent's folder is pre-trusted in ITS home (agytrust), and `agy models` is
 * asked whether it is signed in, so a signed-out agent answers at once instead of waiting 60 s.
 */
function runAgyTurn(opts) {
  const o = opts || {};
  const home = o.home || agentHome(o.name);
  const keep = o.sessionId || null;
  return (async () => {
    try { fs.mkdirSync(home.geminiDir, { recursive: true }); } catch { /* agy makes it */ }
    if (o.cwd) {
      try { (o.trust || require('./agytrust').trustAgyFolder)(o.cwd, { home: home.root }); } catch { /* agy may ask; visible as a failed turn */ }
    }
    if (!o.skipSignInCheck) {
      const s = await modelsCheck(o.bin, home.geminiDir, { env: o.env, tmp: home.tmp, cwd: o.cwd });
      if (s.signedIn === false) {
        return { ok: false, sessionId: keep, signedOut: true,
          error: 'Antigravity is not signed in on this computer. Sign in with Google in Kosmos (Settings, AI Models, Gemini), then send the message again' };
      }
    }
    let env;
    try { env = agyEnv(o.env || process.env, home.tmp); }
    catch { return { ok: false, sessionId: keep, error: 'Kosmos could not make sure Antigravity would not open a browser, so the turn did not run' }; }
    return new Promise((resolve) => {
      let child;
      try {
        child = (spawnFn || spawn)(o.bin, turnArgs({ geminiDir: home.geminiDir, message: o.message, sessionId: keep, model: o.model }), {
          cwd: o.cwd || process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) { resolve({ ok: false, sessionId: keep, error: 'spawn: ' + ((e && e.code) || 'unknown') }); return; }
      /* A stop kills the whole tree, not just agy (its language server outlives a plain kill). */
      const plainKill = typeof child.kill === 'function' ? child.kill.bind(child) : null;
      child.kill = () => { killTree(Object.assign({}, { pid: child.pid, kill: plainKill })); return true; };
      if (typeof o.onSpawn === 'function') { try { o.onSpawn(child); } catch { /* the caller's problem */ } }
      let out = ''; let err = '';
      if (child.stdout) child.stdout.on('data', (d) => { if (out.length < 4e6) out += String(d); });
      if (child.stderr) child.stderr.on('data', (d) => { if (err.length < 1e6) err += String(d); });
      let settled = false;
      const finish = (r) => { if (!settled) { settled = true; clearTimeout(cap); resolve(r); } };
      const cap = setTimeout(() => {
        child.kill();
        finish({ ok: false, sessionId: keep, error: 'Antigravity was still going after ' + Math.round((o.turnMs || TURN_MS) / 60000) + ' minutes, so Kosmos stopped that turn' });
      }, o.turnMs || TURN_MS);
      if (cap.unref) cap.unref();
      child.on('error', (e) => finish({ ok: false, sessionId: keep, error: 'spawn: ' + ((e && e.code) || 'unknown') }));
      child.on('close', (code) => {
        const p = parseTurn(out, err);
        if (code === 0 && !p.error) { finish({ ok: true, response: p.response, sessionId: p.sessionId || keep }); return; }
        const why = p.signedOut ? 'Antigravity is not signed in on this computer' : (p.error || err.trim().split(/\r?\n/).slice(-2).join('; '));
        const lost = !!keep && LOST_CONVERSATION.test(why + '\n' + err);
        finish({
          ok: false,
          sessionId: keep && !lost ? keep : null,
          resetSession: !keep || lost,
          signedOut: p.signedOut || undefined,
          response: p.response,
          error: 'exit ' + code + (why ? '; ' + String(why).slice(0, 300) : ''),
        });
      });
    });
  })().catch((e) => ({ ok: false, sessionId: keep, error: 'the Antigravity turn threw (' + ((e && e.code) || 'unknown') + ')' }));
}

/**
 * The turn environment, from the one win32launch.childEnv built (token, `kosmos` on PATH, the
 * PowerShell policy the agent's `kosmos reply` needs). agy's own additions (the stub, TEMP) are
 * made per run by agyEnv. KOSMOS_PER_TURN as for Gemini and Grok (#4012).
 */
function turnEnv(base) {
  const env = Object.assign({}, base || {});
  require('./win32env').envDelete(env, 'CLAUDE_CONFIG_DIR');
  env.KOSMOS_PER_TURN = '1';
  return env;
}

module.exports = {
  RUNNER, SWITCH_ENV, SWITCH_FILE, switchOn, switchFile, setSwitchForTests, setRootForTests,
  agentHome, signinHome, stubDir, agyEnv, STUB_BODY, killTree, setTreeKill, modelsCheck, setExec,
  turnArgs, parseTurn, runAgyTurn, turnEnv, setSpawn, TURN_MS, SIGNED_OUT,
};
