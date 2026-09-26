'use strict';

/**
 * Prepare a Grok agent's report hooks at birth (#3391): the lifecycle hooks that
 * make the agent self-report to the board with NO pane scraping. This is the Grok
 * analog of engine/geminisettings.js, with two grok-specific simplifications
 * measured against grok 1.0.41 on 2026-09-23:
 *
 *   1. NO AUTH PRE-SEED. Unlike gemini (which needs security.auth.selectedType so a
 *      launched agent boots past the first-run picker), interactive grok boots
 *      straight to the prompt with just XAI_API_KEY in the pane env ("Logged in with
 *      API key"), no config file required. The key reaches the pane via the generic
 *      secrets/env door, exactly as GEMINI_API_KEY does. So there is nothing to write
 *      for auth -- one fewer file, and no never-clobber-the-operator's-auth concern.
 *
 *   2. OUR OWN HOOK FILE, NOT A SHARED SETTINGS FILE. Grok merges every
 *      `$GROK_HOME/hooks/*.json`, so the report hooks live in a file WE own
 *      (kosmos-report-bridge.json), never merged into the operator's config. That
 *      removes the merge/repoint logic geminisettings needs (its hooks share the
 *      operator's settings.json): here the desired content fully defines our file, so
 *      "prepared" is a content-idempotent overwrite of our own file and the
 *      operator's other hook files are untouched by construction.
 *
 * ⚠️ Claude-compat is a SEPARATE concern handled at launch, not here: the supervisor
 * sets GROK_CLAUDE_HOOKS_ENABLED=0 so a grok agent does not also run the fleet's
 * ~/.claude hooks. This module only writes our own grok hook file.
 *
 * ⚠️ ZERO ENGINE DEPENDENCIES beyond node builtins, deliberately: create.js calls
 * this at birth and passes every path, so nothing here resolves a home.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/* The lifecycle events wired to the report bridge. These MUST equal the bridge's
   STATE_FOR_EVENT keys (bin/grok-report-bridge.js): a test pins the two equal by
   shape, per CLAUDE.md #5 (two derivations of one fact) -- drift would silently drop
   a report. The bridge itself decides the state from hook_event_name; this list only
   says which events fire it. All are grok's native (claude-shaped) event names,
   measured firing in an interactive pane. */
const HOOK_EVENTS = Object.freeze([
  'SessionStart', 'UserPromptSubmit', 'Notification', 'Stop',
  'StopCancelled', 'StopFailure', 'SessionEnd',
]);

/* The dedup key: any command containing this stem is "ours". Same doctrine as
   geminisettings.MARKER, kept for symmetry and for a future reader inspecting the
   file, even though our own dedicated file rarely needs it. */
const MARKER = 'grok-report-bridge';

/* The command grok runs for a hook. Grok executes a command hook as a SHELL STRING
   (measured: `echo X_$(date +%s) >> file` ran with shell expansion), so this is the
   posix shell form `node "<bridge>"` -- the analog of geminisettings.commandFor.
   `node` rather than an absolute runtime: the pane that launched grok has node on
   PATH by construction (the report bridge is a #!/usr/bin/env node script and the
   fleet runs node), and the pane inherits that PATH for the hook.

   win32 (#4010): grok 1.0.41 runs a hook through whichever Windows shell it detects
   on THAT box (read from the binary: GROK_SHELL, else pwsh, else Git Bash, else
   powershell.exe; cmd only by override), so no one quoting style is right: bash needs
   no `&`, PowerShell needs `&` before a quoted path, cmd reads neither's quotes. The
   win32 form is therefore two UNQUOTED forward-slash paths, `<node> <bridge>`, which
   all four read the same way (measured on Windows 11: Git Bash, powershell.exe and
   cmd each ran it with the JSON payload intact on stdin). Unquoted means a path with
   a space or any shell character cannot be carried, so unsafeForCommand's win32 arm
   is an ALLOWLIST and such a path is refused (degrades to scraping, today's state).
   The node is ABSOLUTE, the node doing the wiring (the bundled runtime\node.exe on an
   install, as reporthook.js and geminisettings.js use): a Windows turn gets no #3971
   PATH append and a Windows box usually has no system node. `platform` and `node`
   are injectable so both forms are testable on any host. */
