'use strict';

/**
 * Wiring the Layer 1 reporting hook into a Claude Code settings.json (#561).
 *
 * The hook script (install/kosmos-report-hook.sh, staged to app/bin/ in the
 * bundle) is what makes #526's verb speak: Claude Code fires it on the
 * events in HOOK_EVENTS (seven report events), plus PostToolUseFailure on a Claude Code new enough (#6071)
 * and it runs `kosmos report` (`kosmos tool-failed` for PostToolUseFailure). This module is THE ONE merge
 * implementation that wires those entries into a settings file --
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
const securewrite = require('./securewrite');

const HOOK_EVENTS = Object.freeze([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'Stop', 'StopFailure', 'SessionEnd',
]);

/* #6071: events wired only for a Claude Code new enough to know them, each with the first version that does.
   PostToolUseFailure (a failed tool call) writes no report; the hook sends a digest of the failure to the board
   (`kosmos tool-failed`).
   🛑 WHY IT IS GATED: Claude Code before 2.1.0 validates `hooks` as a record keyed by its own event list, and on a
   validation failure its settings loader returns null, so the WHOLE file is dropped (every hook and permission in
   the person's own settings, not just ours). Measured from npm-packed cli.js: 1.0.100 .. 2.0.50 have no
   PostToolUseFailure, 2.1.0 has it; 2.1.296 logs an unknown event as "entry ignored" instead. So: wired when the
   version is known and new enough; left out when it is unknown (nothing counted, nothing broken); and taken back
   out (ours only) when the version is known and older, since that file is already being dropped. */
const VERSIONED_EVENTS = Object.freeze({ PostToolUseFailure: '2.1.0' });

/* a >= b for dotted numeric versions ("2.1.296" vs "2.1.0"); false when either is not one. */
function versionAtLeast(a, b) {
  const pa = /^(\d+)\.(\d+)\.(\d+)/.exec(String(a || ''));
  const pb = /^(\d+)\.(\d+)\.(\d+)/.exec(String(b || ''));
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i += 1) {
    if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]);
  }
  return true;
}

/* The events to wire for this Claude Code version: the seven, plus each versioned event the version is known to
   support. An unknown version (null, unparseable) gets the seven only. */
function eventsFor(claudeVersion) {
  return HOOK_EVENTS.concat(Object.keys(VERSIONED_EVENTS).filter((e) => versionAtLeast(claudeVersion, VERSIONED_EVENTS[e])));
}

/* `claude --version` ("2.1.296 (Claude Code)") -> "2.1.296", or null when it cannot be read. Cached per program
   (real path, size, mtime) so a prepare does not start a process every time and an upgrade is still seen; a failed
   read is kept as long, so a program that hangs costs one timeout per ten minutes. Synchronous, because prepare and
   setup are; hence the short timeout. On win32 the extensionless name resolveBin answers is tried as .exe too. */
