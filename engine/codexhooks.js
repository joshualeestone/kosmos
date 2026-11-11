'use strict';

/**
 * #5812 item 2: the Codex tool hook that tells the board, just before a Codex agent edits files, which files it is
 * about to write (the undo copy, #5153, and "changed by" on a project file). The bridge half is
 * bin/codex-report-bridge.js (its hook mode); this file puts the hook into the agent's PRIVATE Codex home
 * (engine/codexruntime.js, Kosmos-owned since #4592) at every launch on the Mac, and on Windows into the agent's named
 * account home (kosmos#8348, below).
 *
 * MEASURED on codex-cli 0.149.1, the pinned build (card comment 6219788459), against the real CLI and a local fake
 * Responses server, no model quota:
 *   - a file edit is an `apply_patch` call; PreToolUse fires before it with tool_input.command = the whole patch text.
 *     NOT covered (review 9, measured): an apply_patch the model sends through the shell (exec_command with a heredoc)
 *     is applied by Codex but reaches no hook here; see the plan;
 *   - hooks are ON by default (`codex features list`: hooks stable true), and a hook runs only with a trust record.
 *     🛑 AN UNTRUSTED OR CHANGED HOOK IS NOT SKIPPED IN THE TUI, WHICH IS HOW KOSMOS RUNS CODEX: it stops the agent at
 *     launch on "Hooks need review" (test-support/codex-screens/hook-review-*; #4589 types nothing into it). Only
 *     `codex exec` skips one silently. Measured both arms in the TUI (review 1): the computed record goes straight to
 *     the prompt, the same record with one hex digit changed brings the review screen up. So a hooks.json whose
 *     record is missing or stale is WORSE than no hook, and every path below that cannot vouch for the record removes
 *     our hooks.json;
 *   - the trust record must be in a config FILE: the same record given as a `-c` launch flag is ignored (measured,
 *     one variable apart), so it is written to <home>/config.toml;
 *   - the record is `[hooks.state."<hooks.json path>:pre_tool_use:0:0"] trusted_hash = "sha256:<hex>"`, where the path
 *     is the CANONICAL on-disk one (review 2, measured: Codex resolves its home first, so a record keyed through a
 *     linked parent folder or another letter case is never matched: install said ok and the hook did not run; in the
 *     TUI that is the review screen). Keyed with trust.canonicalOnDisk, as create.js codexTrustKey keys folder trust.
 *     The hex is Codex's version_for_toml (codex-rs/config/src/fingerprint.rs): SHA-256 of the sorted-key JSON of
 *     { event_name, matcher, hooks: [the handler normalized: its timeout (HOOK_TIMEOUT_SEC; Codex's default is 600),
 *     async false] }. Equal to the records Codex's own TUI trust wrote for this hook; one changed hex digit and the hook
 *     does not run.
 *
 * ⚠️ That hash is Codex's internal detail, verified for ONE version, HASH_VERIFIED_FOR. A Codex that computes it
 * differently would stop every agent on the review screen, so install() runs only when the launching Codex reports
 * exactly that version, and otherwise removes our hooks.json. It is a constant of its own, NOT runners.js's pin (review
 * 2): gated on the pin, a bump to a new Codex would install an unverified record for it. A test holds the two equal,
 * so a bump fails until somebody moves this constant; the test's comment says what to measure first (the new Codex's
 * TUI trust, then the real-Codex test). Nothing can force the measurement: the real-Codex test runs only where that
 * exact Codex is installed.
 *
 * ⚠️ An absent record is APPENDED (as create.js appendCodexTrust does: Codex writes this file too and takes no lock, and
 * an append cannot lose its edit). A CHANGED record is a whole-file replace (the line has to change in place), so an
 * edit by a Codex STILL RUNNING on this home at that moment could be lost. The reverse holds for both paths: that Codex
 * renaming its own copy of config.toml over the file would drop OUR record while hooks.json stays (the review screen
 * at the next launch, which then writes the record again). The install runs at
 * launch, before this agent's Codex starts; the window is a previous Codex for the same home still exiting, and the
 * change is rare (the bridge's path moved).
 *
 * kosmos#8348, WINDOWS: engine/win32codexsup.js installs the same hook at each Codex agent's start, into the agent's
 * NAMED Codex home (the account's, not a private one: Windows has no codexruntime home), with opts.platform 'win32'
 * forms measured on codex-cli 0.149.1 win32-x64: a PowerShell command (commandFor) and a TOML literal-string trust key
 * (stateHeading). There Kosmos runs `codex exec`, which skips an untrusted hook silently (measured), so a missing record
 * costs the record, not the agent. Because that home is shared, a hooks.json that is not ours is never overwritten.
 * An agent on the default ~/.codex gets no hook.
 *
 * install(home, bridge, version, opts?) -> { ok, because? }. Never throws. On every refusal our hooks.json is gone after
 * it, except on win32, where only a Codex of another version takes it back (the home is shared; see refuse in install).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOOKS_FILE = 'hooks.json';
/* The one Codex version whose trust hash was measured (10-16: Codex's own TUI trust wrote exactly trustHash()'s value). */
const HASH_VERIFIED_FOR = '0.149.1';
const EVENT = 'PreToolUse';
const EVENT_KEY = 'pre_tool_use';
const MATCHER = 'apply_patch';
/* The handler's own timeout, in seconds (Codex's default is 600: an edit could wait ten minutes on a stuck hook). The
   bridge bounds itself well inside this (2 s stdin, 3 s per keep including its answer, in parallel); this is the outer
   bound, and a hook that fails or times out does not stop the edit (measured: only a hook exiting 2 blocks it). The hash
   covers it. */
