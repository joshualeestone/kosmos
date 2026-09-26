'use strict';
/**
 * Driving ONE Gemini or Grok turn on Windows, headless -- the codex analog for the two
 * API-key runners (#3296 Gemini, #3391 Grok).
 *
 * 🛑 WHY PER TURN, LIKE CODEX, AND NOT AN INTERACTIVE PANE LIKE THE MAC. On the Mac both
 * run as an interactive TUI in a tmux pane (bin/agent-supervisor.sh) and are typed at.
 * Windows has no pane and no pty: a Windows agent is a child the supervisor holds pipes
 * to. Neither CLI speaks claude's stream-json on stdin, but both have a documented
 * single-turn headless mode with a pinned, resumable session id, which is exactly the
 * shape `win32codex` drives codex in. MEASURED on a Windows 11 box, 2026-09-25, with
 * the pinned builds (gemini 0.61.0 on Kosmos's node, grok 1.0.41 win32-x64):
 *
 *   gemini --prompt=<msg> -o json --approval-mode yolo --skip-trust -m <model>
 *          (--session-id <uuid> | --resume <uuid>)
 *      prints ONE (pretty-printed) JSON object: { session_id, response?, error? }.
 *      With no key it answers the auth error; with a bad key it reaches Google's API
 *      and prints Google's refusal. A --resume of a session with no answered turn
 *      exits 42 with "No previous sessions found" on stderr.
 *   grok --single=<msg> --output-format json --permission-mode bypassPermissions
 *        --always-approve --trust -m <model> (--session-id <uuid> | --resume <uuid>)
 *      prints ONE pretty-printed object `{ text, stopReason, sessionId, usage, .. }` on
 *      success (measured with a real key) and a `{"type":"error","message":..}` line on
 *      failure. With a bad XAI_API_KEY it probes xAI and answers "Not signed in".
 *
 * Both were then run end to end with real keys on the box: a turn answered, a second
 * turn resumed the same conversation and recalled a word from the first, and the
 * agent's own `kosmos reply` landed on a throwaway board.
 *
 * The autonomy flags are the Mac's own (agent-supervisor.sh): gemini `--approval-mode
 * yolo --skip-trust`, grok `--permission-mode bypassPermissions --always-approve
 * --trust`, and the same default models (gemini-2.5-flash, grok-4.6). The message goes
 * in the `--flag=value` form so a message that starts with a dash is never read as a
 * flag (measured: both CLIs take it). No shell is involved anywhere: the message is one
 * argv element, and Gemini's .cmd launcher is bypassed for node on its bundle
 * (runners.spawnTarget).
 *
 * 🔑 THE CONVERSATION ID IS OURS. Both CLIs take a caller-chosen UUID for a NEW session,
 * so the first turn mints one and later turns resume it. The id is kept only once a turn
 * has succeeded: a failed first turn (no key yet, say) may leave a half-made session, and
 * resuming that fails (gemini exits 42), so the next turn starts clean with a new id.
 *
 * 🔑 THE ACCOUNT, THE WAY THE MAC SUPERVISOR CARRIES IT (turnEnv): the key from the
 * account's own mode-600 file, then the machine-wide secrets/env door; a Grok
 * SUBSCRIPTION account gets NO XAI_API_KEY at all (grok would use it instead of the
 * sign-in; an empty value still counts). The key rides in the child's environment and
 * is never logged or put on a command line.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runners = require('./runners');

const KEYED_RUNNERS = Object.freeze(['gemini', 'grok']);
const DEFAULT_MODEL = Object.freeze({ gemini: 'gemini-2.5-flash', grok: 'grok-4.6' });
/* The env var each CLI reads its API key from (the Mac supervisor's names). */
const KEY_VAR = Object.freeze({ gemini: 'GEMINI_API_KEY', grok: 'XAI_API_KEY' });

function isKeyedRunner(runner) { return KEYED_RUNNERS.includes(String(runner || '')); }

/**
 * The argv for one turn (after runners.spawnTarget's prefix). Pure.
 * @param {'gemini'|'grok'} runner
 * @param {{ message: string, model?: string, sessionId?: string, newSessionId?: string }} opts
 *   `sessionId` resumes; otherwise `newSessionId` names the new session.
 */
