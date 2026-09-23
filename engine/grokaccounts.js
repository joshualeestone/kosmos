'use strict';
/**
 * Grok (xAI) accounts (#3391 accounts slice): the Grok analog of
 * engine/openaiaccounts.js and engine/claudeaccounts.js, kept as its own module
 * so the other providers' flows are untouched.
 *
 * THE MODEL IS THE SAME SHAPE AS EVERY OTHER PROVIDER: an account is a
 * DIRECTORY, ~/.grok (the default) or ~/.grok-<label>, and an agent runs on it
 * through one launch variable, GROK_HOME -- exactly where a codex agent gets
 * CODEX_HOME and a Claude agent gets CLAUDE_CONFIG_DIR. groksession.HOME() reads
 * GROK_HOME VERBATIM as the storage root (sessions/ sit directly under it), so a
 * grok account is the SYMMETRIC case: the account dir, the env value, the key
 * file's home and the session home are all ONE directory. (Gemini is the
 * asymmetric sibling; see engine/geminiaccounts.js.)
 *
 * 🔑 WHERE THE KEY LIVES, AND WHY NOT A FILE THE CLI POINTS AT. codex keeps its
 * key in auth.json inside CODEX_HOME, so openaiaccounts never stores a key of its
 * own -- codex's own login writes the file codex reads. Grok has no such file:
 * the interactive CLI reads its key from the XAI_API_KEY ENV VAR (measured, grok
 * 1.0.41: "Logged in with API key" with just XAI_API_KEY set, no config written).
 * So per-account key delivery is NEW plumbing with no codex precedent -- this
 * module stores the raw key in a mode-600 file inside the account dir
 * (.kosmos-grok-apikey), the SAME discipline claudeaccounts uses for its own
 * apiKeyHelper file, and bin/agent-supervisor.sh reads that file for a
 * per-account grok agent and exports XAI_API_KEY into the pane env. The DEFAULT
 * account keeps the machine-global secrets/env door (unchanged).
 *
 * 🛑 THE KEY IS NEVER RETURNED, LOGGED, OR PASSED AS AN ARGUMENT. It is written
 * to a mode-600 file on the person's own Mac and read from there; identity for an
 * api-key account is the key's last four characters, the same tail codex's own
 * `login status` shows.
 *
 * THE SAME FAIL-OPEN DISCIPLINE as openaiaccounts / claudeaccounts / subscription:
 *  - ABSENT vs UNREADABLE are two DIFFERENT facts. No key file is a positive NONE
 *    (nobody configured a key here); a file that cannot be read is UNKNOWN.
 *  - A live check reddens (NONE) ONLY on xAI's own positive rejection of the key;
 *    unreachable / a non-attributed refusal is UNKNOWN, never a guessed NONE that
 *    blocks a good key.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const subscription = require('./subscription');
const inflight = require('./inflight');

const STATE = subscription.STATE; // CONNECTED | NONE | UNKNOWN -- one vocabulary
const PROVIDER = 'xai';
/* "Grok", not "xAI / Grok": Grok is the name the screen uses and the word a
   person types when they ask to connect it (see the connect-a-provider brief). */
const PROVIDER_NAME = 'Grok';

/* 🛑 A FUNCTION, NOT A CONST (the #1337 rule openaiaccounts states at length):
   frozen at require time it would make list() disagree with itself when a caller
   sets AGENT_WORKFORCE_HOME after requiring this module. Lazy resolution is
   strictly more permissive and matches every other caller. */
function homeDir() { return process.env.AGENT_WORKFORCE_HOME || os.homedir(); }

/* The default grok home. Mirrors create.defaultAgentGrokHome EXACTLY (its sibling
   on the launch side) so the account list and the launcher name the same default
   home: AGENT_WORKFORCE_GROK_HOME wins (tests + our own launcher point it at a
   sandbox / the account dir), else <home>/.grok. The operator's own ambient
   GROK_HOME is deliberately NOT honoured as the default -- a default-account agent
   is pinned to the standard ~/.grok the board knows, and a per-account home is
   carried by the account's dir, never by an ambient env var. */
function defaultDir() {
  return process.env.AGENT_WORKFORCE_GROK_HOME || path.join(homeDir(), '.grok');
}

const DIR_PREFIX = '.grok-';

/* The mode-600 file, inside the account dir, that holds the raw key. A dotfile so
   it does not read as project content; 0600 so only the owner can read it. GROK_HOME
   is the account dir verbatim, so the supervisor reads $GROK_HOME/.kosmos-grok-apikey
   -- the same path this returns for that dir. */
const KEY_BASENAME = '.kosmos-grok-apikey';
function keyFile(dir) { return path.join(path.resolve(String(dir || '')), KEY_BASENAME); }

