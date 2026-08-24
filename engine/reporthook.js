'use strict';

/**
 * Wiring the Layer 1 reporting hook into a Claude Code settings.json (#561).
 *
 * The hook script (install/kosmos-report-hook.sh, staged to app/bin/ in the
 * bundle) is what makes #526's verb speak: Claude Code fires it on seven
 * events and it runs `kosmos report`. This module is THE ONE merge
 * implementation that wires those seven entries into a settings file --
 * required by `accounts.prepare` (an account dir is born with its hooks, the
 * #248 born-correct-or-not-born rule) and invoked by install/setup.sh
 * through the bundled node for the default `~/.claude` and every existing
 * account (updates re-run setup, so history is covered on every update).
 * One function under both callers, because two copies of one merge is this
 * codebase's most-shipped defect.
 *
 * ⚠️ ZERO ENGINE DEPENDENCIES, deliberately: `accounts` requires this
 * module, so this module requiring accounts would be a cycle. Every path
 * comes from the caller; nothing here resolves HOME.
 *
 * ⚠️ MERGE-ONLY, NEVER CLOBBER -- the same posture, edge for edge, as the
 * permission-acceptance merge in setup.sh (realpath through symlinks, the
 * dangling-symlink refusal, mode preserved from birth, unparseable files
 * left alone with a sentence). A settings.json carries a person's real
 * Claude Code configuration, and an installer that eats it to add a hook is
 * worse than a board that scrapes.
 */

const fs = require('node:fs');
const path = require('node:path');

const HOOK_EVENTS = Object.freeze([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'Stop', 'StopFailure', 'SessionEnd',
]);

/* The dedup key: any hook command containing this is "ours". Matching on
   the script NAME rather than the full command means a future change to
   the command text (a flag, a timeout) will not stack a second entry
   beside a hand-installed or older one -- the cost is that such changes
   need their own migration, which is stated here so nobody discovers it. */
const MARKER = 'kosmos-report-hook.sh';

/**
 * Where the hook script is, from where THIS module is: installed, engine/
 * sits beside bin/ inside app/; on a source checkout, engine/ sits beside
 * install/. Probed, not assumed, the clipath way; null when neither exists
 * rather than a guess that fails at fire time.
 */
function hookScriptPath() {
  const installed = path.resolve(__dirname, '..', 'bin', 'kosmos-report-hook.sh');
  if (fs.existsSync(installed)) return installed;
  const source = path.resolve(__dirname, '..', 'install', 'kosmos-report-hook.sh');
  if (fs.existsSync(source)) return source;
  return null;
}

function entryFor(scriptPath) {
  return {
    matcher: '',
    hooks: [{ type: 'command', command: 'bash "' + scriptPath + '"', timeout: 15 }],
  };
}

function entryIsOurs(entry) {
  return !!(entry && Array.isArray(entry.hooks)
    && entry.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(MARKER)));
}

/**
 * Merge the seven hook entries into one settings.json. Idempotent: an event
 * already carrying our entry is left exactly as it is (so a hand-installed
 * or older wiring is never doubled), and a partial wiring is completed
 * rather than restarted. Returns { wired:true, changed } or
 * { wired:false, because } in a sentence -- never throws for an expected
 * shape, because both callers fail soft on purpose (an account still gets
 * born, an install still finishes; the board falls back to scraping, which
 * is the pre-#526 world, not a corruption).
 */
function ensureWired(settingsPath, scriptPath) {
  if (!scriptPath) return { wired: false, because: 'the reporting hook script is not on this machine' };
  let target = settingsPath;
  try {
    target = fs.realpathSync(target);
  } catch {
    /* Absent is the clean case -- unless the path itself is a dangling
       symlink: writing over that severs somebody's dotfiles arrangement. */
    try { if (fs.lstatSync(target).isSymbolicLink()) return { wired: false, because: 'that settings file is a link pointing at nothing, which is somebody’s arrangement to fix, not ours to replace' }; }
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
        return { wired: false, because: 'that settings file is not the shape we expect, so it was left alone' };
      }
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') { /* absent is the clean case */ }
    else return { wired: false, because: 'that settings file could not be read as JSON, so it was left alone' };
  }
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) data.hooks = {};
  let changed = false;
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(data.hooks[event]) ? data.hooks[event] : [];
    if (existing.some(entryIsOurs)) continue;
    data.hooks[event] = existing.concat([entryFor(scriptPath)]);
    changed = true;
  }
  if (!changed) return { wired: true, changed: false };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.kosmos.new';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', prevMode !== null ? { mode: prevMode } : {});
    if (prevMode !== null) fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch {
    return { wired: false, because: 'we could not save the settings file' };
  }
  return { wired: true, changed: true };
}

module.exports = { HOOK_EVENTS, MARKER, hookScriptPath, entryFor, entryIsOurs, ensureWired };
