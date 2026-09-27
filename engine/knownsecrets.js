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
  /* #4111: a one-line file that is a public assignment (OPENAI_MODEL=gpt-4o-mini) holds nothing, like the line. */
  const wholeAssignment = /[\r\n]/.test(whole) ? null : parseAssignment(whole);
  if (whole && !(wholeAssignment && isPublicName(wholeAssignment.name))) out.add(whole);
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const a = parseAssignment(t);
    /* #4111: neither the line nor its value is held when the NAME says the value is public. Both must go: the mask
       walks a NAME=value line whose value is NOT held (engine/secretmask.js isEnvLine), which would mask pieces of
       it in prose. Every OTHER key-shaped token on the line is still held (a key in a trailing comment). */
    if (a && isPublicName(a.name)) {
      /* The line is cut into tokens as always, and only the public value's OWN pieces are dropped: keyTokens cuts at
         : , ; so anthropic.claude-3-5-sonnet-20240620-v1:0 or ft:gpt-4o-mini-2024-07-18:acme would otherwise be held
         piece by piece (review round 1), and a comment restating the value would hold it again (round 2). Nothing
         is blanked out of the line: blanking a short value (API_VERSION=2, TZ=UTC) cut a real key in the comment
         into pieces (round 3). The env parser takes the value up to a space, so it stops at the first ; or , here:
         REGION=us-east-1;TOKEN=<key> keeps the key (round 3). */
      const publicValue = a.value.split(/[;,]/)[0];
      const own = new Set([publicValue, ...keyTokens(publicValue)]);
      for (const tok of keyTokens(t)) if (!own.has(tok)) out.add(tok);
      continue;
    }
    out.add(t);
    if (a) out.add(a.value);
    for (const tok of keyTokens(t)) out.add(tok);
  }
}

/* The value a secrets-file line assigns to a NAME (names are public, the value is not), or null (#3935 review
   round 27): NAME=value, export NAME=value, YAML "name: value" (a space after the colon, so a URL's scheme is not a
   name) and JSON
   "name": "value". Trimmed and unquoted. engine/secretmask.js reads the same function: a line whose value is held
   on its own here is masked whole there but not walked, so its NAME stays readable. One parser, two uses. */
function assignedValue(line) {
  const a = parseAssignment(line);
  return a ? a.value : null;
}

/* The NAME and value of a secrets-file assignment, or null: the one parser behind assignedValue. */
function parseAssignment(line) {
  if (typeof line !== 'string') return null;
  /* A commented-out assignment (# OLD_API_KEY=value, review round 28) still holds a real value. */
  const t = line.trim().replace(/^#\s*/, '');
  /* YAML and JSON values with no space in them (review round 28: "Note: see the wiki" is prose, not a value). */
  /* The env value is a quoted string or one token (review round 30: "(.*)" took a trailing comment or sentence). */
  const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/.exec(t)
    || /^([A-Za-z_][A-Za-z0-9_.-]*):\s+(\S+)$/.exec(t)
    || /^"([A-Za-z_][A-Za-z0-9_.-]*)"\s*:\s*("[^\s"]*"|[^\s,]+),?$/.exec(t);
  if (!m) return null;
  const value = m[2].trim().replace(/^["']|["']$/g, '');
  /* Padding is not a value (review round 31: Zq8v...Q1== read as NAME "Zq8v...Q1" and value "="). */
  return value && !/^=+$/.test(value) ? { name: m[1], value } : null;
}

/* #4111: a NAME that says its value is public configuration, not a secret: OPENAI_MODEL, model, AWS_REGION,
   API_VERSION, defaultModel, OPENAI_MODEL_ID. The setup guide names such values constantly (a model id such as
   gpt-4o-mini-2024-07-18 has digits and no words, so it is key-shaped), and holding one masked the guide's own prose.
   The NAME must END in a public part (or in <public>_ID / <public>_NAME), so a secret named after a model or a region
   (MODEL_PASSPHRASE, REGION_BEARER, MODEL_API_KEY) stays held by its last word, and a secret-like part anywhere
   (REGION_TOKEN_VERSION) also keeps it held. camelCase names are split like snake_case ones. URL, HOST and ENDPOINT
   are deliberately NOT public: a URL can carry a token or a password, and holding one costs only a masked address.
   ZONE is not public either: Cloudflare's CF_ZONE_ID is read from the secrets folder, and TZ/TIMEZONE cover time. */
/* Singular and plural alike (review round 4: AWS_REGIONS, SUPPORTED_LOCALES). A name glued into one word with no
   separator or case change (APIVERSION, MODELNAME) is not split, so its value stays held: the safe direction. */
const PUBLIC_NAME_PARTS = new Set(['MODEL', 'MODELS', 'REGION', 'REGIONS', 'VERSION', 'VERSIONS', 'LOCALE', 'LOCALES',
  'LANG', 'LANGS', 'LANGUAGE', 'LANGUAGES', 'TZ', 'TIMEZONE', 'TIMEZONES']);
/* Matched INSIDE each part, not as a whole part (review round 3: PRIVKEY_VERSION, APITOKEN_MODEL). Over-matching only
   keeps a value held (DESIGN_MODEL holds its value, as before #4111); no public part contains one of these. */
const SECRET_NAME_PARTS = /KEY|TOKEN|SECRET|PASS|PWD|AUTH|BEARER|JWT|HMAC|CRED|PRIV|SIG|SALT|NONCE|COOKIE|SESSION|DSN|CERT|PEM|SEED|MNEMONIC|^PIN$|^OTP$|^TOTP$/;
function isPublicName(name) {
  const parts = String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().split(/[_.-]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => SECRET_NAME_PARTS.test(p))) return false;
  const last = parts[parts.length - 1];
  if (PUBLIC_NAME_PARTS.has(last)) return true;
  return (last === 'ID' || last === 'NAME') && parts.length >= 2 && PUBLIC_NAME_PARTS.has(parts[parts.length - 2]);
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

module.exports = { collect, KEY_FILES, assignedValue, keyTokens, isPublicName };