/* #2095 sibling: the human-chosen display NAME, in a small sidecar file inside the
   account dir, kept SEPARATE from the path label (which is cleanLabel-slugged).
   Best-effort and fail-open everywhere: a missing/unreadable file is a real "no
   name" (null), never an error. */
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

/* Read the stored raw key for an account dir. Three outcomes kept distinct, the
   same split readAuthFile keeps for openai: absent (no file), unreadable (a file
   that cannot be read), ok (the trimmed key). An empty file is `unreadable`-ish
   for identity purposes -- there is a file but no usable key -- so it returns ok
   with an empty string and callers treat empty as "no usable key". */
function readKey(dir) {
  let raw;
  try { raw = fs.readFileSync(keyFile(dir), 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unreadable' };
  }
  return { kind: 'ok', key: String(raw).trim() };
}

/** What we know about who this account is, read from the stored key file, or null
    when nothing usable is stored here (no file, unreadable, or an empty file).
    An api-key account's identity is the key's last four characters -- never the
    key. */
function identityOf(dir) {
  const got = readKey(dir);
  if (got.kind !== 'ok' || !got.key) return null;
  return { authMode: 'apikey', email: null, keyTail: got.key.slice(-4) };
}

function rowFor(dir, isDefault) {
  const who = identityOf(dir);
  /* Gate on a stored key, default INCLUDED -- exactly as openaiaccounts gates its
     default on identityOf(auth.json). A grok account (default or labelled) appears
     here only once it has a per-account key file. The machine-global-door default
     (no key file) is deliberately NOT listed by this subsystem; surfacing it is the
     connect-UI / observability follow-on's job, and gating on a per-account artifact
     keeps this module from reaching into the global env/secrets door. */
  if (!who) return null;
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

/** Every Grok account on this computer, the default first. READ, never asserted. */
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

/* ---- live key verification (xAI) ------------------------------------------ */

/* Own fetcher seam (tests), per the per-module convention every external-I/O
   boundary in this codebase keeps. */
let fetcher = null;
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

/**
 * Ask xAI whether this key works: GET /v1/models, the cheap verification call
 * (the same call openaiaccounts makes of OpenAI). 200 = works; a 401/403 that xAI
 * positively attributes to the key = rejected; anything else / unreachable = we
 * could not confirm. The URL is overridable for the browser-check harness (a real
 * server process the setFetcher seam cannot reach), exactly like openaiaccounts'
 * models URL.
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
  const url = process.env.AGENT_WORKFORCE_XAI_MODELS_URL || 'https://api.x.ai/v1/models';
  try {
    return await f(url, { method: 'GET', headers: { authorization: 'Bearer ' + String(key || '') } });
  } catch {
    /* NO raw err.message: the same rule subscription.js / openaiaccounts keep -- a
       network error can carry anything, and this module's job is sentences a person
       can read. */
    return { status: 0, body: null, unreachable: true, because: 'we could not reach xAI to check whether this key still works' };
  }
}

/**
 * The live verdict for a raw key. Same asymmetry as openaiaccounts.checkLive /
 * claudeaccounts.validateLive: only xAI's own positive rejection (a 401/403 the
 * API attributes to a bad key) is NONE; a 200 is CONNECTED; unreachable or any
 * other refusal is UNKNOWN -- we asked and could not confirm the key is bad, so we
 * never guess NONE.
 */
async function validateLive(key) {
  const r = await askModels(key);
  if (r.unreachable) return { state: STATE.UNKNOWN, because: r.because };
  if (r.status === 200) return { state: STATE.CONNECTED, because: 'xAI confirmed this key works' };
  if (r.status === 401 || r.status === 403) {
    /* Positive NONE ONLY on a STRUCTURED code/type field, NEVER the free-text message.
       A fuzzy substring match on the message reds a good key whenever an unrelated 401/403
       merely mentions "authentication" -- exactly the false-NONE class openaiaccounts
       narrowed away (#1315/#2140), and the reason claudeaccounts (type === 'authentication_error')
       and openaiaccounts (code === 'invalid_api_key') both key on an EXACT structured field.
       xAI's API is OpenAI-shaped, so the invalid-key signal is the code `invalid_api_key` (or
       an explicit authentication_error type). An unrecognized code errs to UNKNOWN: we do not
       confirm the key is bad, so we never block a good one. The cost is a genuinely bad key
       whose code we do not recognize is accepted and shown unconfirmed -- the same fail-open
       trade the siblings make, and the correct direction (a false NONE is the worse error). */
    /* Read the structured code from BOTH shapes xAI could return: the nested
       OpenAI-style `{error:{code}}` AND a flat `{code, error:"<message>"}` where
       error is a message STRING. `r.body.error` is the error OBJECT only when it is
       one; a flat body carries the code at the top level. Reading only the nested
       shape would leave the NONE path dead for a flat body (safe -- it degrades to
       UNKNOWN, never reds a good key -- but it would never positively reject either). */
    const errObj = (r.body && typeof r.body.error === 'object' && r.body.error)
      ? r.body.error
      : (r.body && typeof r.body === 'object' ? r.body : null);
    const code = errObj ? (errObj.code || errObj.type || '') : '';
    if (/^\s*(invalid_api_key|authentication_error|invalid_authentication)\s*$/i.test(String(code))) {
      return { state: STATE.NONE, because: 'xAI did not accept this key' };
    }
    return { state: STATE.UNKNOWN, because: 'xAI refused to check this key in a way that does not confirm the key itself is bad' };
  }
  return { state: STATE.UNKNOWN, because: 'we asked xAI whether this key still works and it answered ' + (r.status || 'nothing usable') };
}