const HOOK_TIMEOUT_SEC = 10;

/* The command Codex runs for the hook, through a shell: the bridge path in single quotes, so a space (Application
   Support) or any other shell character in it is literal. */
function commandFor(bridge, opts) {
  const o = opts || {};
  /* kosmos#8348, win32, MEASURED on codex-cli 0.149.1 win32-x64 (card #8348): Codex runs a hook through POWERSHELL
     there (%ComSpec% stayed literal, $PSVersionTable expanded), where a leading quoted path is an expression that runs
     nothing (measured: "Failed"), so the win32 form is the call operator on two single-quoted literals,
     `& '<node>' '<bridge>'`, the form geminisettings.js uses for the same reason (measured: ran). The node is absolute
     (the node doing the install: a Windows box usually has no node on PATH). install() refuses a path with a quote in
     it (unsafeForWin32) before it gets here. `opts` ({ platform, node }) makes both forms testable on any host. */
  if ((o.platform || process.platform) === 'win32') return `& '${String(o.node || process.execPath)}' '${String(bridge)}'`;
  return `'${String(bridge).replace(/'/g, "'\\''")}'`;
}

/* kosmos#8348: a path refused for the win32 command. It rides in a single-quoted PowerShell literal, the same form
   geminisettings.js writes for Gemini, so the one rule for it is the shared hookpaths.unsafeForCommand (a single quote, typographic
   ones too, CR/LF, and over-refused double quotes, dollar, backtick and percent). Measured: a bracketed path is NOT a
   problem there (`& 'C:\...\a[1]\node.exe'` ran in Windows PowerShell 5.1, the same as a plain one). */