function commandFor(bridgePath, opts) {
  const o = opts || {};
  if ((o.platform || process.platform) === 'win32') {
    const fwd = (p) => String(p).replace(/\\/g, '/');
    return fwd(o.node || process.execPath) + ' ' + fwd(bridgePath);
  }
  return 'node "' + bridgePath + '"';
}

/* Refuse a bridge path carrying a character that would break out of, or execute
   inside, the shell command. LOAD-BEARING: the command is a shell string.
   posix: the path rides in a double-quoted sh string; same set and reasoning as
   geminisettings.unsafeForCommand's posix arm.
   win32: the path rides UNQUOTED through a shell we do not choose (commandFor), so
   this is an allowlist, not a blocklist: letters and digits in any script, and
   `_ . - : \ /`. A space, quote, `$`, `%`, `&`, parenthesis, tilde or anything else
   is refused. A backslash is allowed (commandFor turns it into `/`); refusing it was
   #4010. A non-string is unsafe rather than throwing. */
function unsafeForCommand(s, plat) {
  if (typeof s !== 'string') return true;
  if ((plat || process.platform) === 'win32') return !/^[\p{L}\p{N}_.:\\/-]+$/u.test(s);
  return /["\\$`\r\n]/.test(s);
}

/* One event's definition: a single command hook running the bridge. The shape
   matches grok's hook schema (`{ hooks: [{ type, command }] }` under an event name),
   identical to Claude Code's and gemini's. */
function definitionFor(bridgePath, opts) {
  return { hooks: [{ type: 'command', command: commandFor(bridgePath, opts) }] };
}

/* The full desired content of our hook file: the top-level `hooks` object grok reads
   from a `$GROK_HOME/hooks/*.json` file, with every event in HOOK_EVENTS wired to the
   bridge. This fully defines our file (no merge), so equality against it is the
   idempotence test. Exported for the test. */
function desiredContent(bridgePath, opts) {
  const hooks = {};
  for (const event of HOOK_EVENTS) hooks[event] = [definitionFor(bridgePath, opts)];
  return { hooks };
}

function entryIsOurs(entry) {
  return !!(entry && Array.isArray(entry.hooks)
    && entry.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(MARKER)));
}

/**
 * Ensure our grok report-hook file at hookFilePath wires every lifecycle event to
 * the bridge. Idempotent by content (we own the file). Returns { prepared:true,
 * changed } or { prepared:false, because } in a sentence -- never throws for an
 * expected shape, because the caller (create.js at birth) fails soft: a hook file it
 * could not prepare costs the agent a self-report, not its existence, which is the
 * pre-#3391 world, not a corruption.
 * `opts` ({ platform, node }) picks the command form, see commandFor; both default
 * to this process.
 */
