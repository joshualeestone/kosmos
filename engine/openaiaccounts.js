'use strict';
/**
 * OpenAI accounts (#540): the codex analog of accounts.js, kept as its own
 * module so the Claude flow is untouched.
 *
 * The model is the same shape as a Claude account, on purpose: an account is
 * a DIRECTORY, ~/.codex (the default) or ~/.codex-<label>, holding codex's
 * own auth.json and config.toml; its identity is read from what codex wrote;
 * and an agent runs on it through one launch variable, CODEX_HOME, exactly
 * where a Claude agent gets CLAUDE_CONFIG_DIR. Nothing here is invented:
 * `codex login --with-api-key` reads the key from stdin and writes auth.json
 * into CODEX_HOME (probed 2026-08-24, no network involved), and every codex
 * run honours CODEX_HOME.
 *
 * ⚠️ THE KEY IS NEVER RETURNED, LOGGED, OR PASSED AS AN ARGUMENT. It goes to
 * codex's login on stdin and lives where codex keeps it, on the person's own
 * Mac. Identity for an API-key account is the key's last four characters,
 * which is what codex's own `login status` shows.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOME = process.env.AGENT_WORKFORCE_HOME || os.homedir();
const PROVIDER = 'openai';
const PROVIDER_NAME = 'OpenAI / Codex';

/** The default codex home, the one rule create.js's codexHomeDir also keeps. */
function defaultDir() {
  return process.env.AGENT_WORKFORCE_CODEX_HOME || path.join(HOME, '.codex');
}

/* ⚠️ NO beside-the-directory case here, on purpose (Angel, #540 review). The
   Claude DEFAULT account's record lives BESIDE its directory (~/.claude.json
   next to ~/.claude), an asymmetry accounts.js warns about at length. codex
   keeps auth.json INSIDE ~/.codex like every other home, so the analog does
   not exist and must not be imported to be faithful: the default and a
   labelled home are read the same way. */
function authFile(dir) {
  return path.join(path.resolve(String(dir || '')), 'auth.json');
}

/** What codex wrote about who this is; null when nobody is signed in here. */
function identityOf(dir) {
  let raw;
  try { raw = fs.readFileSync(authFile(dir), 'utf8'); } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const mode = typeof parsed.auth_mode === 'string' ? parsed.auth_mode : null;
  const key = typeof parsed.OPENAI_API_KEY === 'string' ? parsed.OPENAI_API_KEY : '';
  if (mode === 'apikey' || (!mode && key)) {
    if (!key) return null;
    return { authMode: 'apikey', email: null, keyTail: key.slice(-4) };
  }
  if (mode === 'chatgpt') {
    /* codex keeps an id_token for a ChatGPT sign-in; its payload names the
       email. Decoded, never verified: this is a label, not an authentication. */
    let email = null;
    try {
      const tok = parsed.tokens && parsed.tokens.id_token;
      const payload = JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString('utf8'));
      if (typeof payload.email === 'string') email = payload.email;
    } catch { email = null; }
    return { authMode: 'chatgpt', email, keyTail: null };
  }
  return null;
}

function rowFor(dir, isDefault) {
  const who = identityOf(dir);
  if (!who) return null;
  return {
    provider: PROVIDER,
    providerName: PROVIDER_NAME,
    dir,
    label: isDefault ? null : path.basename(dir).replace(/^\.codex-/, ''),
    isDefault: isDefault === true,
    email: who.email,
    authMode: who.authMode,
    keyTail: who.keyTail,
  };
}

/** Every OpenAI account on this computer, the default first. READ, never asserted. */
function list() {
  const out = [];
  const seen = new Set();
  const add = (dir, isDefault) => {
    const clean = path.resolve(dir);
    if (seen.has(clean)) return;
    seen.add(clean);
    const row = rowFor(clean, isDefault);
    if (row) out.push(row);
  };
  add(defaultDir(), true);
  let entries = [];
  try { entries = fs.readdirSync(HOME); } catch { entries = []; }
  for (const name of entries.sort()) {
    if (!name.startsWith('.codex-')) continue;
    add(path.join(HOME, name), false);
  }
  return out;
}

function cleanLabel(label) {
  return String(label == null ? '' : label).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The first free spot, the way accounts.nextWorkDir hands one out. */
function nextWorkDir() {
  for (let n = 1; n <= 500; n += 1) {
    const label = `work${n}`;
    const dir = path.join(HOME, `.codex-${label}`);
    if (!fs.existsSync(dir)) return { label, dir };
    // A directory with no sign-in in it is free too: a cancelled add leaves
    // exactly this shape, and it must not eat a spot forever.
    if (!fs.existsSync(authFile(dir))) return { label, dir };
  }
  return null;
}

function keyProblem(key) {
  const k = String(key == null ? '' : key);
  if (!k.trim()) return 'paste the key first';
  if (/\s/.test(k.trim())) return 'that does not look like a key: keys have no spaces or line breaks in them';
  if (k.trim().length < 20) return 'that is too short to be a key';
  return null;
}

/**
 * Add an OpenAI account from an API key, through codex's own login so the
 * file it writes is the file it reads. Returns the new row, never the key.
 */
function addWithKey({ key, label, codexBin }) {
  const problem = keyProblem(key);
  if (problem) return { ok: false, because: problem };
  const bin = String(codexBin || '');
  if (!bin || !fs.existsSync(bin)) return { ok: false, because: 'we could not find the OpenAI runner on this computer, so there is nothing to sign in to' };
  let spot;
  if (label != null && String(label).trim()) {
    const clean = cleanLabel(label);
    if (!clean) return { ok: false, because: 'that is not a name we can use for an account' };
    spot = { label: clean, dir: path.join(HOME, `.codex-${clean}`) };
    if (fs.existsSync(authFile(spot.dir))) return { ok: false, because: 'there is already an OpenAI account by that name on this computer' };
  } else {
    spot = nextWorkDir();
    if (!spot) return { ok: false, because: 'we could not find a free spot for another account' };
  }
  const madeDir = !fs.existsSync(spot.dir);
  try { fs.mkdirSync(spot.dir, { recursive: true }); }
  catch { return { ok: false, because: 'we could not make a place for that account on this computer' }; }
  const run = spawnSync(bin, ['login', '--with-api-key'], {
    input: String(key).trim(),
    env: { ...process.env, CODEX_HOME: spot.dir },
    encoding: 'utf8',
    timeout: 20000,
    // stdout and stderr are DROPPED: codex's own messages could echo the key.
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const row = run.status === 0 ? rowFor(spot.dir, false) : null;
  if (!row) {
    // Anti-litter: a failed add leaves no half-made account behind.
    if (madeDir) { try { fs.rmSync(spot.dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    return { ok: false, because: 'the OpenAI runner did not accept that key' };
  }
  return { ok: true, account: row };
}

module.exports = { list, identityOf, addWithKey, nextWorkDir, defaultDir, PROVIDER, PROVIDER_NAME, HOME_FOR_TEST: HOME };
