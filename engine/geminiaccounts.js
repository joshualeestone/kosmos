'use strict';
/**
 * Gemini (Google) accounts (#3296 accounts slice): the Gemini analog of
 * engine/grokaccounts.js, kept as its own module so the other providers' flows
 * are untouched. Read grokaccounts.js first -- structurally this IS grokaccounts
 * with Gemini's names and Google's key-check; the CLI's one quirk is confined
 * OUTSIDE this module (see the note below), so the account model here is the
 * same symmetric one-directory shape grok has.
 *
 * 🔑 AN ACCOUNT IS A DIRECTORY, and `dir` (== the agent's configDir) is the
 * GEMINI_CLI_HOME value VERBATIM -- ~/.gemini (the default) or ~/.gemini-<label>.
 * The key file lives in that dir, and bin/agent-supervisor.sh reads
 * $GEMINI_CLI_HOME/.kosmos-gemini-apikey (== keyFile(dir)) for a per-account agent.
 * Everything here is symmetric with grok on purpose.
 *
 * 🛑 WHERE THE GEMINI ASYMMETRY LIVES, AND WHY NOT HERE. The real Gemini CLI reads
 * GEMINI_CLI_HOME as a ROOT and writes its data (projects.json, tmp/, sessions,
 * settings.json) into a `.gemini` SUBDIR below it (measured; geminisession.HOME()
 * appends `.gemini` to GEMINI_CLI_HOME). So the CLI's STORAGE home is
 * `<dir>/.gemini`, one level below the account dir. That one-level append is
 * applied at the two places that read/write the CLI's storage -- create.js's
 * `geminiStorageHome(configDir)` helper (the birth settings write) and
 * status.js's readGeminiSession (the session read) -- NOT here. This module, the
 * plist (GEMINI_CLI_HOME = dir, no transform), and readPlistJob (dir read back
 * verbatim) all stay symmetric with grok. Keeping the quirk in the ONE helper that
 * already owned it (both storage consumers already read `|| defaultAgentGeminiHome`)
 * is why the account subsystem is not three-way asymmetric.
 *
 * The mode-600 key file, the fail-open ABSENT/UNREADABLE split, the live-check
 * asymmetry (red only on Google's own positive rejection), and the
 * forget-rather-than-delete default are identical to grokaccounts; the shared
 * discipline is documented there.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const subscription = require('./subscription');
const inflight = require('./inflight');

const STATE = subscription.STATE;
const PROVIDER = 'google';
/* "Gemini", the name the screen uses and the word a person types to connect it. */
const PROVIDER_NAME = 'Gemini';

function homeDir() { return process.env.AGENT_WORKFORCE_HOME || os.homedir(); }

/* The default Gemini account dir (~/.gemini). Mirrors create.defaultAgentGeminiHome
   EXACTLY. The operator's own ambient GEMINI_CLI_HOME is deliberately NOT honoured
   as the default (a default-account agent is pinned to the standard ~/.gemini the
   board knows; a per-account home is carried by the account's dir). */
function defaultDir() {
  return process.env.AGENT_WORKFORCE_GEMINI_HOME || path.join(homeDir(), '.gemini');
}

const DIR_PREFIX = '.gemini-';

/* The mode-600 key file, inside the account dir == the GEMINI_CLI_HOME value, so
   the supervisor reads $GEMINI_CLI_HOME/.kosmos-gemini-apikey and finds exactly
   this file. (The CLI's own data sits one `.gemini` level below; the key file
   stays at the root the env var names, out of the CLI's storage.) */
const KEY_BASENAME = '.kosmos-gemini-apikey';
function keyFile(dir) { return path.join(path.resolve(String(dir || '')), KEY_BASENAME); }

/* #2095 sibling (see grokaccounts/openaiaccounts): the human-chosen display NAME,
   in a small sidecar file inside the account dir, kept SEPARATE from the path label
   (which is cleanLabel-slugged). Best-effort and fail-open everywhere: a missing or
   unreadable file is a real "no name" (null), never an error, and a failed write
   never fails the add. NAME_MAX clamps by code point so a raw API call cannot store
   an unbounded name that bloats every /api/accounts response. */
