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
const os = require('node:os');

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
  /* The path is embedded in a double-quoted bash command; a quote,
     backslash, dollar or backtick in it would break the command or execute
     inside it. setup.sh refuses similar characters for the profile write,
     and this keeps the pair consistent (Angel's review). No real
     KOSMOS_HOME carries these; a hand-built one that does gets a sentence
     instead of a settings file that runs it. */
  if (/["\\$`]/.test(scriptPath)) {
    return { wired: false, because: 'the hook script path contains characters we will not embed in a command' };
  }
  /* #1582: the fifth refusal. hookScriptPath() correctly probes and, during
     a release cut, resolves an app/bin/kosmos-report-hook.sh that GENUINELY
     EXISTS inside the cut's temp sandbox -- so the value is right and
     ephemeral at once. Persisting it into a durable, SHARED settings file
     points every agent on the box at a directory that is gone the moment the
     cut ends (measured: four dead paths in one night, one per cut). The
     resolver is not the place to fix this; refusing to write an ephemeral
     path into a durable file is. Same shape as the four refusals around it.

     🛑 os.tmpdir() returns the UNRESOLVED /var/folders/... form while the
     paths that reach a settings file are the RESOLVED /private/var/... form,
     so startsWith(os.tmpdir()) alone never fires on macOS. Compare against the
     realpath (fallback to raw if realpath throws) AND the raw value, so a
     scriptPath in either form is caught. (Josh's card #1582 measured this
     trap: the obvious implementation is committed, reviewed, and never fires.)

     ⚠️ DELIBERATE REFINEMENT OF THE CARD'S LITERAL WORDING, flagged for review:
     the card says "refuse a path under the temp root", but its RATIONALE is "a
     DURABLE shared settings file must not point into an ephemeral tree". The
     literal form breaks the suite, whose fixtures put both the script AND the
     settings file under the temp root on purpose (test isolation) -- there an
     ephemeral script in an ephemeral settings file is no mismatch. So the
     refusal fires only when the script is ephemeral AND the settings file is
     NOT, which is exactly #1582's shape (~/.claude/settings.json given a
     cut-sandbox path) and leaves a fully-ephemeral setup alone. This matches
     the rationale precisely; a production settings file is never under temp. */
  {
    const rawTmp = os.tmpdir();
    let realTmp = rawTmp;
    try { realTmp = fs.realpathSync(rawTmp); } catch { /* keep the raw value */ }
    const underRoot = (p, root) => p === root || p.startsWith(root + path.sep);
    const scriptEphemeral = underRoot(scriptPath, rawTmp) || underRoot(scriptPath, realTmp);
    const settingsEphemeral = underRoot(settingsPath, rawTmp) || underRoot(settingsPath, realTmp);
    if (scriptEphemeral && !settingsEphemeral) {
      return { wired: false, because: 'the hook script path is under the temp root, which is ephemeral, so it was not written into the durable settings file' };
    }
  }
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
  /* 🛑 AN ENTRY OF OURS POINTING AT THE WRONG FILE IS NOT "ALREADY WIRED".
     `entryIsOurs` matches the FILENAME, which every copy of the script carries,
     so a hand-placed copy at some other path reads as correctly wired forever.
     Measured 2026-08-29 on this machine: seven entries pointed at a copy in
     ~/.claude/hooks/user from Aug 26, and `ensureWired` answered
     {wired: true, changed: false} against it -- SUCCESS, having changed
     nothing, for a script it had never seen. Control: the same call on a
     settings file with no hooks wrote all seven.

     ⇒ The product's self-healing path could not heal the one thing it exists
     to heal, and said it had. That is why #1467's stale hook survived every
     update: `setup.sh` re-runs this on every update and this loop skipped it.

     So: an entry that is OURS but names a different script is REPOINTED. It is
     ours by the marker, so replacing it is not clobbering somebody's
     configuration -- and leaving it is how a machine keeps running a hook
     nobody has looked at since August. */
  const wantCommand = entryFor(scriptPath).hooks[0].command;
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(data.hooks[event]) ? data.hooks[event] : [];
    const mine = existing.filter(entryIsOurs);
    if (mine.length) {
      /* Already ours and already correct: leave it completely alone, so a
         second run is a no-op and a person's timeout or matcher edits survive. */
      if (mine.some((e) => e.hooks.some((h) => h && h.command === wantCommand))) continue;
      /* Ours, but aimed at another copy. Replace only OUR entries; anything
         else in this event's list is somebody else's hook and is untouched. */
      data.hooks[event] = existing.map((e) => (entryIsOurs(e) ? entryFor(scriptPath) : e));
      changed = true;
      continue;
    }
    data.hooks[event] = existing.concat([entryFor(scriptPath)]);
    changed = true;
  }
  if (!changed) return { wired: true, changed: false };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    /* Pid-suffixed: a concurrent prepare and installer writing the same
       settings file must not share a temp name (Angel's review). The rename
       stays atomic either way; this only keeps the two writers from
       clobbering each other's staging file mid-write. */
    const tmp = target + '.kosmos.' + process.pid + '.new';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', prevMode !== null ? { mode: prevMode } : {});
    if (prevMode !== null) fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch {
    return { wired: false, because: 'we could not save the settings file' };
  }
  return { wired: true, changed: true };
}

module.exports = { HOOK_EVENTS, MARKER, hookScriptPath, entryFor, entryIsOurs, ensureWired };
