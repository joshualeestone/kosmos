'use strict';

/**
 * #4043: put Kosmos's report hook into an Antigravity (agy) agent's `.agents/hooks.json`, so agy
 * tells the board what it is doing (bin/agy-report-bridge.js), instead of the card saying
 * "Can't tell". Run by bin/agent-supervisor.sh before every agy launch, beside agytrust.js, and
 * (#4353) by engine/agyrefresh.js at board start for agy agents already running without it; that
 * caller writes the Working/Idle hooks only, except that repairing a broken entry which already
 * had the tool hooks keeps them:
 *
 *   node agyhooks.js <workdir> <node binary> <bridge script> [agy --version output]
 *
 * 📌 agy's hooks (its shipped docs, and measured live 2026-09-26): `<workspace>/.agents/hooks.json`
 * maps a hook NAME to its events. Kosmos owns exactly one name, `kosmos-report`; every other name in
 * the file is the person's and is kept as it is. Handlers run with `sh -c`, so each path is
 * single-quoted (the support folder is under "Application Support", which has a space).
 *
 * ⚠️ BEST EFFORT, NEVER DESTRUCTIVE. A hooks.json that is not a JSON object is left untouched (the
 * card then says "Can't tell" as before, and the reason goes to stderr, the agent log). The write
 * is atomic (a temp file renamed over it) and happens only when the Kosmos entry changed. Exit 0
 * always: a hook we could not write must never stop the agent launching.
 */

const fs = require('node:fs');
const path = require('node:path');

const HOOK_NAME = 'kosmos-report';
/* Seconds agy gives a handler; the bridge itself gives up well inside it (STDIN + TIMEOUT_MS + a 500ms flush). */
const HANDLER_TIMEOUT_S = 5;
/* The oldest agy whose tool hooks are safe to write (its changelog, read from the 1.2.11 binary):
   before 1.0.16 an empty PreToolUse decision failed the tool with "unknown pre-tool hook decision",
   which would break ask_question itself; before 1.1.9 PostToolUse fired on every step and
   ignored its matcher, a node start per step. 1.1.9 covers both. */
const MIN_TOOL_HOOKS = [1, 1, 9];

/** `x.y.z` (or `x.y`, read as x.y.0) out of `agy --version` output, or null when there is none. */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

/** Whether the ask_question tool hooks may be written. An unknown version is NO: a missing tool
    hook costs only the needs_you report, while a wrong one can break the agent's question. */
function toolHooksSafe(versionText) {
  const v = parseVersion(versionText);
  if (!v) return false;
  for (let i = 0; i < 3; i += 1) {
    if (v[i] !== MIN_TOOL_HOOKS[i]) return v[i] > MIN_TOOL_HOOKS[i];
  }
  return true;
}