const NAME_MAX = 120;
function nameFile(dir) { return path.join(path.resolve(String(dir || '')), '.kosmos-name'); }
function readName(dir) {
  try {
    const n = [...fs.readFileSync(nameFile(dir), 'utf8').trim()].slice(0, NAME_MAX).join('').trimEnd();
    return n || null;
  } catch { return null; }
}
function writeName(dir, name) {
  const n = [...String(name == null ? '' : name).trim()].slice(0, NAME_MAX).join('').trimEnd();
  if (!n) return false;
  try { fs.writeFileSync(nameFile(dir), n); return true; }
  catch { return false; }
}

function readKey(dir) {
  let raw;
  try { raw = fs.readFileSync(keyFile(dir), 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unreadable' };
  }
  return { kind: 'ok', key: String(raw).trim() };
}

function identityOf(dir) {
  const got = readKey(dir);
  if (got.kind !== 'ok' || !got.key) return null;
  return { authMode: 'apikey', email: null, keyTail: got.key.slice(-4) };
}

function rowFor(dir, isDefault) {
  const who = identityOf(dir);
  if (!who) return null; // gate on a stored key, default included (see grokaccounts.rowFor)
  return {
    provider: PROVIDER,
    providerName: PROVIDER_NAME,
    dir,
    label: isDefault ? null : path.basename(dir).replace(new RegExp('^' + DIR_PREFIX.replace('.', '\\.')), ''),
    name: readName(dir),
    isDefault: isDefault === true,
    email: null,
    authMode: who.authMode,
    keyTail: who.keyTail,
  };
}

/** Every Gemini account on this computer, the default first. READ, never asserted. */
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
  try { entries = fs.readdirSync(homeDir()); } catch { entries = []; }
  for (const name of entries.sort()) {
    if (!name.startsWith(DIR_PREFIX)) continue;
    add(path.join(homeDir(), name), false);
  }
  return out;
}

/* ---- live key verification (Google) --------------------------------------- */

let fetcher = null;
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

/**
 * Ask Google whether this key works: GET /v1beta/models?key=<KEY>, the cheap
 * verification call. Google keys go in the QUERY STRING, not an Authorization
 * header (unlike OpenAI/xAI/Anthropic) -- that is the one call-shape difference.
 * 200 = works; a 400/403 Google attributes to the key (API_KEY_INVALID) =
 * rejected; anything else / unreachable = we could not confirm. URL base
 * overridable for the browser-check harness.
 */
async function askModels(key) {
  const f = fetcher || (async (url, init) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } finally { clearTimeout(t); }
  });
  const base = process.env.AGENT_WORKFORCE_GEMINI_MODELS_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
  /* The key rides the query string, so it must be URL-encoded. It is NEVER logged;
     it appears only in the request this function makes and is not returned. */
  const url = base + (base.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(String(key || ''));
  try {
    return await f(url, { method: 'GET' });
  } catch {
    return { status: 0, body: null, unreachable: true, because: 'we could not reach Google to check whether this key still works' };
  }
}

async function validateLive(key) {
  const r = await askModels(key);
  if (r.unreachable) return { state: STATE.UNKNOWN, because: r.because };
  if (r.status === 200) return { state: STATE.CONNECTED, because: 'Google confirmed this key works' };
  if (r.status === 400 || r.status === 403) {
    /* Positive NONE ONLY on Google's STRUCTURED key-rejection signal: the reason enum
       `API_KEY_INVALID`, which Google returns as an error.details[].reason (and, on some
       endpoints, as error.status). NOT the free-text message: matching the prose "API key
       not valid" would red a good key on any 400/403 whose message happened to contain those
       words -- the same fuzzy-message false-NONE class the sibling providers key off a
       structured field to avoid. The enum token cannot appear by accident. A generic
       PERMISSION_DENIED / INVALID_ARGUMENT without that reason is a scope answer -> UNKNOWN,
       the fail-open direction (never red a key that may work for inference but cannot list
       models). */
    const err = r.body && r.body.error;
    const status = err && typeof err.status === 'string' ? err.status : '';
    const reasons = err && Array.isArray(err.details)
      ? err.details.map((d) => (d && typeof d.reason === 'string' ? d.reason : '')).join(' ')
      : '';
    if (/\bAPI_KEY_INVALID\b/.test(status + ' ' + reasons)) {
      return { state: STATE.NONE, because: 'Google did not accept this key' };
    }
    return { state: STATE.UNKNOWN, because: 'Google refused to check this key in a way that does not confirm the key itself is bad' };
  }
  return { state: STATE.UNKNOWN, because: 'we asked Google whether this key still works and it answered ' + (r.status || 'nothing usable') };
}