function unsafeForWin32(p) {
  return require('./hookpaths').unsafeForCommand(p, 'win32');
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/* Codex's trusted_hash for our one handler. */
function trustHash(command) {
  const identity = { event_name: EVENT_KEY, matcher: MATCHER, hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SEC, async: false }] };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(sortKeys(identity))).digest('hex')}`;
}

function hooksJson(command) {
  return `${JSON.stringify({ hooks: { [EVENT]: [{ matcher: MATCHER, hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SEC }] }] } }, null, 2)}\n`;
}

/* The [hooks.state."..."] heading for the hooks.json at `file`. Null for a path a TOML basic string would need escapes
   for (a quote, a backslash or a control character): Codex keys on the path as it reads it, and we will not guess at
   how an escaped spelling compares. A POSIX Kosmos data root has none of these. */
function stateKey(file, platform) {
  const key = `${file}:${EVENT_KEY}:0:0`;
  /* kosmos#8348, win32: every Windows path has backslashes, so the key is a TOML LITERAL string ('...'), in which a
     backslash is just a backslash. MEASURED on codex-cli 0.149.1 win32-x64 (card #8348): the key in the on-disk spelling
     with backslashes ran the hook; forward slashes, a \\?\ prefix, all lowercase and a lowercase drive letter did not;
     with CODEX_HOME given lowercased, the on-disk spelling still ran (Codex canonicalizes the home, as on the Mac). A
     literal string cannot hold a single quote or a control character other than tab, so such a path gets no key. */
  if ((platform || process.platform) === 'win32') return /['\u0000-\u0008\u000a-\u001f\u007f]/.test(key) ? null : key;
  return /["\\\u0000-\u001f\u007f]/.test(key) ? null : key;
}
function stateHeading(file, platform) {
  const key = stateKey(file, platform);
  if (!key) return null;
  return (platform || process.platform) === 'win32' ? `[hooks.state.'${key}']` : `[hooks.state."${key}"]`;
}

/* What to do to config.toml for `heading` + `line`: { append } (the bytes to add at the end), { text } (the whole new
   file), { same } or { handEdited }. Pure; exported for the tests.
   - absent: { append } (Codex writes this file too, and an append cannot lose an edit it made);
   - present in our exact form (the heading, then one trusted_hash line, then a blank line, another table or the end):
     equal is `same`; a different hash has that ONE line replaced. Appending a second table with the same key instead
     would be a TOML duplicate, and Codex would not load the config at all;
   - present in any other form (a person added `enabled = false`, say): `handEdited`, left alone. */
function nextConfig(text, heading, line) {
  const t = String(text || '');
  const lines = t.split('\n');
  const at = lines.indexOf(heading);
  /* Review 1: the key written any other way (a comment after the heading, an inline table under [hooks.state]) is not
     ours to append beside: a second definition is invalid TOML and Codex would not start at all. */
  const key = /^\[hooks\.state\.(["'])(.*)\1\]$/.exec(heading)[2];
  /* kosmos#8348: on win32 the same key can also be spelled as a basic string with each backslash doubled; that is the
     same table to TOML, so it counts as written another way too. */
  if (at === -1 && (t.includes(key) || (key.includes('\\') && t.includes(key.replace(/\\/g, '\\\\'))))) return { handEdited: true };
  if (at === -1) return { append: `${t && !t.endsWith('\n') ? '\n' : ''}${heading}\n${line}\n` };
  if (lines.indexOf(heading, at + 1) !== -1) return { handEdited: true };
  const body = lines[at + 1];
  const after = lines[at + 2];
  const ours = typeof body === 'string' && /^trusted_hash = "sha256:[0-9a-f]{64}"$/.test(body)
    && (after === undefined || after === '' || after.startsWith('['));
  if (!ours) return { handEdited: true };
  if (body === line) return { same: true };
  lines[at + 1] = line;
  return { text: lines.join('\n') };
}

function writeIfChanged(file, data, mode) {
  let old = null;
  try { old = fs.readFileSync(file, 'utf8'); } catch { old = null; }
  if (old === data) return;
  require('./securewrite').writeSecret(file, data, mode, { atomicOnly: true, ownTempsOnly: true });
}

/* Whether `text` is a hooks.json install() writes, from THIS build or any other (review 8: a later build that changes
   the handler's fields must still be able to remove today's file, or a refusal would leave it for the TUI to stop
   on). By structure, so it holds across builds and bridge paths: the whole file is { hooks: { PreToolUse: [ ONE group,
   matcher apply_patch, ONE command handler running the quoted report bridge ] } }, with no other key anywhere but a
   handler's own fields. Review 7: a file that merely MENTIONS the bridge (a person's own hooks.json with ours merged
   in) is not ours to delete. */
const HANDLER_KEYS = new Set(['type', 'command', 'timeout', 'timeoutSec', 'async', 'statusMessage']);
function isOurs(text) {
  let j;
  try { j = JSON.parse(text); } catch { return false; }
  const only = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o);
  if (!only(j, ['hooks']) || !only(j.hooks, [EVENT]) || !Array.isArray(j.hooks[EVENT]) || j.hooks[EVENT].length !== 1) return false;
  const group = j.hooks[EVENT][0];
  if (!only(group, ['matcher', 'hooks']) || group.matcher !== MATCHER || !Array.isArray(group.hooks) || group.hooks.length !== 1) return false;
  const h = group.hooks[0];
  if (!h || typeof h !== 'object' || Object.keys(h).some((k) => !HANDLER_KEYS.has(k)) || h.type !== 'command') return false;
  /* kosmos#8348: or the win32 form, `& '<...\node.exe>' '<...\codex-report-bridge.js>'`: a node running the bridge,
     nothing else in either literal's place. */
  return typeof h.command === 'string' && (/^'[^\n]*\/codex-report-bridge\.js'$/.test(h.command)
    || /^& '[^'\n]*[\\/]node(?:\.exe)?' '[^'\n]*[\\/]codex-report-bridge\.js'$/i.test(h.command));
}

/* Remove the hooks.json install() wrote, so Codex has no untrusted hook to stop on. Only a regular file exactly in our
   shape (isOurs); anything else is left. */
function removeOurs(home) {
  try {
    const file = path.join(home, HOOKS_FILE);
    const st = fs.lstatSync(file);
    if (!st.isFile()) return false;
    if (!isOurs(fs.readFileSync(file, 'utf8'))) return false;
    fs.unlinkSync(file);
    return true;
  } catch { return false; }
}

function install(home, bridge, version, opts) {
  const plat = (opts && opts.platform) || process.platform;
  const node = plat === 'win32' ? ((opts && opts.node) || process.execPath) : null;
  /* The full-path test of the platform the command is for (kosmos#8348: a win32 install tested on a Mac must judge a
     C:\ path as Windows does; a posix temp home is absolute to both). */
  const isAbs = plat === 'win32' ? path.win32.isAbsolute : path.isAbsolute;
  /* kosmos#8348: on win32 a refusal leaves the files as they are, except for a Codex of ANOTHER VERSION. There the home
     is the ACCOUNT's, shared by every Codex agent on it, so one agent's own trouble (its version probe failed, a busy
     lock, a path we will not quote) must not take the hook from another agent already running on it. A different
     version that the probe did read is the whole account's Codex (all its agents run the same one), and our record was
     never measured for it, so our hooks.json is taken back as on the Mac. (Measured for 0.149.1 only: `codex exec`
     skips a hook whose record does not count without a word; a later Codex is not assumed to.) */
  const refuse = (because, otherVersion) => {
    /* Outside the config.toml lock, as on the Mac: removeOurs deletes only a file in exactly our shape, and on win32
       only for a Codex version every agent on the home shares, so no other writer is putting ours back meanwhile. */
    if ((plat !== 'win32' || otherVersion) && typeof home === 'string' && isAbs(home)) removeOurs(home);
    return { ok: false, because };
  };
  try {
    if (typeof home !== 'string' || !isAbs(home) || typeof bridge !== 'string' || !isAbs(bridge)) {
      return refuse('the Codex home or the bridge is not a full path');
    }
    if (plat === 'win32' && (unsafeForWin32(bridge) || unsafeForWin32(node))) return refuse('the bridge or node path has a character we will not put in a command');
    /* kosmos#8348, the #1582 class: on win32 the home is a durable account home, so an engine running from a temp
       extract (a release cut, a check) must not leave its temp bridge or node path in it. The rule geminisettings.js
       applies to the same win32 form (hookpaths.js). (An installed Kosmos runs from %LOCALAPPDATA%\Programs\Kosmos\app, a path an
       update swaps the new build into, so the path written stays good across updates.) */
    if (plat === 'win32' && require('./hookpaths').ephemeralIntoDurable(path.join(home, HOOKS_FILE), [bridge, node], { platform: plat })) {
      return refuse('the bridge is under the temp folder, which is not kept, so it was not written into the Codex home');
    }
    if (version !== HASH_VERIFIED_FOR) return refuse(`this Codex is ${version || 'of an unknown version'}, and the hook's trust record is known only for ${HASH_VERIFIED_FOR}`, typeof version === 'string' && version !== '');
    const st = fs.lstatSync(home);
    if (!st.isDirectory()) return refuse('the Codex home is not a folder');
    const hooksFile = path.join(home, HOOKS_FILE);
    /* The record's key: hooks.json under the home's canonical spelling, as Codex resolves it (review 2). */
    const heading = stateHeading(path.join(require('./trust').canonicalOnDisk(home), HOOKS_FILE), plat);
    if (!heading) return refuse('the Codex home has a character in its path the hook record cannot carry');
    const command = commandFor(bridge, { platform: plat, node });
    const line = `trusted_hash = "${trustHash(command)}"`;
    const cfg = path.join(home, 'config.toml');
    /* The same lock create.js's trustCodexFolder and forgetCodexFolder take on this file. The trust record goes in
       FIRST and hooks.json after it (review 1): a hooks.json that lands without its record stops the agent. */
    const locked = require('./filelock').withFileLock(cfg, () => {
      /* kosmos#8348: on Windows the home is the ACCOUNT's Codex home, not a private one, so a hooks.json that is not ours
         (a person's own hooks) is never overwritten or removed: the Kosmos hook is skipped and theirs stays. Read under
         the lock, just before anything is written, so the window for one to appear is as small as it can be (a person's
         editor takes no lock of ours). */
      if (plat === 'win32') {
        let existing = null;
        try { existing = fs.readFileSync(hooksFile, 'utf8'); } catch { existing = null; }
        if (existing !== null && !isOurs(existing)) return { ok: false, because: 'the Codex home already has its own hooks.json, so the Kosmos hook was not added' };
      }
      let text = '';
      try { text = fs.readFileSync(cfg, 'utf8'); } catch { text = ''; }
      const next = nextConfig(text, heading, line);
      if (next.handEdited) return { ok: false, because: 'the Codex hook\'s trust entry was changed by hand, so it was left alone, and the hook may not run until it is put back' };
      const securewrite = require('./securewrite');
      if (next.append) {
        const created = !fs.existsSync(cfg);
        const fd = fs.openSync(cfg, 'a', 0o600);
        try { fs.writeSync(fd, next.append); securewrite.flushOrThrow(fd); } finally { fs.closeSync(fd); }
        if (created) securewrite.syncDir(home);
      } else if (next.text) {
        let mode = 0o600;
        try { mode = fs.statSync(cfg).mode & 0o777; } catch { mode = 0o600; }
        securewrite.writeSecret(cfg, next.text, mode, { atomicOnly: true, ownTempsOnly: true });
      }
      writeIfChanged(hooksFile, hooksJson(command), 0o600);
      return { ok: true };
    }, {
      busy: 'another Kosmos change to the codex config did not finish in time, so the Codex hook was not set up',
      cannotAccess: 'we could not get exclusive access to the codex config, so the Codex hook was not set up',
    });
    if (locked.ok && locked.value.ok) return locked.value;
    return refuse(locked.ok ? locked.value.because : locked.because);
  } catch {
    return refuse('we could not set up the Codex hook');
  }
}

