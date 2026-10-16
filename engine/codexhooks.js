'use strict';

/**
 * #5812 item 2: the Codex tool hook that tells the board, just before a Codex agent edits files, which files it is
 * about to write (the undo copy, #5153, and "changed by" on a project file). The bridge half is
 * bin/codex-report-bridge.js (its hook mode); this file puts the hook into the agent's PRIVATE Codex home
 * (engine/codexruntime.js, Kosmos-owned since #4592) at every launch.
 *
 * MEASURED on codex-cli 0.149.1, the pinned build (card comment 6219788459), against the real CLI and a local fake
 * Responses server, no model quota:
 *   - a file edit is an `apply_patch` call; PreToolUse fires before it with tool_input.command = the whole patch text;
 *   - hooks need `features.hooks` (the old `codex_hooks` name is deprecated) AND a trust record. An untrusted hook is
 *     SKIPPED WITH NO WARNING; the TUI's "Hooks need review" screen is the only other way to trust one, and an
 *     unattended agent never sees it;
 *   - the trust record must be in a config FILE: the same record given as a `-c` launch flag is ignored (measured,
 *     one variable apart), so it is written to <home>/config.toml;
 *   - the record is `[hooks.state."<hooks.json path>:pre_tool_use:0:0"] trusted_hash = "sha256:<hex>"`, the hex being
 *     Codex's version_for_toml (codex-rs/config/src/fingerprint.rs): SHA-256 of the sorted-key JSON of
 *     { event_name, matcher, hooks: [the handler normalized: timeout 600, async false] }. Reproduced exactly against
 *     two records the TUI wrote; one changed hex digit and the hook does not run.
 *
 * ⚠️ That hash is Codex's internal detail. A Codex that computes it differently runs no hook and says nothing, so the
 * real-Codex test (codexhooks-5812.test.js) is what notices; it runs only where the pinned Codex is installed.
 *
 * install(home, bridge) -> { ok, because? }. Never throws.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOOKS_FILE = 'hooks.json';
const EVENT = 'PreToolUse';
const EVENT_KEY = 'pre_tool_use';
const MATCHER = 'apply_patch';
/* Codex's defaults for a command handler, which its hash covers (the normalized handler). */
const DEFAULT_TIMEOUT_SEC = 600;

/* The command Codex runs for the hook, through a shell: the bridge path in single quotes, so a space (Application
   Support) or any other shell character in it is literal. */
function commandFor(bridge) {
  return `'${String(bridge).replace(/'/g, "'\\''")}'`;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/* Codex's trusted_hash for our one handler. */
function trustHash(command) {
  const identity = { event_name: EVENT_KEY, matcher: MATCHER, hooks: [{ type: 'command', command, timeout: DEFAULT_TIMEOUT_SEC, async: false }] };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(sortKeys(identity))).digest('hex')}`;
}

function hooksJson(command) {
  return `${JSON.stringify({ hooks: { [EVENT]: [{ matcher: MATCHER, hooks: [{ type: 'command', command }] }] } }, null, 2)}\n`;
}

/* The [hooks.state."..."] heading for the hooks.json at `file`. Null for a path a TOML basic string would need escapes
   for (a quote, a backslash or a control character): Codex keys on the path as it reads it, and we will not guess at
   how an escaped spelling compares. A POSIX Kosmos data root has none of these. */
function stateHeading(file) {
  const key = `${file}:${EVENT_KEY}:0:0`;
  if (/["\\\u0000-\u001f\u007f]/.test(key)) return null;
  return `[hooks.state."${key}"]`;
}

/* The new config.toml text for `heading` + `line`, or { same } / { handEdited }. Pure; exported for the tests.
   - absent: appended (Codex writes this file too, and an append cannot lose an edit it made);
   - present in our exact form (the heading, then one trusted_hash line, then a blank line, another table or the end):
     equal is `same`; a different hash has that ONE line replaced. Appending a second table with the same key instead
     would be a TOML duplicate, and Codex would not load the config at all;
   - present in any other form (a person added `enabled = false`, say): `handEdited`, left alone. */
function nextConfig(text, heading, line) {
  const t = String(text || '');
  const lines = t.split('\n');
  const at = lines.indexOf(heading);
  if (at === -1) return { text: `${t}${t && !t.endsWith('\n') ? '\n' : ''}${heading}\n${line}\n` };
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

function install(home, bridge) {
  try {
    if (typeof home !== 'string' || !path.isAbsolute(home) || typeof bridge !== 'string' || !path.isAbsolute(bridge)) {
      return { ok: false, because: 'the Codex home or the bridge is not a full path' };
    }
    const st = fs.lstatSync(home);
    if (!st.isDirectory()) return { ok: false, because: 'the private Codex home is not a folder' };
    const hooksFile = path.join(home, HOOKS_FILE);
    const heading = stateHeading(hooksFile);
    if (!heading) return { ok: false, because: 'the private Codex home has a character in its path the hook record cannot carry' };
    const command = commandFor(bridge);
    const line = `trusted_hash = "${trustHash(command)}"`;
    const cfg = path.join(home, 'config.toml');
    /* The same lock create.js's trustCodexFolder and forgetCodexFolder take on this file. */
    const locked = require('./filelock').withFileLock(cfg, () => {
      writeIfChanged(hooksFile, hooksJson(command), 0o600);
      let text = '';
      try { text = fs.readFileSync(cfg, 'utf8'); } catch { text = ''; }
      const next = nextConfig(text, heading, line);
      if (next.handEdited) return { ok: false, because: 'the Codex hook\'s trust entry was changed by hand, so it was left alone' };
      if (next.same) return { ok: true };
      let mode = 0o600;
      try { mode = fs.statSync(cfg).mode & 0o777; } catch { mode = 0o600; }
      require('./securewrite').writeSecret(cfg, next.text, mode, { atomicOnly: true, ownTempsOnly: true });
      return { ok: true };
    }, {
      busy: 'another Kosmos change to the codex config did not finish in time, so the Codex hook was not set up',
      cannotAccess: 'we could not get exclusive access to the codex config, so the Codex hook was not set up',
    });
    return locked.ok ? locked.value : { ok: false, because: locked.because };
  } catch {
    return { ok: false, because: 'we could not set up the Codex hook' };
  }
}

/* The supervisor's call: `node codexhooks.js install <home> <bridge>`. Exit 0 only when the hook is in place, so the
   launch adds features.hooks only then; the reason goes to stderr. */
if (require.main === module) {
  const [verb, home, bridge] = process.argv.slice(2);
  const r = verb === 'install' ? install(home, bridge) : { ok: false, because: 'usage: codexhooks.js install <home> <bridge>' };
  if (!r.ok) process.stderr.write(`${r.because}\n`);
  process.exitCode = r.ok ? 0 : 1;
}

module.exports = { install, trustHash, commandFor, hooksJson, stateHeading, nextConfig, HOOKS_FILE, MATCHER };