async function checkLive(dir, _opts) {
  const got = readKey(dir);
  if (got.kind === 'absent') return { state: STATE.NONE, checkedLive: true, because: 'no API key is stored for this account' };
  if (got.kind === 'unreadable') return { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not read this account\'s stored key to check it' };
  if (!got.key) return { state: STATE.UNKNOWN, checkedLive: true, because: 'this account\'s stored key is empty' };
  const live = await validateLive(got.key);
  return { ...live, checkedLive: true };
}

/* ---- add / store / forget / remove ---------------------------------------- */

function keyProblem(key) {
  const k = String(key == null ? '' : key).trim();
  if (!k) return 'paste the key first';
  if (/\s/.test(k)) return 'that does not look like a key: a key has no spaces or line breaks in it';
  if (k.length < 20) return 'that is too short to be a key';
  return null;
}

function cleanLabel(label) {
  return String(label == null ? '' : label).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function dirForLabel(label) {
  const slug = cleanLabel(label);
  if (!slug) return { ok: false, because: 'give this account a name using letters, numbers or dashes' };
  if (slug === 'default') return { ok: false, because: '"default" is reserved for your main Gemini account' };
  return { ok: true, label: slug, dir: path.join(homeDir(), DIR_PREFIX + slug) };
}

function nextWorkDir(exclude) {
  for (let n = 1; n <= 500; n += 1) {
    const label = `work${n}`;
    const dir = path.join(homeDir(), DIR_PREFIX + label);
    if (exclude && exclude.has(dir)) continue;
    if (!fs.existsSync(dir)) return { label, dir };
    if (!fs.existsSync(keyFile(dir))) return { label, dir };
  }
  return null;
}

function storeKey(dir, key) {
  const d = path.resolve(String(dir || ''));
  fs.mkdirSync(d, { recursive: true });
  const file = keyFile(d);
  const tmp = file + '.tmp';
  try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  fs.writeFileSync(tmp, String(key || '').trim(), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
}

function forgetKey(dir) {
  let ok = false;
  try { fs.rmSync(keyFile(dir), { force: true }); ok = true; } catch { ok = false; }
  try { fs.rmSync(keyFile(dir) + '.tmp', { force: true }); } catch { /* best effort */ }
  return ok;
}

const FORGOTTEN_PREFIX = '.removed-gemini-';

function forgetAccount(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const base = path.basename(clean);

  /* 🛑 Defence in depth on a directory-renaming endpoint: the DEFAULT home (~/.gemini) is the
     machine's own CLI home, NOT a per-account artifact this subsystem manages (it is never
     credentialed or listed here). So it is never ours to move, and refusing it closes the
     rm-your-whole-CLI-home path a manually-placed key file could otherwise open on the remove
     sibling. A deliberate DIVERGENCE from openaiaccounts, whose default IS disconnectable/deletable
     (#2684) because it is a codex-only home Kosmos manages; gemini/grok's default is the unmanaged
     machine-global key door, so this subsystem neither creates nor destroys it. */
  if (clean === path.resolve(defaultDir())) {
    return { ok: false, forgotten: false, because: 'the default Gemini account is your computer\'s own Gemini home; Kosmos does not manage it here, so it cannot be disconnected' };
  }
  if (path.dirname(clean) !== home || !base.startsWith(DIR_PREFIX)) {
    return { ok: false, forgotten: false, because: 'that is not a Gemini account on this computer' };
  }
  const agents = (Array.isArray(usedBy) ? usedBy : []).filter((n) => typeof n === 'string' && n);
  if (agents.length) {
    return {
      ok: false, forgotten: false, usedBy: agents,
      because: agents.length === 1
        ? `${agents[0]} is set up to run on this account. Move it to another account or remove it first.`
        : `${agents.length} agents are set up to run on this account: ${agents.join(', ')}. `
          + 'Move them to another account or remove them first.',
    };
  }
  if (!fs.existsSync(clean)) {
    return { ok: true, forgotten: false, because: 'that account is already gone from this computer' };
  }
  if (!identityOf(clean)) {
    return { ok: false, forgotten: false, because: 'that is not a Gemini account on this computer' };
  }
  const label = base.slice(DIR_PREFIX.length); // the default is refused above, so always a labelled account
  let target = path.join(home, FORGOTTEN_PREFIX + label);
  for (let n = 2; fs.existsSync(target) && n < 500; n += 1) {
    target = path.join(home, `${FORGOTTEN_PREFIX}${label}-${n}`);
  }
  if (fs.existsSync(target)) {
    return { ok: false, forgotten: false, because: 'we could not find a free name to move that account to' };
  }
  try { fs.renameSync(clean, target); }
  catch { return { ok: false, forgotten: false, because: 'we could not move that account out of the way' }; }
  return { ok: true, forgotten: true, movedTo: target, wasDefault: false, because: null };
}

function removeAccount(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const base = path.basename(clean);

  /* The remove sibling of forgetAccount's default guard, and the one the hazard is really about:
     without it a remove:true on the default would rmSync the user's entire ~/.gemini CLI home.
     See forgetAccount for the full reasoning and the openaiaccounts divergence. */
  if (clean === path.resolve(defaultDir())) {
    return { ok: false, removed: false, because: 'the default Gemini account is your computer\'s own Gemini home; Kosmos does not manage it here, so it cannot be deleted' };
  }
  if (path.dirname(clean) !== home || !base.startsWith(DIR_PREFIX)) {
    return { ok: false, removed: false, because: 'that is not a Gemini account on this computer' };
  }
  const agents = (Array.isArray(usedBy) ? usedBy : []).filter((n) => typeof n === 'string' && n);
  if (agents.length) {
    return {
      ok: false, removed: false, usedBy: agents,
      because: agents.length === 1
        ? `${agents[0]} is set up to run on this account. Move it to another account or remove it first.`
        : `${agents.length} agents are set up to run on this account: ${agents.join(', ')}. `
          + 'Move them to another account or remove them first.',
    };
  }
  if (!fs.existsSync(clean)) {
    return { ok: true, removed: false, because: 'that account is already gone from this computer' };
  }
  if (!identityOf(clean)) {
    return { ok: false, removed: false, because: 'that is not a Gemini account on this computer' };
  }
  try { fs.rmSync(clean, { recursive: true, force: true }); }
  catch { return { ok: false, removed: false, because: 'we could not delete that account from this computer' }; }
  return { ok: true, removed: true, wasDefault: false, because: null };
}

/* ---- live list ------------------------------------------------------------ */

async function listLiveNow() {
  const rows = list();
  return Promise.all(rows.map(async (row) => {
    try {
      return { ...row, connection: await module.exports.checkLive(row.dir, { cached: true }) };
    } catch {
      return {
        ...row,
        connection: { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not check this account just now' },
      };
    }
  }));
}

const listLive = inflight.collapse(listLiveNow);

module.exports = {
  STATE, PROVIDER, PROVIDER_NAME, DIR_PREFIX, KEY_BASENAME, FORGOTTEN_PREFIX,
  homeDir, defaultDir, keyFile, identityOf, list,
  setFetcher, askModels, validateLive, checkLive, listLive,
  keyProblem, cleanLabel, dirForLabel, nextWorkDir,
  storeKey, forgetKey, forgetAccount, removeAccount,
  readName, writeName,
  get HOME_FOR_TEST() { return homeDir(); },
};