function turnArgs(runner, opts) {
  const o = opts || {};
  const model = o.model ? String(o.model) : DEFAULT_MODEL[runner];
  const session = o.sessionId ? ['--resume', String(o.sessionId)] : ['--session-id', String(o.newSessionId)];
  if (runner === 'gemini') {
    return ['--prompt=' + String(o.message), '-o', 'json', '--approval-mode', 'yolo', '--skip-trust', '-m', model, ...session];
  }
  if (runner === 'grok') {
    return ['--single=' + String(o.message), '--output-format', 'json',
      '--permission-mode', 'bypassPermissions', '--always-approve', '--trust', '-m', model, ...session];
  }
  throw new Error('not a keyed runner: ' + runner);
}

/* Every JSON object in `text`: each line that parses on its own (grok), and each block from a
   line that is just `{` to the next line that is just `}` (gemini pretty-prints one object over
   many lines, and on an API failure prints it to STDERR among a stack trace, measured). */
function jsonObjects(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try { const v = JSON.parse(t); if (v && typeof v === 'object') out.push(v); } catch { /* not one line */ }
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() !== '{') continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trimEnd() !== '}') continue;
      try { const v = JSON.parse(lines.slice(i, j + 1).join('\n')); if (v && typeof v === 'object') out.push(v); } catch { /* not a whole object */ }
      i = j;
      break;
    }
  }
  return out;
}

/**
 * Read a turn's stdout. Pure.
 * @returns {{ response: string, sessionId: string|null, error: string|null }}
 */
function parseTurn(runner, stdout) {
  let response = '';
  let sessionId = null;
  let error = null;
  for (const ev of jsonObjects(stdout)) {
    if (runner === 'gemini') {
      if (typeof ev.session_id === 'string' && ev.session_id) sessionId = ev.session_id;
      if (typeof ev.response === 'string') response = ev.response;
      if (ev.error) error = typeof ev.error.message === 'string' ? ev.error.message : 'the Gemini turn reported an error';
    } else if (runner === 'grok') {
      /* MEASURED with a real key (grok 1.0.41, Windows, 2026-09-25): a turn prints ONE
         pretty-printed object `{ text, stopReason, sessionId, usage, ... }`. The claude-shaped
         `{type:'result', result, session_id}` line found in the binary is read too, in case a
         build prints that instead. */
      if (typeof ev.sessionId === 'string' && ev.sessionId) sessionId = ev.sessionId;
      if (typeof ev.text === 'string' && ev.type === undefined) response = ev.text;
      if (typeof ev.session_id === 'string' && ev.session_id) sessionId = ev.session_id;
      if (ev.type === 'result') {
        if (typeof ev.result === 'string') response = ev.result;
        if (ev.is_error === true) error = typeof ev.result === 'string' && ev.result ? ev.result : 'the Grok turn reported an error';
      }
      if (ev.type === 'error') error = typeof ev.message === 'string' ? ev.message : 'the Grok turn reported an error';
    }
  }
  return { response: response.trim(), sessionId, error };
}

/* A resume the CLI says it cannot find. The id is dropped so the next turn starts a new
   conversation rather than failing the same way forever. */
const LOST_SESSION = /no previous sessions found|invalid session identifier|session[^\n]{0,40}not found|no session/i;

/* The spawn seam. Tests replace it; nothing else does. Mirrors win32codex.setSpawn. */
let spawnFn = null;
function setSpawn(fn) { spawnFn = typeof fn === 'function' ? fn : null; }
function spawner() { return spawnFn || spawn; }

/**
 * Run one turn and resolve with its result. Never rejects. The surface is
 * win32codex.runCodexTurn's, so the per-turn supervisor drives all three the same way.
 *
 * @param {object} opts
 * @param {'gemini'|'grok'} opts.runner
 * @param {string}   opts.bin         the runner (grok.exe, or Gemini's gemini.cmd launcher)
 * @param {string}   opts.message
 * @param {string}  [opts.sessionId]  the conversation to resume
 * @param {string}  [opts.model]
 * @param {string}  [opts.cwd]
 * @param {object}  [opts.env]        the full child environment (turnEnv)
 * @param {string}  [opts.platform]   seam for runners.spawnTarget
 * @returns {Promise<{ ok: boolean, response?: string, sessionId: string|null,
 *                     resetSession?: boolean, error?: string }>}
 *   `sessionId` is the conversation the NEXT turn should resume, or null to start fresh.
 */
