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
   need their own migration, which is stated here so nobody discovers it.

   #570: the STEM, not `kosmos-report-hook.sh`, so ONE dedup key matches both
   the posix hook (`bash ".../kosmos-report-hook.sh"`) and the native-win32 hook
   (the node entry `kosmos-report-hook.js` beside this module) -- the win32 bundle
   carries no bash. Widening `.sh` -> the stem is backward-compatible: every
   already-wired `.sh` command still contains the stem, so a machine that had the
   old hook reads as ours and is repointed/kept exactly as before. The stem is
   specific enough that nothing else matches.

   ⚠️ WHERE the stem rides differs by win32 form: in the OLD win32 SHELL form it
   was inside the command string (`"<node>" ".../kosmos-report-hook.js"`); in the
   #570 EXEC form the command is the bare node executable and the stem is in
   args[0]. entryIsOurs checks BOTH the command and args for exactly this reason,
   so an old win32 shell-form entry is still recognized and repointed to exec. */
const MARKER = 'kosmos-report-hook';

/**
 * Where the hook script is, from where THIS module is: installed, engine/
 * sits beside bin/ inside app/; on a source checkout, engine/ sits beside
 * install/. Probed, not assumed, the clipath way; null when neither exists
 * rather than a guess that fails at fire time.
 *
 * #570 -- PLATFORM-AWARE. On native win32 the posix hook cannot run (the
 * Windows bundle carries no bash, gate-(b)), so the hook is the node entry
 * `kosmos-report-hook.js` that sits beside THIS module -- in `app/engine/` when
 * installed (the Windows bundle's engine glob ships it) and in `engine/` on a
 * source checkout, so a single `__dirname`-relative resolve finds it in both.
 * `platform` is injectable so the branch is unit-testable off a real Windows box.
 */
function hookScriptPath(platform) {
  const plat = platform || process.platform;
  if (plat === 'win32') {
    const js = path.resolve(__dirname, 'kosmos-report-hook.js');
    return fs.existsSync(js) ? js : null;
  }
  const installed = path.resolve(__dirname, '..', 'bin', 'kosmos-report-hook.sh');
  if (fs.existsSync(installed)) return installed;
  const source = path.resolve(__dirname, '..', 'install', 'kosmos-report-hook.sh');
  if (fs.existsSync(source)) return source;
  return null;
}

/**
 * The hook command Claude Code runs, per platform. posix: `bash "<script>"`
 * (SHELL FORM -- the value rides inside a double-quoted sh command).
 *
 * win32 (#570): EXEC FORM -- `{ command: <node>, args: [<script>] }`. When
 * `args` is present Claude Code spawns `command` as an executable directly, with
 * NO shell involved, each arg passed verbatim; the `shell` field is ignored. So
 * the win32 hook fires identically whether or not Git Bash is present. That is
 * the point: Claude Code's Windows hook shell "defaults to bash, or to powershell
 * when Git Bash isn't installed" (docs), and the OLD win32 shell form
 * (`"<node>" "<script>"`) is a bash-shaped string a PowerShell fallback would
 * echo rather than execute (a leading quoted token is expression-mode) -- so on a
 * stock Windows box the hook process would fire and deliver nothing. Exec form
 * removes the shell from the path entirely, which is what a state source that
 * must never silently go dark needs. (See the unsafeForCommand note and #570; the
 * one-run box check is: does exec form fire all seven events under a no-Git-Bash
 * PowerShell default.)
 *
 * `node` is the bundled runtime/node.exe on a win32 install, so no path is
 * resolved from HOME, keeping this module's zero-dependency contract. Both
 * `platform` and `node` are injectable so the branch is unit-testable; they
 * default to the running process.
 */
function entryFor(scriptPath, opts) {
  const o = opts || {};
  const plat = o.platform || process.platform;
  if (plat === 'win32') {
    const node = o.node || process.execPath;
    return {
      matcher: '',
      hooks: [{ type: 'command', command: node, args: [scriptPath], timeout: 15 }],
    };
  }
  return {
    matcher: '',
    hooks: [{ type: 'command', command: 'bash "' + scriptPath + '"', timeout: 15 }],
  };
}

