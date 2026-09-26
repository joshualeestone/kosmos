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
    for (const tok of keyTokens(t)) out.add(tok);
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
  /* The env value is a quoted string or one token (review round 30: "(.*)" took a trailing comment or sentence). */
  const m = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S+)/.exec(t)
    || /^[A-Za-z_][A-Za-z0-9_.-]*:\s+(\S+)$/.exec(t)
    || /^"[A-Za-z_][A-Za-z0-9_.-]*"\s*:\s*("[^\s"]*"|[^\s,]+),?$/.exec(t);
  if (!m) return null;
  const value = m[1].trim().replace(/^["']|["']$/g, '');
  /* Padding is not a value (review round 31: Zq8v...Q1== read as NAME "Zq8v...Q1" and value "="). */
  return value && !/^=+$/.test(value) ? value : null;
}

/* The key-shaped tokens of a secrets-file line (#3935). The mask does not walk a line with spaces in it (a comment,
   a YAML line, prose: walking it masked the same words in a guide's sentence), so every key inside a line is held on
   its own here, whatever surrounds it: "# rotated: Zq8v...", "token:Zq8v...", "Zq8v...: rotated last week",
   "password:Hq7v...". Rather than guessing which side of a : or = is a name (review rounds 27 to 33 each found a
   shape that guess got wrong), every piece is judged on its own shape:
   - a piece is cut at spaces , ; : and an = that is not padding;
   - it is a key with MIN_VALUE_LEN characters or more, four letters, not a URL or path, not made of words, and a
     digit or both cases;
   - it is a NAME, and not held, when it is parts joined by _ - . that are each one case, 10 characters at most and
     no more digits than letters (CF_API_TOKEN, r2_secret_access_key, webhook_url_v2); a key's parts are mixed
     case or mostly digits (xK9-mP2qR7vT4wZ8nB5c, 550e8400-e29b-...);
   - an all-letter piece is an identifier when every case piece is three letters or more (XMLHttpRequest,
     NSURLSessionTask); a random one breaks into two-letter pieces (Pqz Rt Lm Wx ...). */
function keyTokens(line) {
  if (typeof line !== 'string') return [];
  const { madeOfWords, MIN_VALUE_LEN } = require('./secretmask');
  const namePart = (x) => x.length <= 10 && (x === x.toLowerCase() || x === x.toUpperCase())
    && (x.match(/[0-9]/g) || []).length <= (x.match(/[A-Za-z]/g) || []).length;
  const isName = (tok) => /[-_.]/.test(tok) && tok.split(/[-_.]+/).filter(Boolean).every(namePart);
  const lettersOnlyWords = (tok) => (tok.match(/[A-Z]{2,5}(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]+/g) || [])
    .every((p) => p.length >= 3);   // a random all-letter key breaks into many two-letter case pieces (Pqz Rt Lm ...)
  const isKey = (tok) => tok.length >= MIN_VALUE_LEN && !/^[/~]/.test(tok) && (tok.match(/[A-Za-z]/g) || []).length >= 4
    && !isName(tok) && !madeOfWords(tok)
    && (/[0-9]/.test(tok) || (/[a-z]/.test(tok) && /[A-Z]/.test(tok) && !lettersOnlyWords(tok)));
  const out = [];
  for (const raw of line.trim().split(/[\s,;:]+|=(?=[^=\s])/)) {
    const tok = raw.replace(/^[#"'`([{<]+|["'`)\]}>.,]+$/g, '');
    if (isKey(tok) && tok !== line.trim()) out.push(tok);
  }
  return out;
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

module.exports = { collect, KEY_FILES, assignedValue, keyTokens };