/** A path quoted for `sh -c`: single quotes, with any single quote closed, escaped, reopened. */
function shQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** The inverse, kept beside it (#4353): the words shQuote made, in order, from a handler command
    such as `'<node>' '<bridge>' Stop`. Unquoted words are skipped. */
function shUnquoteAll(cmd) {
  return [...String(cmd || '').matchAll(/'((?:[^']|'\\'')*)'/g)].map((m) => m[1].replace(/'\\''/g, "'"));
}

/** The Kosmos entry: PreInvocation reports working (it fires before every model call, which
    follows every tool, so it is also the heartbeat), Stop reports idle, and PreToolUse/PostToolUse
    are hooked for agy's ask_question tool ONLY (needs_you while it waits for the person, working
    once answered). No other tool is hooked: a hook per tool is a node start inside agy's blocking
    loop, and PreToolUse is agy's permission gate: the bridge answers `{"decision":"allow"}` there ONLY when the
    payload's tool is ask_question, and `{"decision":"ask"}` (agy's own prompt) for anything else or a missing
    payload. A missing or empty decision is a DENY on agy 1.2.11 (measured live, #4043's 0.7.01 regression).
    ⚠️ Unix only: `sh -c` quoting. agy runs hooks with `cmd /c` on Windows, where Kosmos does not
    run agy agents yet; only the bash supervisor calls this.
    `withToolHooks` false (an agy older than MIN_TOOL_HOOKS, or one whose version is unknown) leaves
    the two tool groups out: the card still gets working and idle. */
function kosmosEntry(nodeBin, bridge, withToolHooks = true) {
  const handler = (event) => ({ type: 'command', command: `${shQuote(nodeBin)} ${shQuote(bridge)} ${event}`, timeout: HANDLER_TIMEOUT_S });
  const entry = {
    PreInvocation: [handler('PreInvocation')],
    Stop: [handler('Stop')],
  };
  if (!withToolHooks) return entry;
  return {
    ...entry,
    /* #4043 (Gemini-Sub's spec): agy's ask_question stops the turn for the person; report it as
       needs_you, and working again once answered. Matched to that one tool only. */
    PreToolUse: [{ matcher: '^ask_question$', hooks: [handler('PreToolUse')] }],
    PostToolUse: [{ matcher: '^ask_question$', hooks: [handler('PostToolUse')] }],
  };
}

/**
 * The git work tree `dir` is inside, or null. Found by walking up for a `.git` entry (a folder, or a
 * file in a worktree or submodule), with no git binary: git under launchd can be a shim that fails
 * (the Xcode licence), and a failing check must not read as "not a repository".
 */
/* The real path, or for a path that does not exist yet (a .agents not made yet) its nearest existing
   ancestor's real path plus the rest: /var is /private/var on a Mac, and the ceiling is compared real. */
function realOrResolved(p) {
  let d = path.resolve(String(p));
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(d), ...rest); } catch { /* not there yet */ }
    const up = path.dirname(d);
    if (up === d) return path.resolve(String(p));
    rest.unshift(path.basename(d));
    d = up;
  }
}
function gitRootOf(dir, stopAt) {
  let d = realOrResolved(dir);
  /* Kosmos's own workers folder is the ceiling for the folders under it: a repository ABOVE it (a
     person's `~/.git`) says nothing about Kosmos's agent folders and must not blank every card. */
  const ceiling = stopAt ? realOrResolved(stopAt) : null;
  const under = ceiling && (d === ceiling || d.startsWith(ceiling + path.sep));
  for (;;) {
    try { fs.lstatSync(path.join(d, '.git')); return d; } catch { /* not here */ }
    if (under && d === ceiling) return null;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/* Kosmos's workers folder (store.workersRootFor, the same answer create.workersDir gives), or null. A
   supervisor whose environment lacks a non-default root gets the default: the full walk then runs,
   which can only refuse more, never less. */
function workersRoot() {
  try { return require('./store').workersRootFor(process.env, require('node:os').homedir()); } catch { return null; }
}

/* Replace `target` with `body`, keeping its mode, through a temp file removed on failure (agytrust's). */
function writeKeepingMode(target, body) {
  let mode = 0o644;
  try { mode = fs.statSync(target).mode & 0o777; } catch { /* a new file */ }
  const tmp = `${target}.kosmos-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, body, { mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* never created */ }
    throw err;
  }
}

/**
 * Make `<workdir>/.agents/hooks.json` carry the current Kosmos entry.
 *
 * 🛑 NEVER IN A GIT PROJECT. An agent Kosmos created lives in its own folder, but an agent it found
 * (discover.js) is recorded with the person's own folder, often a repository. Kosmos's entry holds
 * this Mac's absolute node and bridge paths: committed there (a team's tracked hooks.json, or a
 * `git add .` of a new one) it ships a hook that fails with 127 on every teammate's machine, and on
 * this one after Kosmos is gone. So a folder inside a git work tree is left alone and that agent's
 * card keeps saying "Can't tell", with the reason in the agent log.
 * The person's `enabled` flag on Kosmos's entry is kept: turning our hook off must stick. It is the
 * ONLY key of theirs that survives there; anything else they add to `kosmos-report` is replaced on the
 * next launch (their own hooks belong under their own names, which are never touched).
 * A symlinked hooks.json is written through to its target, keeping the link and the file's mode. Returns
 * { ok, changed, why } plus, when ok, `enabled` (the entry is on); never throws.
 */
function ensureHooks(workdir, nodeBin, bridge, withToolHooks = true) {
  if (!workdir || !nodeBin || !bridge) return { ok: false, changed: false, why: 'missing workdir, node or bridge' };
  const ceiling = workersRoot();
  const repo = gitRootOf(workdir, ceiling);
  if (repo) return { ok: false, changed: false, why: workdir + ' is inside the git project ' + repo + ', so Kosmos does not put its hook there (it would be committed with this Mac\'s paths)' };
  const dir = path.join(workdir, '.agents');
  const link = path.join(dir, 'hooks.json');
  let file = link;
  let isLink = false;
  try { isLink = fs.lstatSync(link).isSymbolicLink(); } catch { /* absent */ }
  if (isLink) {
    try { file = fs.realpathSync.native(link); } catch { return { ok: false, changed: false, why: link + ' is a link to a file that is gone, so it was left alone' }; }
  }
  /* Where the write actually lands (through a linked hooks.json or a linked .agents) gets the same
     check: a dotfiles repo behind a link is still a repository. */
  const targetRepo = gitRootOf(path.dirname(file), ceiling);
  if (targetRepo) return { ok: false, changed: false, why: file + ' is inside the git project ' + targetRepo + ', so Kosmos does not put its hook there' };
  let current = {};
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (!err || err.code !== 'ENOENT') return { ok: false, changed: false, why: 'could not read ' + file + ': ' + (err && err.message) };
  }
  if (raw !== null && raw.trim() !== '') {
    try { current = JSON.parse(raw); } catch {
      return { ok: false, changed: false, why: file + ' is not valid JSON, so it was left as it is' };
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return { ok: false, changed: false, why: file + ' is not a JSON object, so it was left as it is' };
    }
  }
  const want = kosmosEntry(nodeBin, bridge, withToolHooks);
  const had = current[HOOK_NAME];
  if (had && typeof had === 'object' && typeof had.enabled === 'boolean') want.enabled = had.enabled;
  /* Same entry whatever order its keys are in (the person's `enabled` may sit anywhere), so an
     unchanged file is never rewritten or reordered. */
  const same = had && typeof had === 'object' && !Array.isArray(had)
    && Object.keys(had).length === Object.keys(want).length
    && Object.keys(want).every((k) => JSON.stringify(had[k]) === JSON.stringify(want[k]));
  /* #4417: `enabled` says whether Kosmos's own entry is on (the person may have switched it off); a switch outside
     this entry (an agy-wide setting) is not seen here. The supervisor
     sends a launch-time idle only for a hook that is in place AND on: without it nothing ever corrects that idle. */
  const on = want.enabled !== false;
  if (same) return { ok: true, changed: false, why: null, enabled: on };
  const next = { ...current, [HOOK_NAME]: want };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeKeepingMode(file, JSON.stringify(next, null, 2) + '\n');
  } catch (err) {
    return { ok: false, changed: false, why: 'could not write ' + file + ': ' + (err && err.message) };
  }
  return { ok: true, changed: true, why: null, enabled: on };
}

if (require.main === module) {
  const [workdir, nodeBin, bridge, agyVersion] = process.argv.slice(2);
  const tools = toolHooksSafe(agyVersion);
  if (!tools) {
    process.stderr.write('agyhooks: agy ' + (parseVersion(agyVersion) ? parseVersion(agyVersion).join('.') : 'version unknown')
      + ' is older than ' + MIN_TOOL_HOOKS.join('.') + ' or unknown, so the ask_question hooks are left out (working and idle still report)\n');
  }
  const r = ensureHooks(workdir, nodeBin, bridge, tools);
  if (!r.ok) process.stderr.write('agyhooks: ' + r.why + '\n');
  /* #4417: stdout says `hooked` only when the hook is in place and on; the supervisor reads it to decide whether to send
     a launch-time idle. Anything else (a git project, a file left alone, the entry off) prints nothing. */
  if (r.ok && r.enabled) fs.writeSync(1, 'hooked\n');   // sync: process.exit next could drop an async pipe write
  process.exit(0);
}

module.exports = { HOOK_NAME, HANDLER_TIMEOUT_S, MIN_TOOL_HOOKS, parseVersion, toolHooksSafe, gitRootOf, shQuote, shUnquoteAll, kosmosEntry, ensureHooks };