function ensurePrepared(hookFilePath, bridgePath, opts) {
  const o = opts || {};
  const plat = o.platform || process.platform;
  /* On win32 the command carries a second path, the absolute node (commandFor), so
     it is vetted and checked for ephemerality with the bridge. Null elsewhere. */
  const node = plat === 'win32' ? (o.node || process.execPath) : null;
  const cmdOpts = { platform: plat, node };
  if (!bridgePath) return { prepared: false, because: 'the grok report bridge is not on this machine' };
  if (unsafeForCommand(bridgePath, plat) || (node !== null && unsafeForCommand(node, plat))) {
    return { prepared: false, because: 'the bridge path contains characters we will not embed in a command' };
  }
  /* #1582 class (from geminisettings/reporthook): a durable file must not be pointed
     at an ephemeral path. During a release cut the bridge can resolve to a path inside
     the cut's temp sandbox that genuinely exists and is gone the moment the cut ends.
     Refuse to persist an ephemeral bridge path into a durable hook file; leave a
     fully-ephemeral setup (test fixtures put both under temp) alone. os.tmpdir()
     returns the UNRESOLVED /var/folders form on macOS while paths reaching the file
     are the RESOLVED /private/var form, so compare against both. */
  {
    const rawTmp = os.tmpdir();
    let realTmp = rawTmp;
    try { realTmp = fs.realpathSync(rawTmp); } catch { /* keep the raw value */ }
    const underRoot = (p, root) => typeof p === 'string' && (p === root || p.startsWith(root + path.sep));
    const ephemeral = (p) => underRoot(p, rawTmp) || underRoot(p, realTmp);
    const bridgeEphemeral = ephemeral(bridgePath) || (node !== null && ephemeral(node));
    const fileDurable = typeof hookFilePath === 'string'
      && !underRoot(hookFilePath, rawTmp) && !underRoot(hookFilePath, realTmp);
    if (bridgeEphemeral && fileDurable) {
      return { prepared: false, because: 'the bridge path is under the temp root, which is ephemeral, so it was not written into the durable hook file' };
    }
  }

  let target = hookFilePath;
  try {
    target = fs.realpathSync(target);
  } catch {
    /* Absent is the clean case -- unless the path itself is a dangling symlink:
       writing over that severs somebody's dotfiles arrangement. */
    try { if (fs.lstatSync(target).isSymbolicLink()) return { prepared: false, because: 'that hook file is a link pointing at nothing, which is somebody\u2019s arrangement to fix, not ours to replace' }; }
    catch { /* truly absent */ }
  }

  const desired = desiredContent(bridgePath, cmdOpts);
  const wantText = JSON.stringify(desired, null, 2) + '\n';

  /* Read the existing file. The only question is whether it already holds exactly
     what we want (idempotent no-op), or is a stale version of OUR OWN file to
     repoint. We rewrite it ONLY when we can POSITIVELY confirm it is ours: a
     parseable JSON OBJECT whose hooks carry our MARKER. Every other non-empty shape
     -- a parseable object WITHOUT our marker, a JSON array, a JSON primitive
     (string/number/boolean), or unparseable content -- is left alone, because we
     cannot confirm it is ours and this file's whole discipline is never to clobber a
     file a person happened to name the same.
     🛑 The confirmation is POSITIVE, not "not a plain object": a valid-JSON array or
     primitive is not a plain object, so an "is it a plain object? then check marker"
     shape would fall THROUGH to the rewrite for those, silently overwriting a file
     never confirmed ours -- the #120 comment-vs-code class this very paragraph
     promises against. So we compute one boolean (is it our marker-bearing object?)
     and refuse everything that is not. */
  let prevMode = null;
  try {
    const st = fs.statSync(target);
    prevMode = st.mode & 0o7777;
    if (st.size > 0) {
      const cur = fs.readFileSync(target, 'utf8');
      if (cur === wantText) return { prepared: true, changed: false };
      let parsed;
      try { parsed = JSON.parse(cur); } catch { parsed = undefined; }
      const isOurMarkerFile = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && !!parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)
        && Object.values(parsed.hooks).some((arr) => Array.isArray(arr) && arr.some(entryIsOurs));
      if (!isOurMarkerFile) {
        return { prepared: false, because: 'a hook file at that path is not ours, so it was left alone' };
      }
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') { /* absent is the clean case */ }
    else return { prepared: false, because: 'that hook file could not be read, so it was left alone' };
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    /* Pid-suffixed staging like geminisettings: a concurrent birth writing the same
       shared default-home hook file must not share a temp name. The rename stays
       atomic; this keeps two writers from clobbering each other's staging file
       mid-write. */
    const tmp = target + '.kosmos.' + process.pid + '.new';
    fs.writeFileSync(tmp, wantText, prevMode !== null ? { mode: prevMode } : {});
    if (prevMode !== null) fs.chmodSync(tmp, prevMode);
    fs.renameSync(tmp, target);
  } catch {
    return { prepared: false, because: 'we could not save the hook file' };
  }
  return { prepared: true, changed: true };
}

module.exports = { HOOK_EVENTS, MARKER, commandFor, unsafeForCommand, definitionFor, desiredContent, entryIsOurs, ensurePrepared };