const versionCache = new Map();
function claudeVersion(bin, opts) {
  if (!bin) return null;
  const plat = (opts && opts.platform) || process.platform;
  const tries = plat === 'win32' && !/\.[A-Za-z0-9]+$/.test(bin) ? [bin, bin + '.exe'] : [bin];
  for (const b of tries) {
    let key;
    try { const real = fs.realpathSync(b); const st = fs.statSync(real); key = [real, st.size, st.mtimeMs].join('\u0000'); }
    catch { continue; }   // not there under this spelling
    const hit = versionCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v;
    let v = null;
    try {
      const out = require('node:child_process').execFileSync(b, ['--version'],
        { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const m = /(\d+\.\d+\.\d+)/.exec(String(out || ''));
      v = m ? m[1] : null;
    } catch { v = null; }
    // Said once per program and ten minutes (the cache), so "is D1 counting here?" can be read from the log.
    if (!v) console.error('[reporthook] could not read the version of ' + path.basename(b) + ', so PostToolUseFailure is not wired for it');
    versionCache.set(key, { v, at: Date.now() });
    return v;
  }
  return null;
}

/* The OLDEST version among the claude programs in `bins` that exist (each counted once, by real path), or null when
   none exists or any one that exists cannot be read. For a settings file more than one Claude Code reads: the
   default ~/.claude is read by the person's own claude too, which need not be the one Kosmos runs.
   `opts.versionOf` (real path -> version or null) replaces the reader, for tests. */
function oldestClaudeVersion(bins, opts) {
  const plat = (opts && opts.platform) || process.platform;
  const seen = new Set();
  let oldest = null;
  for (const bin of bins || []) {
    if (!bin) continue;
    /* On win32 every spelling is looked at: an npm install there is claude.cmd and claude.ps1 beside a bare sh shim. */
    const spellings = plat === 'win32' && !/\.[A-Za-z0-9]+$/.test(bin) ? [bin, bin + '.exe', bin + '.cmd', bin + '.ps1'] : [bin];
    for (const b of spellings) {
      let real;
      try { real = fs.realpathSync(b); } catch { continue; }   // not this spelling
      if (seen.has(real)) continue;
      seen.add(real);
      // A .cmd or .ps1 cannot be run without a shell, so its version is unknown, and so is the answer.
      if (/\.(cmd|ps1)$/i.test(real)) return null;
      const v = (opts && typeof opts.versionOf === 'function' ? opts.versionOf : claudeVersion)(real, opts);
      if (!v) return null;
      if (oldest === null || !versionAtLeast(v, oldest)) oldest = v;
    }
  }
  return oldest;
}

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
 * True when a command path is under the temp root and the settings file is
 * NOT: an ephemeral path about to be written into a durable file. Shared by
 * every writer of a Claude settings file (the report hooks here, the
 * statusline in allowance.js), so the #1582 refusal has one copy. The comment
 * inside is the refusal's history, moved here unchanged from ensureWired.
 */
function ephemeralMismatch(settingsPath, commandPaths) {
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
  const rawTmp = os.tmpdir();
  let realTmp = rawTmp;
  try { realTmp = fs.realpathSync(rawTmp); } catch { /* keep the raw value */ }
  /* Type-safe on purpose: this module never throws for an expected shape,
     and its callers fail soft. A non-string settingsPath must NOT throw
     here: this answers false, and the caller's readSettings answers it with
     a sentence. underRoot returns false for a non-string rather than calling
     .startsWith on it (#1582 review). */
  const underRoot = (p, root) => typeof p === 'string' && (p === root || p.startsWith(root + path.sep));
  /* #570: every path the command will carry is vetted, not just the script:
     the win32 report hook also carries node (the exec-form command), and a
     durable settings file pointing at an ephemeral runtime/node.exe is the
     same #1582 defect as pointing at an ephemeral script. The caller passes
     them all in commandPaths. */
  const scriptEphemeral = (commandPaths || []).some((p) => underRoot(p, rawTmp) || underRoot(p, realTmp));
  /* Durable = a real settings path that is NOT under temp. A null/undefined
     settingsPath is neither durable nor ephemeral here, so this answers false
     and the caller's readSettings handles the malformed input. */
  const settingsDurable = typeof settingsPath === 'string'
    && !underRoot(settingsPath, rawTmp) && !underRoot(settingsPath, realTmp);
  /* Coupling this fix relies on, verified against the cut scripts (#1582
     review): the sandbox is created with `mktemp -d` (test-install.sh:56)
     and `${TMPDIR:-/tmp}/kosmos-release.XXXXXX` (release.sh:350), both under
     $TMPDIR, and the setup Node process shares that $TMPDIR -- so os.tmpdir()
     here names the same root the ephemeral script lives under. */
  return scriptEphemeral && settingsDurable;
}

/**
 * Read a Claude settings file for a merge-only write. Returns
 * { target, data, prevMode } or { because } in a sentence: the target is the
 * realpath (so a symlinked dotfile is written through, not replaced), a
 * dangling link or a non-object is refused, and absent is the clean case.
 */
function readSettings(settingsPath) {
  let target = settingsPath;
  try {
    target = fs.realpathSync(target);
  } catch {
    /* Absent is the clean case -- unless the path itself is a dangling
       symlink: writing over that severs somebody's dotfiles arrangement. */
    try { if (fs.lstatSync(target).isSymbolicLink()) return { because: 'that settings file is a link pointing at nothing, which is somebody’s arrangement to fix, not ours to replace' }; }
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
        return { because: 'that settings file is not the shape we expect, so it was left alone' };
      }
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') { /* absent is the clean case */ }
    else return { because: 'that settings file could not be read as JSON, so it was left alone' };
  }
  return { target, data, prevMode };
}

/**
 * Write a merged settings object back atomically, keeping the file's mode.
 * True on success. Shared with allowance.js for the same reason as above.
 */
function writeSettings(target, data, prevMode) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    /* #5434: through securewrite.writeSecret (unique temp per process, thread, start and write, so two
       concurrent writers never share one; the reason this was pid-suffixed). Flushed before the rename.
       An existing file keeps its mode where the file system allows a chmod; a new one takes the umask
       default (null, umaskDefault). atomicOnly: a failed save leaves the file as it was. ownTempsOnly: in a folder
       Kosmos does not own, only this file's own dead temps are reaped. See the slice-3 plan. */
    securewrite.writeSecret(target, JSON.stringify(data, null, 2) + '\n', prevMode, { atomicOnly: true, ownTempsOnly: true, umaskDefault: true });
  } catch {
    return false;
  }
  return true;
}