function runKeyedTurn(opts) {
  return new Promise((resolve) => {
    const o = opts || {};
    const runner = String(o.runner || '');
    const resuming = Boolean(o.sessionId);
    const newSessionId = resuming ? null : (o.newSessionId || crypto.randomUUID());
    let args;
    try { args = turnArgs(runner, { message: o.message, model: o.model, sessionId: o.sessionId, newSessionId }); }
    catch (e) { return resolve({ ok: false, error: String((e && e.message) || e), sessionId: o.sessionId || null }); }
    const target = runners.spawnTarget(o.bin, o.platform || process.platform);
    let child;
    try {
      child = spawner()(target.file, target.args.concat(args), {
        cwd: o.cwd || process.cwd(),
        env: o.env || process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) { return resolve({ ok: false, error: 'spawn: ' + ((e && e.message) || 'unknown'), sessionId: o.sessionId || null }); }
    if (typeof o.onSpawn === 'function') { try { o.onSpawn(child); } catch { /* the caller's problem */ } }
    let out = '';
    let err = '';
    if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('data', (d) => { out += String(d); });
    if (child.stderr && typeof child.stderr.on === 'function') child.stderr.on('data', (d) => { err += String(d); });
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    child.on('error', (e) => finish({ ok: false, error: 'spawn: ' + ((e && e.message) || 'unknown'), sessionId: o.sessionId || null }));
    child.on('close', (code) => {
      /* stdout first, then stderr: gemini prints its error object on stderr when the API refuses. */
      const parsed = parseTurn(runner, out + '\n' + err);
      if (code === 0 && !parsed.error) {
        /* Resume this conversation next time: the id the CLI printed, else the one we named. */
        return finish({ ok: true, response: parsed.response, sessionId: parsed.sessionId || o.sessionId || newSessionId });
      }
      const why = parsed.error || err.trim().split(/\r?\n/).filter((l) => !/^\s+at /.test(l)).slice(-3).join('; ');
      const lost = resuming && LOST_SESSION.test(why + '\n' + err);
      finish({
        ok: false,
        /* A failed FIRST turn keeps no id (its session may be half-made); a failed resume keeps
           its id unless the CLI said that conversation is gone. */
        sessionId: resuming && !lost ? o.sessionId : null,
        resetSession: !resuming || lost,
        response: parsed.response,
        error: `exit ${code}${why ? '; ' + String(why).slice(0, 300) : ''}`,
      });
    });
  });
}

/* The first line of a file, trimmed, or null. Never throws. */
function firstLine(file) {
  try { return String(fs.readFileSync(file, 'utf8')).split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

/* The auth type that means "use GEMINI_API_KEY" (geminisettings.AUTH_TYPE, the Mac's value). */
const KEY_AUTH = 'gemini-api-key';

/* The auth type a gemini settings file chooses, or null (absent, unreadable, or unset). */
function selectedAuth(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const t = s && s.security && s.security.auth && s.security.auth.selectedType;
    return typeof t === 'string' && t ? t : null;
  } catch { return null; }
}

/* The Kosmos-owned gemini home for an account whose own settings choose a Google login: under
   the board's data, one per account. Null if the data root cannot be named (the turn then runs
   in the account's home and, with NO_BROWSER, fails loudly instead). */
function defaultKeyHome(configDir) {
  try {
    const label = configDir ? path.basename(String(configDir)).replace(/[^A-Za-z0-9._-]/g, '_') : 'default';
    return path.join(require('./store').ROOT, 'gemini-key-home', label);
  } catch { return null; }
}

/* Make <home>/.gemini/settings.json choose the key. Only ever a home Kosmos owns. True when it
   is in place. Never throws. */
function pinKeyAuth(home) {
  const file = path.join(home, '.gemini', 'settings.json');
  if (selectedAuth(file) === KEY_AUTH) return true;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ security: { auth: { selectedType: KEY_AUTH } } }, null, 2) + '\n');
    return true;
  } catch { return false; }
}