/* The supervisor's call: `node codexhooks.js install <home> <bridge> <codex version>`. Exit 0 only when the hook and
   its record are in place; otherwise our hooks.json is gone and the reason goes to stderr. This CLI is the Mac
   supervisor's (posix rules); Windows calls install() directly, with its own refusal rule (kosmos#8348). */
if (require.main === module) {
  const [verb, home, bridge, version] = process.argv.slice(2);
  const r = verb === 'install' ? install(home, bridge, version) : { ok: false, because: 'usage: codexhooks.js install <home> <bridge> <codex version>' };
  if (!r.ok) process.stderr.write(`${r.because}\n`);
  process.exitCode = r.ok ? 0 : 1;
}

/* kosmos#8361: removing Kosmos takes its Codex hook out of an account's Codex home (the Windows uninstall), by the
   #5999 rules the Claude and Gemini hooks follow: only a hooks.json in exactly our shape, and only when its node or its
   bridge lies in THIS install's folder (`roots`, every spelling of it), or one of them is provably gone (`gone(p)`).
   Another install's live hook stays. The trust record goes with it only when it is exactly what install() writes for
   that command (the heading for the canonical hooks.json, then the one trusted_hash line with that command's hash);
   a record anyone changed is left. hooks.json goes FIRST, then the record (a lone record is inert; a hooks.json
   without its record stops the Codex TUI), under the config.toml lock install takes.
   Returns { ours, changed, recordRemoved?, because? }. Never throws. */
