'use strict';

/**
 * Prepare a Gemini agent's settings.json at birth (#3296): the auth pre-seed
 * that skips the interactive first-run auth picker, and the five lifecycle hooks
 * that make the agent self-report to the board. This is the Gemini analog of
 * engine/reporthook.js (the Claude report-hook merge) fused with the codex
 * trust/pre-accept writes -- one module because gemini needs BOTH written into the
 * SAME file before launch, and two writers of one file is this codebase's
 * most-shipped defect.
 *
 * ⚠️ MERGE-ONLY, NEVER CLOBBER -- the same posture as reporthook.js: a person's
 * real gemini configuration is preserved (mode from birth, unparseable files left
 * alone with a sentence, an ephemeral path never written into a durable file, and
 * a second run is a no-op). This settings file is the agent's home config; an
 * installer that eats it is worse than a board that scrapes.
 *
 * ⚠️ ZERO ENGINE DEPENDENCIES beyond node builtins, deliberately: create.js
 * calls this at birth and passes every path, so nothing here resolves a home.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/* The auth pre-seed: gemini reads security.auth.selectedType and, when it is the
   `gemini-api-key` constant AND GEMINI_API_KEY is in the env, boots straight to
   the prompt instead of the multi-step onboarding picker (which would render the
   key in plaintext into a scraped pane). `Requires restart: Yes`, so it must be
   written BEFORE launch. Measured from the bundled gemini-cli. */
const AUTH_TYPE = 'gemini-api-key';

/* The lifecycle events wired to the report bridge, and the state each one means.
   Gemini's hook event names are its OWN (measured: "Stop" is REJECTED by the
   CLI); these five are the ones that map cleanly to the report vocabulary. The
   bridge itself decides the state from hook_event_name -- this list only says
   which events fire it. */
const HOOK_EVENTS = Object.freeze([
  'SessionStart', 'BeforeAgent', 'Notification', 'AfterAgent', 'SessionEnd',
]);

/* The dedup key: any command containing this stem is "ours". Matching on the
   script STEM (not the full command) means a future change to the command text --
   a flag, a different node path -- will not stack a second entry beside an older
   one; the cost is that such a change needs its own migration, stated here so
   nobody discovers it. Same doctrine as reporthook.js's MARKER. */
const MARKER = 'gemini-report-bridge';

/* The command gemini runs for a hook. Gemini executes a command hook as a SHELL
   STRING (measured: it spawns the shell with the command as the last arg), so
   this is the posix shell form `node "<bridge>"` -- the analog of reporthook.js's
   `bash "<script>"`. `node` rather than an absolute runtime: the gemini CLI is
   itself a `#!/usr/bin/env node` script, so a pane that launched gemini has node
   on PATH by construction, and the pane inherits that PATH for the hook. */
function commandFor(bridgePath) {
  return 'node "' + bridgePath + '"';
}

/* Refuse a bridge path carrying a character that would break out of, or execute
   inside, the double-quoted shell command. LOAD-BEARING: the command is a shell
   string. Same set and reasoning as reporthook.js's posix arm. A non-string is
   unsafe rather than throwing. */
function unsafeForCommand(s) {
  if (typeof s !== 'string') return true;
  return /["\\$`\r\n]/.test(s);
}

function entryIsOurs(entry) {
  return !!(entry && Array.isArray(entry.hooks)
    && entry.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(MARKER)));
}

/* One event's desired definition: a single command hook running the bridge. The
   shape matches gemini's hook schema (`{ hooks: [{ type, command }] }` under an
   event name), identical to Claude Code's. */
function definitionFor(bridgePath) {
  return { hooks: [{ type: 'command', command: commandFor(bridgePath) }] };
}

/**
 * Ensure the auth pre-seed and the five report hooks are present in the gemini
 * settings file. Idempotent and merge-only. Returns { prepared:true, changed } or
 * { prepared:false, because } in a sentence -- never throws for an expected shape,
 * because the caller (create.js at birth) fails soft: a settings file it could
 * not prepare costs the agent a self-report / a first-run picker, not its
 * existence, which is the pre-#3296 world, not a corruption.
 */
