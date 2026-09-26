'use strict';

/**
 * #3769 (Ice Cream Kitty's review): the secret values this board actually holds, so the setup guide's
 * words can be masked by VALUE (engine/secretmask.js setKnownSecrets), not only by shape. A key the board
 * holds is then masked however it is written, including as hex or base64.
 *
 * Read from where Kosmos keeps them:
 *   - its data folder: the board token, and every file under secrets/ (Cloudflare, GitHub, the token
 *     doors under secrets/env);
 *   - each account folder in the Kosmos home (~/.claude, ~/.claude-<label>, and the Codex, Gemini and
 *     Grok analogs): the pasted key files, and Codex's OPENAI_API_KEY in auth.json.
 *
 * Values only ever reach this process's memory; nothing here logs or returns a path with them. Never
 * throws: a file that cannot be read is skipped.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_FILE_BYTES = 64 * 1024;
const KEY_FILES = ['.kosmos-claude-apikey', '.kosmos-gemini-apikey', '.kosmos-grok-apikey'];
const ACCOUNT_DIR = /^\.(claude|codex|gemini|grok)(-[^/]*)?$/;

function readSmall(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

/* Every non-empty line, and the whole file trimmed: a token file is one line, an env file is NAME=value. */
function valuesIn(text, out) {
  if (typeof text !== 'string') return;
  const whole = text.trim();
  if (whole) out.add(whole);
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    out.add(t);
    const value = assignedValue(t);
    if (value) out.add(value);
    /* A comment line is not walked by the mask (#3935 review round 27), so a key written bare in one is held on its
       own here (review round 28): each token of 12 characters or more with both a letter and a digit. A name
       (CF_API_TOKEN) has no digit, and prose has neither shape. */
    if (/^#/.test(t)) {
      for (const tok of t.replace(/^#+/, '').split(/[\s,;]+/)) {
        if (tok.length >= 12 && /[A-Za-z]/.test(tok) && /[0-9]/.test(tok)) out.add(tok.replace(/^["'`]|["'`.]$/g, ''));
      }
    }
  }
}

/* The value a secrets-file line assigns to a public NAME, or null (#3935 review round 27): NAME=value, export
   NAME=value, YAML "name: value" (a space after the colon, so a URL's scheme is not a name) and JSON
   "name": "value". Trimmed and unquoted. engine/secretmask.js reads the same function: a line whose value is held
   on its own here is masked whole there but not walked, so its NAME stays readable. One parser, two uses. */
function assignedValue(line) {
  if (typeof line !== 'string') return null;
  /* A commented-out assignment (# OLD_API_KEY=value, review round 28) still holds a real value. */
  const t = line.trim().replace(/^#\s*/, '');
  /* YAML and JSON values with no space in them (review round 28: "Note: see the wiki" is prose, not a value). */
  const m = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(.*)$/.exec(t)
    || /^[A-Za-z_][A-Za-z0-9_.-]*:\s+(\S+)$/.exec(t)
    || /^"[A-Za-z_][A-Za-z0-9_.-]*"\s*:\s*("[^\s"]*"|[^\s,]+),?$/.exec(t);
  if (!m) return null;
  const value = m[1].trim().replace(/^["']|["']$/g, '');
  return value || null;
}

function walk(dir, out, depth = 0) {
  if (depth > 4) return;
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out, depth + 1);
    else if (d.isFile()) valuesIn(readSmall(p), out);
  }
}

function collect({ dataRoot = null, home = null } = {}) {
  const out = new Set();
  let root = dataRoot;
  if (!root) { try { root = require('./store').ROOT; } catch { root = null; } }
  if (root) {
    valuesIn(readSmall(path.join(root, 'board.token')), out);
    walk(path.join(root, 'secrets'), out);
  }
  const h = home || process.env.AGENT_WORKFORCE_HOME || os.homedir();
  let entries = [];
  try { entries = fs.readdirSync(h, { withFileTypes: true }); } catch { entries = []; }
  for (const d of entries) {
    if (!d.isDirectory() || !ACCOUNT_DIR.test(d.name)) continue;
    const dir = path.join(h, d.name);
    for (const k of KEY_FILES) valuesIn(readSmall(path.join(dir, k)), out);
    const auth = readSmall(path.join(dir, 'auth.json'));
    if (auth) {
      try {
        const parsed = JSON.parse(auth);
        if (parsed && typeof parsed.OPENAI_API_KEY === 'string') out.add(parsed.OPENAI_API_KEY.trim());
      } catch { /* not JSON: nothing to take */ }
    }
  }
  return [...out].filter((v) => v.length >= 12);
}

module.exports = { collect, KEY_FILES, assignedValue };