/**
 * Merge the seven hook entries (plus the versioned ones `opts.claudeVersion` supports, #6071) into one settings.json. Idempotent: an event
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
  /* #1582: the fifth refusal (ephemeralMismatch above carries its history). */
  if (ephemeralMismatch(settingsPath, node !== null ? [scriptPath, node] : [scriptPath])) {
    return { wired: false, because: 'a hook command path is under the temp root, which is ephemeral, so it was not written into the durable settings file' };
  }
  const read = readSettings(settingsPath);
  if (read.because) return { wired: false, because: read.because };
  const { target, data, prevMode } = read;
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
  /* Compare the FULL desired shape, not just the command. The case a command-only
     check would MISS is a STALE win32 EXEC-form entry: command already equals the
     current node.exe but args[0] is an OLD script path still carrying the marker
     (so entryIsOurs matches it). command-only would see the matching command,
     call it already-correct, and never repoint the stale args -- the #1467
     "aimed at another copy" defect in exec-form clothing. (An OLD shell-form
     entry, by contrast, has command `"<node>" "<script>"`, which already differs
     from the bare-node target, so command-only would repoint THAT one fine -- it
     is not the case this widening protects.) Normalizing a missing `args` to null
     makes the posix shell form (no args) compare equal to itself, a no-op there. */
  const sameHook = (h) => !!(h && h.command === want.command
    && JSON.stringify(h.args === undefined ? null : h.args)
       === JSON.stringify(want.args === undefined ? null : want.args));
  /* #6071: a versioned event the known version is too old for is taken back out (ours only; a person's own entry for
     it is theirs to keep). Unknown version: left exactly as it is. */
  for (const event of Object.keys(VERSIONED_EVENTS)) {
    if (!/^\d+\.\d+\.\d+/.test(String(o.claudeVersion || '')) || versionAtLeast(o.claudeVersion, VERSIONED_EVENTS[event])) continue;
    if (!Array.isArray(data.hooks[event]) || !data.hooks[event].some(entryIsOurs)) continue;
    const rest = data.hooks[event].filter((e) => !entryIsOurs(e));
    if (rest.length) data.hooks[event] = rest; else delete data.hooks[event];
    changed = true;
  }
  for (const event of eventsFor(o.claudeVersion)) {
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
  if (!writeSettings(target, data, prevMode)) return { wired: false, because: 'we could not save the settings file' };
  return { wired: true, changed: true };
}

/**
 * #5999: take ONE install's report hooks back out of a Claude settings file (the Windows uninstall; #5998's
 * setup.sh step is the Mac and Linux one, and its matching rules are these). A hook is this install's when it carries
 * the marker AND that same string (the command, or an arg) names a path inside one of `roots`. Windows paths: matched
 * without case and with either separator, and a root counts only at the start of the string or right after a quote
 * or a space, so C:\Kosmos2 is not inside C:\Kosmos and D:\x\C:\Kosmos is not either. Everything else in the file
 * stays: another install's hooks, a person's own, and a person's hook that shares an entry with ours (the entry is
 * kept with theirs alone). An event left empty is removed, and `hooks` too when nothing is left in it.
 * `gone` (a function): when given, a hook carrying the marker whose script is provably gone is removed too, whatever
 * folder it names. An added account keeps the folder Kosmos ran from when it was added, and nothing repoints it after
 * a move. Ours by the marker and already broken, so taking it out only takes out an error. `gone(path)` must be true
 * only for a path that is certainly not there (goneOnDisk below: not found, never "could not look").
 * `dryRun` only says whether the file holds any. Returns { ours, dead, changed, unreadable?, because? } (`dead`: how
 * many of the hooks taken out were broken ones outside `roots`; `unreadable`: the file is not settings Kosmos can
 * read, so a retry cannot change it); never throws for a shape.
 * The caller holds the #3088 lock (filelock.withFileLock) around this, as wireDefaultHooks does around ensureWired.
 */