function ensurePrepared(settingsPath, bridgePath, opts) {
  const o = opts || {};
  if (!bridgePath) return { prepared: false, because: 'the gemini report bridge is not on this machine' };
  if (unsafeForCommand(bridgePath)) {
    return { prepared: false, because: 'the bridge path contains characters we will not embed in a command' };
  }
  /* #1582 class (from reporthook.js): a durable, SHARED settings file must not be
     pointed at an ephemeral path. During a release cut the bridge can resolve to a
     path inside the cut's temp sandbox that genuinely exists and is gone the moment
     the cut ends. Refuse to persist an ephemeral bridge path into a durable
     settings file; leave a fully-ephemeral setup (test fixtures put both under
     temp) alone. os.tmpdir() returns the UNRESOLVED /var/folders form on macOS
     while paths reaching a settings file are the RESOLVED /private/var form, so
     compare against both. */
  {
    const rawTmp = os.tmpdir();
    let realTmp = rawTmp;
    try { realTmp = fs.realpathSync(rawTmp); } catch { /* keep the raw value */ }
    const underRoot = (p, root) => typeof p === 'string' && (p === root || p.startsWith(root + path.sep));
    const bridgeEphemeral = underRoot(bridgePath, rawTmp) || underRoot(bridgePath, realTmp);
    const settingsDurable = typeof settingsPath === 'string'
      && !underRoot(settingsPath, rawTmp) && !underRoot(settingsPath, realTmp);
    if (bridgeEphemeral && settingsDurable) {
      return { prepared: false, because: 'the bridge path is under the temp root, which is ephemeral, so it was not written into the durable settings file' };
    }
  }

  let target = settingsPath;
  try {
    target = fs.realpathSync(target);
  } catch {
    /* Absent is the clean case -- unless the path itself is a dangling symlink:
       writing over that severs somebody's dotfiles arrangement. */
    try { if (fs.lstatSync(target).isSymbolicLink()) return { prepared: false, because: 'that settings file is a link pointing at nothing, which is somebody’s arrangement to fix, not ours to replace' }; }
    catch { /* truly absent */ }
  }

  let data = {};
  let prevMode = null;
  try {
    const st = fs.statSync(target);
    prevMode = st.mode & 0o7777;
    if (st.size > 0) {
      data = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { prepared: false, because: 'that settings file is not the shape we expect, so it was left alone' };
      }
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') { /* absent is the clean case */ }
    else return { prepared: false, because: 'that settings file could not be read as JSON, so it was left alone' };
  }

  let changed = false;

  /* The auth pre-seed. Merge into security.auth.selectedType without disturbing
     any other security/auth field a person set. Only written when it is not
     already that value, so a second run is a no-op. */
  if (!data.security || typeof data.security !== 'object' || Array.isArray(data.security)) data.security = {};
  if (!data.security.auth || typeof data.security.auth !== 'object' || Array.isArray(data.security.auth)) data.security.auth = {};
  if (data.security.auth.selectedType !== AUTH_TYPE) {
    data.security.auth.selectedType = AUTH_TYPE;
    changed = true;
  }

  /* The five report hooks. Same idempotent/repoint logic as reporthook.js: an
     event already carrying OUR entry at the current bridge path is left alone; an
     entry that is ours but aimed at a DIFFERENT bridge path is repointed (so a
     moved install heals); anything that is not ours is untouched. */
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) data.hooks = {};
  const wantCommand = commandFor(bridgePath);
  const sameHook = (def) => !!(def && Array.isArray(def.hooks)
    && def.hooks.some((h) => h && h.type === 'command' && h.command === wantCommand));
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(data.hooks[event]) ? data.hooks[event] : [];
    const mine = existing.filter(entryIsOurs);
    if (mine.length) {
      if (mine.some(sameHook)) continue; // already ours and already correct
      data.hooks[event] = existing.map((e) => (entryIsOurs(e) ? definitionFor(bridgePath) : e));
      changed = true;
      continue;
    }
    data.hooks[event] = existing.concat([definitionFor(bridgePath)]);
    changed = true;
  }

  if (!changed) return { prepared: true, changed: false };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    /* Pid-suffixed staging like reporthook.js: a concurrent birth writing the
       same shared default-home settings file must not share a temp name. The
       rename stays atomic; this keeps two writers from clobbering each other's
       staging file mid-write. */
    const tmp = target + '.kosmos.' + process.pid + '.new';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', prevMode !== null ? { mode: prevMode } : {});
    if (prevMode !== null) fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch {
    return { prepared: false, because: 'we could not save the settings file' };
  }
  return { prepared: true, changed: true };
}

module.exports = { AUTH_TYPE, HOOK_EVENTS, MARKER, commandFor, unsafeForCommand, entryIsOurs, ensurePrepared };