/**
 * True when a path holds a character we refuse to embed in the hook command
 * for that platform.
 *
 * posix (SHELL FORM -- the value rides inside a double-quoted `bash` command in
 * sh): a quote, backslash, dollar or backtick would break out of or execute
 * inside the command, so all are refused. This is LOAD-BEARING: the posix hook is
 * a shell string, so injection through the path is a real hazard.
 *
 * win32: as of the #570 exec-form change entryFor emits `{ command:<node>,
 * args:[<script>] }`, which Claude Code spawns with NO shell involved and each
 * arg passed VERBATIM. So on win32 there is no shell to break out of and path
 * injection is not possible -- this guard is now DEFENSIVE / belt-and-suspenders
 * for the win32 path, not load-bearing. It is kept unchanged (`["%$`\r\n]`)
 * rather than relaxed, in the codebase's stated "over-refuse, never under-refuse;
 * degrading to scraping is the safe direction" posture: a real Windows path
 * carrying one of these is extraordinarily rare, and refusing it degrades to
 * scraping rather than writing something wrong. A backslash is ALLOWED on win32
 * (the ordinary separator; the posix `\\` would refuse every real path), which is
 * safe here because nothing is being parsed as a shell string at all.
 *
 * 🔑 HISTORY, so the reasoning is not re-derived: this set was once built for an
 * unknown Windows shell (cmd.exe ∪ PowerShell superset), then re-derived for bash
 * after the box measured Claude Code running the hook through Git Bash
 * (2026-09-07). Both of those framings assumed SHELL FORM. The exec-form change
 * makes the win32 shell moot -- which is exactly why it also closes the bigger
 * open question below.
 *
 * ✅ RESOLVED by exec form (was: "STILL OPEN"): the old worry was that if Claude
 * Code needs an external bash to run ANY hook command, a stock Windows box with no
 * Git for Windows might run no hooks at all. The docs answer it -- the hook shell
 * "defaults to bash, or to powershell when Git Bash isn't installed", so a shell
 * always exists -- and exec form removes the dependency regardless, since `args`
 * spawns the executable directly with no shell. The residual is narrower and
 * box-checkable, not architectural: confirm exec form fires all seven events under
 * a no-Git-Bash PowerShell default. See #570.
 *
 * Type-safe: a non-string is unsafe rather than throwing on `.test`.
 *
 * A raw CR/LF is refused on BOTH platforms, though the win32 arm no longer runs
 * through a shell so the mechanism differs: on posix (shell form) an embedded
 * newline in sh would start a new command; on win32 (exec form) nothing parses
 * the arg as a shell command, so CR/LF cannot inject, but a newline in a hook
 * path is still meaningless and refusing it stays in the "over-refuse, never
 * under-refuse" direction. No legitimate hook path contains one either way.
 */