/**
 * The environment for a Gemini or Grok turn, from the one win32launch.childEnv built
 * (token, `kosmos` on PATH, child markers stripped, the account dir in the runner's own
 * variable). Returns a NEW object; never throws; never logs the key.
 *
 * @param {'gemini'|'grok'} runner
 * @param {object} base        the childEnv result
 * @param {string|null} configDir  the account dir (null: the default account)
 * @param {object} [deps]      seams: { geminiAccounts, grokAccounts, doorDir, homeDir, keyHome }
 */
function turnEnv(runner, base, configDir, deps) {
  const d = deps || {};
  const env = Object.assign({}, base || {});
  /* childEnv writes CLAUDE_CONFIG_DIR for any named account, a Claude variable a Gemini or
     Grok agent has no use for (and Grok's claude-compat layer reads). */
  delete env.CLAUDE_CONFIG_DIR;
  const doorDir = d.doorDir !== undefined ? d.doorDir : (() => {
    try { return require('./tokendoor').DIR; } catch { return null; }
  })();
  const door = doorDir ? firstLine(path.join(doorDir, KEY_VAR[runner])) : null;
  if (runner === 'gemini') {
    const mod = d.geminiAccounts || require('./geminiaccounts');
    const dir = configDir || mod.defaultDir();
    const key = firstLine(mod.keyFile(dir));
    if (key) env.GEMINI_API_KEY = key;
    else if (door) env.GEMINI_API_KEY = door;
    /* 🛑 AN AGENT GIVEN A KEY USES THE KEY, AND NEVER SITS WAITING ON A GOOGLE LOGIN. gemini
       takes its auth type from settings.json BEFORE it looks at GEMINI_API_KEY, and the
       default account's settings are the person's own ~/.gemini: anyone who once chose
       "Login with Google" in the gemini CLI has selectedType oauth-personal there. MEASURED
       (gemini 0.61.0, this box, 2026-09-26): with that setting and a key in the env, a
       headless turn ignores the key and stops at "Opening authentication page in your
       browser. Do you want to continue? [Y/n]" on a stdin we never write to, with no
       timeout, so the agent looks alive and never answers. For an agent WITH a key:
         - a settings file that chose something else sends this agent to a home of Kosmos's
           own that pins the key. The person's file is never edited (geminisettings.js's
           never-clobber rule). A system or workspace settings file cannot do this: gemini
           ignores a system file a user can write, and takes no auth from a workspace (both
           measured).
         - NO_BROWSER, so a path we did not foresee exits at once (41, "Manual authorization
           is required ...") instead of waiting on that prompt.
       An agent with NO key is left exactly as it was: the person's own Google login in the
       gemini CLI stays theirs to use. */
    if (env.GEMINI_API_KEY) {
      env.NO_BROWSER = 'true';
      const home = env.GEMINI_CLI_HOME || d.homeDir || os.homedir();
      const chosen = selectedAuth(path.join(home, '.gemini', 'settings.json'));
      if (chosen && chosen !== KEY_AUTH) {
        const keyHome = d.keyHome !== undefined ? d.keyHome : defaultKeyHome(configDir);
        if (keyHome && pinKeyAuth(keyHome)) env.GEMINI_CLI_HOME = keyHome;
      }
    }
    return env;
  }
  if (runner === 'grok') {
    const mod = d.grokAccounts || require('./grokaccounts');
    const dir = configDir || mod.defaultDir();
    /* The Mac exports the default account's dir as GROK_HOME too, so the dir judged here is
       the dir grok reads. */
    env.GROK_HOME = String(dir);
    /* Run only its own hooks, not the machine's Claude Code ones (agent-supervisor.sh). */
    env.GROK_CLAUDE_HOOKS_ENABLED = '0';
    let kind = null;
    try { const who = mod.identityOf(dir); kind = who ? who.authMode : null; } catch { kind = null; }
    if (kind === 'subscription') { delete env.XAI_API_KEY; return env; }
    const key = firstLine(mod.keyFile(dir));
    if (key) env.XAI_API_KEY = key;
    else if (door) env.XAI_API_KEY = door;
    return env;
  }
  return env;
}

module.exports = {
  KEYED_RUNNERS, DEFAULT_MODEL, KEY_VAR, isKeyedRunner,
  turnArgs, parseTurn, runKeyedTurn, turnEnv, setSpawn,
};
