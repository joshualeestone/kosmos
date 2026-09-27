'use strict';

/**
 * #4043: put Kosmos's report hook into an Antigravity (agy) agent's `.agents/hooks.json`, so agy
 * tells the board what it is doing (bin/agy-report-bridge.js), instead of the card saying
 * "Can't tell". Run by bin/agent-supervisor.sh before every agy launch, beside agytrust.js:
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
/* Seconds agy gives a handler; the bridge itself gives up well inside it (TIMEOUT_MS + STDIN). */
const HANDLER_TIMEOUT_S = 5;
/* The oldest agy whose tool hooks are safe to write (its changelog, read from the 1.2.11 binary):
   before 1.0.16 an empty PreToolUse answer (our `{}`) failed the tool with "unknown pre-tool hook
   decision", which would break ask_question itself; before 1.1.9 PostToolUse fired on every step and
   ignored its matcher, a node start per step. 1.1.9 covers both. */
const MIN_TOOL_HOOKS = [1, 1, 9];

/** `x.y.z` out of `agy --version` output, or null when there is none. */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
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

/** The Kosmos entry: PreInvocation reports working (it fires before every model call, which
    follows every tool, so it is also the heartbeat), Stop reports idle, and PreToolUse/PostToolUse
    are hooked for agy's ask_question tool ONLY (needs_you while it waits for the person, working
    once answered). No other tool is hooked: a hook per tool is a node start inside agy's blocking
    loop, and PreToolUse is agy's permission gate (the bridge answers {} there: no decision).
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
 * Make `<workdir>/.agents/hooks.json` carry the current Kosmos entry. Returns
 * { ok, changed, why } and never throws.
 */
function ensureHooks(workdir, nodeBin, bridge, withToolHooks = true) {
  if (!workdir || !nodeBin || !bridge) return { ok: false, changed: false, why: 'missing workdir, node or bridge' };
  const dir = path.join(workdir, '.agents');
  const file = path.join(dir, 'hooks.json');
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
  if (JSON.stringify(current[HOOK_NAME]) === JSON.stringify(want)) return { ok: true, changed: false, why: null };
  const next = { ...current, [HOOK_NAME]: want };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.' + process.pid + '.new';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(file + '.' + process.pid + '.new', { force: true }); } catch { /* best effort */ }
    return { ok: false, changed: false, why: 'could not write ' + file + ': ' + (err && err.message) };
  }
  return { ok: true, changed: true, why: null };
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
  process.exit(0);
}

module.exports = { HOOK_NAME, HANDLER_TIMEOUT_S, MIN_TOOL_HOOKS, parseVersion, toolHooksSafe, shQuote, kosmosEntry, ensureHooks };