/**
 * checkLive for a stored api-key Grok account: read the key file and verify it.
 * ABSENT vs UNREADABLE stay two different facts (the same split openaiaccounts and
 * claudeaccounts keep): no key file is a positive NONE (nobody configured a key
 * here); a file that cannot be read is UNKNOWN, never a guessed NONE.
 *
 * `opts.cached` is accepted for signature-parity with openaiaccounts.checkLive
 * (its ChatGPT liveness has a cache; an api-key check has none), so listLive can
 * call every provider's checkLive the same way. It is a no-op here.
 */
async function checkLive(dir, _opts) {
  const got = readKey(dir);
  if (got.kind === 'absent') return { state: STATE.NONE, checkedLive: true, because: 'no API key is stored for this account' };
  if (got.kind === 'unreadable') return { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not read this account\'s stored key to check it' };
  if (!got.key) return { state: STATE.UNKNOWN, checkedLive: true, because: 'this account\'s stored key is empty' };
  const live = await validateLive(got.key);
  return { ...live, checkedLive: true };
}

/* ---- add / store / forget / remove ---------------------------------------- */

/** A shape complaint about a pasted key, or null if it looks usable. Mirrors the
    other providers' keyProblem: empty / whitespace / too-short only. Deliberately
    NOT a prefix check -- the LIVE check is the real gate, and a shape check must
    never be the thing that blocks a valid key whose prefix xAI later changes. */
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

/** The account dir for a label, or a refusal. `default`/empty is refused (the
    default is not credentialed through this subsystem -- it is the machine-global
    door). The slug is [a-z0-9-]; a label that slugs to nothing is refused. */
function dirForLabel(label) {
  const slug = cleanLabel(label);
  if (!slug) return { ok: false, because: 'give this account a name using letters, numbers or dashes' };
  if (slug === 'default') return { ok: false, because: '"default" is reserved for your main Grok account' };
  return { ok: true, label: slug, dir: path.join(homeDir(), DIR_PREFIX + slug) };
}

/** The first free unlabelled work slot, the way openaiaccounts.nextWorkDir hands
    one out. A dir that exists but holds no key file is free too (a cancelled add
    leaves exactly that shape and must not eat a spot forever). */
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

/**
 * Write the raw key to the account's mode-600 file. Atomic (temp + rename) and
 * WITHOUT a trailing newline, so a reader that cats it hands the CLI exactly the
 * key. 0600 at create, re-chmod'd on overwrite. Creates the account dir if absent.
 * Mirrors claudeaccounts.storeKey exactly.
 */
function storeKey(dir, key) {
  const d = path.resolve(String(dir || ''));
  /* 🛑 An account is an ISOLATED directory, never a symlink. Refuse to write THROUGH one: a
     planted ~/.grok-x -> ~/.grok would otherwise land the key file inside the real CLI home
     (mkdir/writeFile follow symlinks; lstat does not). ENOENT = fresh account, which creates a
     real dir below. See geminiaccounts.storeKey for the full reasoning. */
  let st = null;
  try { st = fs.lstatSync(d); } catch { st = null; }
  if (st && st.isSymbolicLink()) throw new Error('an account directory must not be a symlink');
  fs.mkdirSync(d, { recursive: true });
  const file = keyFile(d);
  const tmp = file + '.tmp';
  /* Unlink any stale temp from a prior crash first, so the write below CREATES the
     file and its 0600 create-mode applies from the first byte. */
  try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  fs.writeFileSync(tmp, String(key || '').trim(), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort; create mode already set */ }
}

function forgetKey(dir) {
  /* Remove the key file AND any leftover temp: a storeKey whose write/rename failed
     part-way can leave <keyfile>.tmp holding the raw key (mode 0600), so cleanup
     must take back BOTH or a plaintext key lingers. */
  let ok = false;
  try { fs.rmSync(keyFile(dir), { force: true }); ok = true; } catch { ok = false; }
  try { fs.rmSync(keyFile(dir) + '.tmp', { force: true }); } catch { /* best effort */ }
  return ok;
}