function unwireInstall(settingsPath, roots, opts) {
  const o = opts || {};
  const norm = (s) => String(s).replace(/\//g, '\\').toLowerCase();
  const prefixes = [...new Set((roots || []).filter((r) => typeof r === 'string' && r.trim())
    .map((r) => norm(r).replace(/\\+$/, '') + '\\'))];
  if (!prefixes.length) return { ours: false, dead: 0, changed: false, because: 'Kosmos could not tell which folder it was installed in' };
  const inside = (s) => {
    if (typeof s !== 'string') return false;
    const n = norm(s);
    return prefixes.some((root) => {
      for (let at = n.indexOf(root); at !== -1; at = n.indexOf(root, at + 1)) {
        if (at === 0 || /["'\s]/.test(n[at - 1])) return true;
      }
      return false;
    });
  };
  const carries = (s) => typeof s === 'string' && s.includes(MARKER) && inside(s);
  const inRoots = (h) => !!h && (carries(h.command) || (Array.isArray(h.args) && h.args.some(carries)));
  /* The script path a hook names: an arg carrying the marker (exec form), or the quoted or bare word of the command
     that carries it (the old shell form). */
  const scriptPaths = (h) => {
    const out = [];
    if (Array.isArray(h.args)) for (const a of h.args) if (typeof a === 'string' && a.includes(MARKER)) out.push(a);
    if (typeof h.command === 'string' && h.command.includes(MARKER)) {
      for (const m of h.command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
        const w = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
        if (w.includes(MARKER)) out.push(w);
      }
    }
    return out;
  };
  /* Only a string that is provably the script, at a provable place, can be judged gone: an absolute drive-letter path
     (a \\\\server path is never looked at, its server may be offline; a mapped drive letter still is, and a disconnected
     one can be slow to answer), with no %, $ or ~ (a shell would expand them; a ~ also turns away an 8.3 short name such as PROGRA~1, which only
     errs toward keeping), whose file name is the hook script itself,
     on a drive that is there now (an unplugged drive is not a deleted folder). Anything else is kept. */
  const provablyGone = (x) => {
    if (!/^[A-Za-z]:[\\/]/.test(x) || /[%$~]/.test(x)) return false;
    const base = x.split(/[\\/]/).pop();
    if (base !== MARKER + '.js' && base !== MARKER + '.sh') return false;
    try { return !o.gone(x.slice(0, 2) + '\\') && o.gone(x) === true; } catch { return false; }
  };
  const isDead = (h) => {
    if (typeof o.gone !== 'function' || !h) return false;
    const paths = scriptPaths(h);
    return paths.length > 0 && paths.every(provablyGone);
  };
  let dead = 0;
  const hookIsOurs = (h) => inRoots(h) || isDead(h);
  let target;
  try { target = fs.realpathSync(settingsPath); }
  catch { return { ours: false, dead: 0, changed: false }; }   // absent, or a link to nothing: nothing of ours in it
  const read = readSettings(target);
  if (read.because) {
    // Unreadable or not an object: never rewritten, only said, when it names this install's hook.
    let raw = '';
    try { raw = fs.readFileSync(target, 'utf8'); } catch { /* unreadable */ }
    return { ours: raw.includes(MARKER) && inside(raw.replace(/\\\\/g, '\\')), dead: 0, changed: false, unreadable: true, because: read.because };
  }
  const { data, prevMode } = read;
  const hooks = data.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return { ours: false, dead: 0, changed: false };
  let ours = false;
  for (const event of Object.keys(hooks)) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;
    const kept = [];
    let mine = false;
    for (const entry of list) {
      if (!entry || !Array.isArray(entry.hooks) || !entry.hooks.some(hookIsOurs)) { kept.push(entry); continue; }
      mine = true;
      dead += entry.hooks.filter((h) => !inRoots(h) && isDead(h)).length;
      const rest = entry.hooks.filter((h) => !hookIsOurs(h));
      if (rest.length) kept.push({ ...entry, hooks: rest });   // a person's hook shared our entry: theirs stays
    }
    if (!mine) continue;   // an event with nothing of ours is left exactly as it was
    ours = true;
    if (kept.length) hooks[event] = kept; else delete hooks[event];
  }
  if (!ours) return { ours: false, dead: 0, changed: false };
  if (o.dryRun) return { ours: true, dead, changed: false };
  if (Object.keys(hooks).length === 0) delete data.hooks;
  if (!writeSettings(target, data, prevMode)) return { ours: true, dead, changed: false, because: 'we could not save the settings file' };
  return { ours: true, dead, changed: true };
}

/** #5999: true only when `p` is certainly not there (not found); a path that could not be looked at (no permission,
    say) is not gone, so a hook naming it is kept. */
function goneOnDisk(p) {
  try { fs.statSync(p); return false; }
  catch (e) { return !!e && (e.code === 'ENOENT' || e.code === 'ENOTDIR'); }
}

module.exports = { HOOK_EVENTS, VERSIONED_EVENTS, versionAtLeast, eventsFor, claudeVersion, oldestClaudeVersion, MARKER, hookScriptPath, entryFor, unsafeForCommand, entryIsOurs, ensureWired,
  ephemeralMismatch, readSettings, writeSettings, unwireInstall, goneOnDisk };