function unwireInstall(home, roots, opts) {
  const o = opts || {};
  const gone = typeof o.gone === 'function' ? o.gone : () => false;
  const plat = o.platform || process.platform;
  try {
    const hooksFile = path.join(home, HOOKS_FILE);
    let text;
    try { text = fs.readFileSync(hooksFile, 'utf8'); } catch (e) {
      // Review 3: no file is nothing to do; one that is there but cannot be read is named, as Claude's and Gemini's are.
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { ours: false, changed: false };
      return { ours: true, changed: false, because: 'hooks.json could not be read (' + ((e && e.code) || 'unknown') + ')' };
    }
    if (!isOurs(text)) return { ours: false, changed: false };
    const command = JSON.parse(text).hooks[EVENT][0].hooks[0].command;
    const m = /^& '([^']+)' '([^']+)'$/.exec(command) || /^'(.*)'$/.exec(command);
    const paths = m ? (m.length === 3 ? [m[1], m[2]] : [m[1].replace(/'\\''/g, "'")]) : [];
    const norm = (s) => String(s).replace(/\//g, '\\').toLowerCase();
    const prefixes = [...new Set((roots || []).filter((r) => typeof r === 'string' && r.trim()).map((r) => norm(r).replace(/\\+$/, '') + '\\'))];
    const inRoots = paths.some((p) => prefixes.some((r) => norm(p).startsWith(r)));
    /* Review 3: "provably gone" by the #5999 rules reporthook.unwireInstall applies: an absolute drive-letter path (a
       \\server one is never looked at), nothing a shell would expand, the expected file (node.exe, or the bridge), on a
       drive that is there now (an unplugged drive is not a deleted folder). Anything else is kept. */
    const provablyGone = (p, name) => {
      if (!/^[A-Za-z]:[\\/]/.test(p) || /[%$~]/.test(p) || p.split(/[\\/]/).pop().toLowerCase() !== name) return false;
      try { return !gone(p.slice(0, 2) + '\\') && gone(p) === true; } catch { return false; }
    };
    const dead = paths.length === 2 && (provablyGone(paths[0], 'node.exe') || provablyGone(paths[1], 'codex-report-bridge.js'));
    if (!inRoots && !dead) return { ours: false, changed: false, because: 'it belongs to another Kosmos folder that is still there' };
    const cfg = path.join(home, 'config.toml');
    const heading = stateHeading(path.join(require('./trust').canonicalOnDisk(home), HOOKS_FILE), plat);
    const line = `trusted_hash = "${trustHash(command)}"`;
    const locked = require('./filelock').withFileLock(cfg, () => {
      /* Review 1: judged again under the lock, a regular file still in our shape with the same command (a person's
         editor takes no lock of ours), and hooks.json goes FIRST: a record left alone is inert, a hooks.json left
         without its record is what stops the Codex TUI. */
      let st;
      try { st = fs.lstatSync(hooksFile); } catch (e) { if (e && e.code === 'ENOENT') return { ours: false, changed: false }; throw e; }
      if (!st.isFile()) return { ours: false, changed: false, because: 'hooks.json is not a plain file' };
      const now = fs.readFileSync(hooksFile, 'utf8');
      if (!isOurs(now) || JSON.parse(now).hooks[EVENT][0].hooks[0].command !== command) return { ours: false, changed: false, because: 'hooks.json changed while it was being checked' };
      fs.unlinkSync(hooksFile);
      let recordRemoved = false;
      /* Review 2: hooks.json is already gone, so a record that cannot be rewritten (config.toml held by another program)
         leaves the hook taken out, said as such: the record left is inert. */
      try {
      let cfgText = null;
      try { cfgText = fs.readFileSync(cfg, 'utf8'); } catch { cfgText = null; }
      if (cfgText !== null && heading) {
        const lines = cfgText.split('\n');
        const at = lines.indexOf(heading);
        /* Review 1: the record is ours to remove only when nothing else lives in its table: after any blank lines,
           the next line is another table heading or the end. A key below it would otherwise move into the table
           above (or duplicate one there, and Codex would not load the file). */
        let next = at + 2;
        while (next < lines.length && lines[next] === '') next += 1;
        const tableEnds = next >= lines.length || lines[next].startsWith('[');
        if (at !== -1 && lines.indexOf(heading, at + 1) === -1 && lines[at + 1] === line && tableEnds) {
          // The blank lines after the record go with it, but never the file's final newline.
          const drop = next >= lines.length ? 2 + Math.max(0, next - (at + 2) - 1) : next - at;
          lines.splice(at, drop);
          let mode = 0o600;
          try { mode = fs.statSync(cfg).mode & 0o777; } catch { mode = 0o600; }
          require('./securewrite').writeSecret(cfg, lines.join('\n'), mode, { atomicOnly: true, ownTempsOnly: true });
          recordRemoved = true;
        }
      }
      } catch { recordRemoved = false; }
      return { ours: true, changed: true, recordRemoved };
    }, { busy: 'another program was writing the Codex config', cannotAccess: 'its folder would not let Kosmos lock it' });
    if (locked && locked.ok === true) return locked.value;
    return { ours: true, changed: false, because: (locked && locked.because) || 'it could not be locked' };
  } catch (e) {
    return { ours: true, changed: false, because: 'it could not be read or changed (' + ((e && e.code) || 'unknown') + ')' };
  }
}

module.exports = { install, removeOurs, unwireInstall, isOurs, HASH_VERIFIED_FOR, trustHash, commandFor, hooksJson, stateHeading, nextConfig, unsafeForWin32, HOOKS_FILE, MATCHER };