/** The prefix a forgotten account's dir is renamed to. It REPLACES DIR_PREFIX, it
    does not extend it (the openaiaccounts trick): list() finds accounts by the
    DIR_PREFIX, so `~/.grok-work.removed` would still be listed. Moving the prefix
    is what makes the directory invisible to the only definition of "an account". */
const FORGOTTEN_PREFIX = '.removed-grok-';

/**
 * Forget a Grok account WITHOUT deleting the credential: rename its dir aside so it
 * stops being listed, but the key stays on the person's own computer (reversible).
 * Mirrors openaiaccounts.forgetAccount, minus the ChatGPT-reauth guard (grok has no
 * OAuth sign-in in flight to protect).
 *
 * `usedBy` is supplied by the caller (the route knows which agents run on the dir;
 * this module cannot ask without a cycle through create.js).
 */
function forgetAccount(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const base = path.basename(clean);

  /* Only ever a grok home directly inside this computer's home. Defence in depth on
     an unauthenticated local endpoint that renames directories. */
  /* 🛑 Defence in depth on a directory-renaming endpoint: the DEFAULT home (~/.grok) is the
     machine's own CLI home, NOT a per-account artifact this subsystem manages (never credentialed
     or listed here), so it is never ours to move. Refusing it closes the rm-your-whole-CLI-home
     path a manually-placed key file could otherwise open on the remove sibling. A deliberate
     DIVERGENCE from openaiaccounts, whose default IS disconnectable/deletable (#2684) because it is
     a codex-only home Kosmos manages; grok's default is the unmanaged machine-global key door. */
  if (clean === path.resolve(defaultDir())) {
    return { ok: false, forgotten: false, because: 'the default Grok account is your computer\'s own Grok home; Kosmos does not manage it here, so it cannot be disconnected' };
  }
  if (path.dirname(clean) !== home || !base.startsWith(DIR_PREFIX)) {
    return { ok: false, forgotten: false, because: 'that is not a Grok account on this computer' };
  }
  // An account is a real directory, not a symlink (see storeKey). A crafted symlink named like an
  // account is not one -- refuse it so forget never renames a path that points somewhere else.
  let st = null;
  try { st = fs.lstatSync(clean); } catch { st = null; }
  if (st && st.isSymbolicLink()) {
    return { ok: false, forgotten: false, because: 'that is not a Grok account on this computer' };
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
  /* THE NAME IS NOT THE ACCOUNT: a name-shaped dir that holds no key is not ours to
     move. Refuse it rather than rename a folder the person made. */
  if (!identityOf(clean)) {
    return { ok: false, forgotten: false, because: 'that is not a Grok account on this computer' };
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

/**
 * DELETE and remove a Grok account -- the destructive sibling of forgetAccount.
 * forgetAccount renames aside (reversible); this rmSync's the dir, so the key is
 * gone from this computer. Every guard forgetAccount has (same-home + name shape,
 * the running-agents gate, the identity guard). Irreversible on purpose; the UI
 * asks with a destructive confirm.
 */
function removeAccount(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const base = path.basename(clean);

  /* The remove sibling of forgetAccount's default guard, and the one the hazard is really about:
     without it a remove:true on the default would rmSync the user's entire ~/.grok CLI home.
     See forgetAccount for the full reasoning and the openaiaccounts divergence. */
  if (clean === path.resolve(defaultDir())) {
    return { ok: false, removed: false, because: 'the default Grok account is your computer\'s own Grok home; Kosmos does not manage it here, so it cannot be deleted' };
  }
  if (path.dirname(clean) !== home || !base.startsWith(DIR_PREFIX)) {
    return { ok: false, removed: false, because: 'that is not a Grok account on this computer' };
  }
  // Refuse a crafted symlink (see storeKey / forgetAccount): rmSync removes the LINK not its
  // target, so it is already data-loss-safe, but a symlink is not a managed account.
  let st = null;
  try { st = fs.lstatSync(clean); } catch { st = null; }
  if (st && st.isSymbolicLink()) {
    return { ok: false, removed: false, because: 'that is not a Grok account on this computer' };
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
    return { ok: false, removed: false, because: 'that is not a Grok account on this computer' };
  }
  try { fs.rmSync(clean, { recursive: true, force: true }); }
  catch { return { ok: false, removed: false, because: 'we could not delete that account from this computer' }; }
  return { ok: true, removed: true, wasDefault: false, because: null };
}

/* ---- live list ------------------------------------------------------------ */

/** Every Grok account, live-checked. One bad row's own failure cannot sink the
    others -- caught individually, falling back to UNKNOWN, never a false NONE.
    Mirrors openaiaccounts.listLiveNow's exact contract. */
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

/* One shared sweep for concurrent callers (the #1618 collapse openaiaccounts uses):
   the slot holds the promise only while unsettled, so no answer outlives the moment
   it was true. Not a cache. */
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