function unsafeForCommand(s, plat) {
  if (typeof s !== 'string') return true;
  if (plat === 'win32') return /["%$`\r\n]/.test(s);
  return /["\\$`\r\n]/.test(s);
}

function entryIsOurs(entry) {
  /* The marker rides in the command for the posix shell-form hook
     (`bash ".../kosmos-report-hook.sh"`) AND for the OLD win32 shell form
     (`"<node>" ".../kosmos-report-hook.js"`), but in `args` for the #570 win32
     EXEC form (command is the bare node executable; the script path is args[0]).
     Checking both keeps a machine that carries the old win32 shell-form entry
     recognized as ours -- so ensureWired REPOINTS it to exec form rather than
     stacking a second entry beside it. */
  return !!(entry && Array.isArray(entry.hooks)
    && entry.hooks.some((h) => h && (
      (typeof h.command === 'string' && h.command.includes(MARKER))
      || (Array.isArray(h.args) && h.args.some((a) => typeof a === 'string' && a.includes(MARKER)))
    )));
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
function ensureWired(settingsPath, scriptPath, opts) {
  if (!scriptPath) return { wired: false, because: 'the reporting hook script is not on this machine' };
  const o = opts || {};
  const plat = o.platform || process.platform;
  /* On win32 the entry carries a second path -- the node executable (as the
     exec-form `command`) -- so the guard below vets it too. It defaults to the
     node doing the wiring (the bundled runtime/node.exe on a win32 install), the
     same source entryFor uses; injectable for tests. Null off win32, where the
     entry carries only the script (bash + the script). */
  const node = plat === 'win32' ? (o.node || process.execPath) : null;
  /* Vet both paths for characters we refuse to put in a hook entry
     (unsafeForCommand). On POSIX this is LOAD-BEARING: the path rides inside a
     double-quoted `bash` command, so a quote/backslash/dollar/backtick could
     break out of or execute inside it. On win32 the #570 exec form passes each
     path VERBATIM as an argv element with no shell, so injection is not possible
     there -- the guard is defensive/over-refusal only (kept unchanged in the
     safe direction: a rare real Windows path with one of these degrades to
     scraping rather than writing something wrong). backslash is dangerous in sh
     but is the ordinary win32 separator, so the set is platform-specific. setup.sh
     refuses similar characters for the profile write, keeping the pair consistent
     (Angel's review). On win32 BOTH the script path and the node path are vetted. */
  if (unsafeForCommand(scriptPath, plat) || (node !== null && unsafeForCommand(node, plat))) {
    return { wired: false, because: 'the hook command path contains characters we will not embed in a command' };
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
    /* Type-safe on purpose: this module never throws for an expected shape,
       and both callers fail soft. A non-string settingsPath must NOT throw
       here -- it falls through to the read below, which answers with a
       sentence. underRoot returns false for a non-string rather than calling
       .startsWith on it (#1582 review). */
    const underRoot = (p, root) => typeof p === 'string' && (p === root || p.startsWith(root + path.sep));
    /* #570: the win32 entry carries TWO paths (node as the exec-form command,
       script as args[0]), so BOTH must be vetted -- a durable settings file
       pointing at an ephemeral runtime/node.exe is the same #1582 defect as
       pointing at an ephemeral script. `node` is null off win32, where the entry
       carries only the script. */
    const scriptEphemeral = underRoot(scriptPath, rawTmp) || underRoot(scriptPath, realTmp)
      || (node !== null && (underRoot(node, rawTmp) || underRoot(node, realTmp)));
    /* Durable = a real settings path that is NOT under temp. A null/undefined
       settingsPath is neither durable nor ephemeral here, so the refusal does
       not fire and the downstream read handles the malformed input. */
    const settingsDurable = typeof settingsPath === 'string'
      && !underRoot(settingsPath, rawTmp) && !underRoot(settingsPath, realTmp);
    /* Coupling this fix relies on, verified against the cut scripts (#1582
       review): the sandbox is created with `mktemp -d` (test-install.sh:56)
       and `${TMPDIR:-/tmp}/kosmos-release.XXXXXX` (release.sh:350), both under
       $TMPDIR, and the setup Node process shares that $TMPDIR -- so os.tmpdir()
       here names the same root the ephemeral script lives under. */
    if (scriptEphemeral && settingsDurable) {
      return { wired: false, because: 'a hook command path is under the temp root, which is ephemeral, so it was not written into the durable settings file' };
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
  const want = entryFor(scriptPath, { platform: plat, node }).hooks[0];
  /* Compare the FULL desired shape, not just the command: the #570 win32 exec
     form carries its script path in `args`, so a command-only check would read
     an OLD win32 shell-form entry (same node in the command, no args) as already
     correct and never repoint it. Normalizing a missing `args` to null makes the
     posix shell form (no args) compare equal to itself. */
  const sameHook = (h) => !!(h && h.command === want.command
    && JSON.stringify(h.args === undefined ? null : h.args)
       === JSON.stringify(want.args === undefined ? null : want.args));
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(data.hooks[event]) ? data.hooks[event] : [];
    const mine = existing.filter(entryIsOurs);
    if (mine.length) {
      /* Already ours and already correct: leave it completely alone, so a
         second run is a no-op and a person's timeout or matcher edits survive. */
      if (mine.some((e) => e.hooks.some(sameHook))) continue;
      /* Ours, but aimed at another copy. Replace only OUR entries; anything
         else in this event's list is somebody else's hook and is untouched. */
      data.hooks[event] = existing.map((e) => (entryIsOurs(e) ? entryFor(scriptPath, { platform: plat, node }) : e));
      changed = true;
      continue;
    }
    data.hooks[event] = existing.concat([entryFor(scriptPath, { platform: plat, node })]);
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

module.exports = { HOOK_EVENTS, MARKER, hookScriptPath, entryFor, unsafeForCommand, entryIsOurs, ensureWired };
