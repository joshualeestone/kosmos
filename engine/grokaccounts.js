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
 * 🔑 TWO KINDS OF GROK ACCOUNT, and the key file wins when a dir has both.
 *  - API KEY: the interactive CLI reads its key from the XAI_API_KEY ENV VAR
 *    (measured, grok 1.0.41: "Logged in with API key" with just XAI_API_KEY set).
 *    Nothing the CLI writes holds it, so this module keeps its own copy (below).
 *  - SUBSCRIPTION (#3391): `grok login --device-auth` writes GROK_HOME/auth.json,
 *    one object keyed `https://auth.x.ai::<uuid>` holding the sign-in (email,
 *    refresh_token, expires_at, ...), mode 0600. The CLI reads it back itself, so
 *    this module only reads it (for identity, and for whether it has lapsed) and never
 *    stores a credential of its own.
 *    An EMPTY XAI_API_KEY still counts as set to grok ("You are using XAI_API_KEY",
 *    measured), which is why the supervisor REMOVES the variable for this kind.
 * For the API-key kind, per-account key delivery is NEW plumbing with no codex
 * precedent -- this module stores the raw key in a mode-600 file inside the account dir
 * (.kosmos-grok-apikey), the SAME discipline claudeaccounts uses for its own
 * apiKeyHelper file, and bin/agent-supervisor.sh reads that file for a
 * per-account grok agent and exports XAI_API_KEY into the pane env. The DEFAULT
 * account keeps the machine-global secrets/env door unless ~/.grok holds a
 * subscription sign-in (#3391), in which case the supervisor removes the key.
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
 *    blocks a good key. A SUBSCRIPTION account is judged offline and reddens only on
 *    a provable lapse: no refresh token and an expiry in the past (#3391).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const subscription = require('./subscription');
const inflight = require('./inflight');
const accountclaim = require('./accountclaim');
const runners = require('./runners');

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
   carried by the account's dir, never by an ambient env var. (The supervisor's grok
   arm reads GROK_HOME first, but that variable reaches it only from a PER-ACCOUNT
   plist: launchd starts it with exactly the plist's EnvironmentVariables. For a
   default agent it computes these same tiers, so the two agree; #3391.) */
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

/* The grok CLI's own sign-in file for a subscription account. */
const AUTH_BASENAME = 'auth.json';
const AUTH_ISSUER_PREFIX = 'https://auth.x.ai::';
function authFile(dir) { return path.join(path.resolve(String(dir || '')), AUTH_BASENAME); }

/* Read a subscription sign-in: absent (no file), unreadable (cannot read or parse,
   or no auth.x.ai entry), or ok with the ONE auth.x.ai entry. Two entries is
   `unreadable`: we could not say which one grok will use. The entry holds the refresh
   token, so no caller may hand it to a page or a log: rows carry only the email. */
function readAuth(dir) {
  let raw;
  try { raw = fs.readFileSync(authFile(dir), 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unreadable' };
  }
  let data;
  try { data = JSON.parse(raw); } catch { return { kind: 'unreadable' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { kind: 'unreadable' };
  const keys = Object.keys(data).filter((k) => k.startsWith(AUTH_ISSUER_PREFIX));
  if (keys.length !== 1) return { kind: 'unreadable' };
  const entry = data[keys[0]];
  if (!entry || typeof entry !== 'object') return { kind: 'unreadable' };
  return { kind: 'ok', entry };
}

/** What we know about who this account is, or null when nothing usable is here.
    The key file wins (an api-key account; identity is the key's last four
    characters, never the key). Otherwise a readable auth.x.ai sign-in is a
    subscription account, identified by its email. */
function identityOf(dir) {
  const got = readKey(dir);
  if (got.kind === 'ok' && got.key) return { authMode: 'apikey', email: null, keyTail: got.key.slice(-4) };
  /* A key file that is there but cannot be read is not "no key": we cannot say what
     kind of account this is, so it is not described at all (checkLive says UNKNOWN). */
  if (got.kind === 'unreadable') return null;
  const auth = readAuth(dir);
  if (auth.kind !== 'ok') return null;
  const email = typeof auth.entry.email === 'string' && auth.entry.email ? auth.entry.email : null;
  return { authMode: 'subscription', email, keyTail: null };
}

function rowFor(dir, isDefault) {
  const who = identityOf(dir);
  /* Gate on a per-account credential, default INCLUDED -- exactly as openaiaccounts
     gates its default on identityOf(auth.json): a key file, or a subscription
     auth.json. A default that relies only on the machine-global XAI_API_KEY door
     (neither file) is not listed; this module never reads that door. */
  if (!who) return null;
  return {
    provider: PROVIDER,
    providerName: PROVIDER_NAME,
    dir,
    label: isDefault ? null : path.basename(dir).replace(new RegExp('^' + DIR_PREFIX.replace('.', '\\.')), ''),
    name: readName(dir),
    isDefault: isDefault === true,
    email: who.email,
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
  if (got.kind === 'absent') return subscriptionVerdict(dir);
  if (got.kind === 'unreadable') return { state: STATE.UNKNOWN, checkedLive: true, because: 'we could not read this account\'s stored key to check it' };
  /* An empty key file does not make an api-key account (identityOf and the supervisor
     both say so), so a dir that also holds a sign-in is judged as the sign-in. */
  if (!got.key) {
    if (readAuth(dir).kind !== 'absent') return subscriptionVerdict(dir);
    return { state: STATE.UNKNOWN, checkedLive: true, because: 'this account\'s stored key is empty' };
  }
  const live = await validateLive(got.key);
  return { ...live, checkedLive: true };
}

/* A subscription account, judged OFFLINE from its auth.json (#3391). grok has no
   `login status`, `grok models` lists models even with an empty key, and refreshing a
   person's token from a probe is not ours to do. (#3997 adds a separate free live check,
   subscriptionLive below, for a key that has not expired.) So a
   sign-in grok can renew (a refresh token) or one still inside its expiry is
   CONNECTED; the /api/accounts overlay in server.js badges it signed_in_unverified
   until a real grok session succeeds on it. NONE only for a sign-in that has
   provably lapsed. */
function subscriptionVerdict(dir) {
  const auth = readAuth(dir);
  if (auth.kind === 'absent') return { state: STATE.NONE, checkedLive: true, because: 'nobody has connected this account yet' };
  if (auth.kind === 'unreadable') return { state: STATE.UNKNOWN, checkedLive: true, because: 'Could not read the Grok sign-in' };
  const e = auth.entry;
  if (typeof e.refresh_token === 'string' && e.refresh_token) {
    return { state: STATE.CONNECTED, checkedLive: true, because: 'signed in with your Grok subscription' };
  }
  const until = typeof e.expires_at === 'string' ? Date.parse(e.expires_at) : NaN;
  if (!Number.isFinite(until)) return { state: STATE.UNKNOWN, checkedLive: true, because: 'Could not check the Grok sign-in' };
  if (until > Date.now()) return { state: STATE.CONNECTED, checkedLive: true, because: 'signed in with your Grok subscription' };
  /* Pill-sized: a long sentence overflows the account pill (#2568). The remedy is the
     row's own Sign in again button (startGrokLogin with reauthDir), not this text. */
  return { state: STATE.NONE, checkedLive: true, because: 'Grok sign-in expired' };
}

/* #3997: a FREE live check for a subscription sign-in. grok's stored key is short-lived (about six hours, measured
   2026-09-26) and grok renews it itself whenever it runs. Kosmos never renews it: a renewal rotates the refresh token
   under a running grok (#3391). So only a key that has not expired is checked, with the same models listing grok
   itself reads (cli-chat-proxy.grok.com/v1/models, measured: 200 with a working sign-in, 401 with a bad key). It
   spends nothing.
     live       200: the sign-in works right now.
     refused    401/403: not confirmed. Not "dead": grok may renew it on its next run.
     expired    the key has expired, so there is nothing to check until grok runs again.
     unknown    no answer (network, an unreadable file, anything else); never a negative. */
const SUBSCRIPTION_EXPIRY_MARGIN_MS = 60 * 1000;
/* Callers asking about the same folder at the same moment (two screens reading the list) share one request. */
const subscriptionLiveInflight = new Map();
function subscriptionLive(dir) {
  const key = path.resolve(String(dir || ''));
  if (subscriptionLiveInflight.has(key)) return subscriptionLiveInflight.get(key);
  const p = subscriptionLiveOnce(dir).finally(() => subscriptionLiveInflight.delete(key));
  subscriptionLiveInflight.set(key, p);
  return p;
}
async function subscriptionLiveOnce(dir) {
  const auth = readAuth(dir);
  if (auth.kind !== 'ok') return { verdict: 'unknown', because: 'Could not read the Grok sign-in' };
  const e = auth.entry;
  const until = typeof e.expires_at === 'string' ? Date.parse(e.expires_at) : NaN;
  if (typeof e.key !== 'string' || !e.key || !Number.isFinite(until) || until <= Date.now() + SUBSCRIPTION_EXPIRY_MARGIN_MS) {
    return { verdict: 'expired', because: 'Grok renews this sign-in the next time it runs, so it cannot be checked until then' };
  }
  const f = fetcher || (async (url, init) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      return { status: res.status };
    } finally { clearTimeout(t); }
  });
  const url = process.env.AGENT_WORKFORCE_GROK_SUB_MODELS_URL || 'https://cli-chat-proxy.grok.com/v1/models';
  let r;
  try { r = await f(url, { method: 'GET', headers: { authorization: 'Bearer ' + e.key } }); }
  catch { return { verdict: 'unknown', because: 'we could not reach Grok to check this sign-in' }; }
  const status = r && r.status;
  if (status === 200) return { verdict: 'live', because: 'Grok confirmed this sign-in works' };
  if (status === 401 || status === 403) return { verdict: 'refused', because: 'Grok did not accept this sign-in just now. Signing in again fixes it' };
  return { verdict: 'unknown', because: 'we asked Grok about this sign-in and could not tell' };
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
    default is the machine's own ~/.grok: its key door or its own sign-in, never a
    named account). The slug is [a-z0-9-]; a label that slugs to nothing is refused. */
function dirForLabel(label) {
  const slug = cleanLabel(label);
  if (!slug) return { ok: false, because: 'give this account a name using letters, numbers or dashes' };
  if (slug === 'default') return { ok: false, because: '"default" is reserved for your main Grok account' };
  return { ok: true, label: slug, dir: path.join(homeDir(), DIR_PREFIX + slug) };
}

/** The first free unlabelled work slot, the way openaiaccounts.nextWorkDir hands
    one out. A dir that exists but holds neither a key file nor a sign-in is free too
    (a cancelled add leaves exactly that shape and must not eat a spot forever). */
function nextWorkDir(exclude) {
  for (let n = 1; n <= 500; n += 1) {
    const label = `work${n}`;
    const dir = path.join(homeDir(), DIR_PREFIX + label);
    if (exclude && exclude.has(dir)) continue;
    if (!fs.existsSync(dir)) return { label, dir };
    if (!fs.existsSync(keyFile(dir)) && !fs.existsSync(authFile(dir))) return { label, dir };
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
 * stops being listed, but the key or sign-in stays on the person's own computer
 * (reversible). Mirrors openaiaccounts.forgetAccount, including its refusal of a dir
 * a live sign-in holds (#3391).
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
     machine's own CLI home, NOT a per-account artifact this subsystem manages (listed
     when it holds a key or a sign-in, never credentialed by this module), so it is
     never ours to move. Refusing it closes the rm-your-whole-CLI-home
     path a manually-placed key file could otherwise open on the remove sibling. A deliberate
     DIVERGENCE from openaiaccounts, whose default IS disconnectable/deletable (#2684) because it is
     a codex-only home Kosmos manages; grok's default is the machine's own home (the key door or its own sign-in). */
  if (clean === path.resolve(defaultDir())) {
    return { ok: false, forgotten: false, because: 'the default Grok account is your computer\'s own Grok home; Kosmos does not manage it here, so it cannot be disconnected' };
  }
  if (path.dirname(clean) !== home || !base.startsWith(DIR_PREFIX)) {
    return { ok: false, forgotten: false, because: 'that is not a Grok account on this computer' };
  }
  if (activeGrokDirs.has(clean)) {
    return { ok: false, forgotten: false, because: 'a sign-in for that account is still in progress; finish or cancel it first' };
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
  if (activeGrokDirs.has(clean)) {
    return { ok: false, removed: false, because: 'a sign-in for that account is still in progress; finish or cancel it first' };
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

/* ---- subscription sign-in (#3391) -----------------------------------------
 *
 * The grok mirror of openaiaccounts' ChatGPT sign-in driver (#2338): spawn
 * `grok login --device-auth` ASYNC into a FRESH account dir (GROK_HOME), keep a
 * session the route polls, and on a clean exit accept the dir only if it now reads
 * back as a subscription account. Device mode only.
 *
 * Sign in AGAIN (#3391 part 2) is the openaiaccounts #2584 shape, for the same reason:
 * the sign-in runs in a fresh STAGING slot exactly like a new one, and only a sign-in
 * that finished AND reads back as the same email is moved over the live auth.json, in
 * one rename. The live account is never in a cleanup path, so a failed, cancelled or
 * timed-out sign-in again cannot lose it or leave a second account beside it.
 *
 * Measured against grok 1.0.41 (2026-09-24, in a throwaway GROK_HOME): it prints
 *   https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH
 * then the code again on its own line, then waits. It honours GROK_HOME. Its leader
 * socket defaults to the machine's ~/.grok/leader.sock, so each sign-in passes its
 * own `--leader-socket` in the temp dir (see startGrokLogin).
 *
 * The session lives as long as the server process, as in openaiaccounts. */
/* One copy of the no-runner sentence: the start route reads this too (the
   openaiaccounts.MISSING_RUNNER_SENTENCE pattern). */
const MISSING_RUNNER_SENTENCE = 'we could not find the Grok runner on this computer, so there is nothing to sign in to';
const grokSessions = new Map();
// What `grok login` writes into GROK_HOME (measured, grok 1.0.41), for reused-slot cleanup.
const GROK_WRITES = [AUTH_BASENAME, 'docs', 'logs'];
let grokLoginTimeoutMs = 5 * 60 * 1000;
let grokSessionTtlMs = 2 * 60 * 1000;
let grokForceKillMs = 3000;
function setGrokTimers({ timeout, ttl, forceKill } = {}) {
  if (Number.isFinite(timeout)) grokLoginTimeoutMs = timeout;
  if (Number.isFinite(ttl)) grokSessionTtlMs = ttl;
  if (Number.isFinite(forceKill)) grokForceKillMs = forceKill;
}
// Dirs a live (non-terminal) sign-in holds; forget/remove refuse them too.
const activeGrokDirs = new Set();
const GROK_TERMINAL = new Set(['connected', 'error', 'cancelled']);
function grokIsTerminal(session) { return GROK_TERMINAL.has(session.state); }
function reapGrokSession(session) {
  if (session.reaped) return;
  session.reaped = true;
  if (session.timer) { clearTimeout(session.timer); session.timer = null; }
  const t = setTimeout(() => { grokSessions.delete(session.id); }, grokSessionTtlMs);
  if (t && typeof t.unref === 'function') t.unref();
}
function armGrokForceKill(session) {
  const t = setTimeout(() => {
    if (session.exited) return;
    try { session.child.kill('SIGKILL'); } catch { /* best effort */ }
  }, grokForceKillMs);
  if (t && typeof t.unref === 'function') t.unref();
  session.forceKillTimer = t;
}

/* Pull the verification URL and the user code out of grok's output. The URL is the
   first https URL; the code is the hyphenated uppercase token, searched with URLs
   removed so the user_code inside the URL is not what we read. */
function parseGrokLoginOutput(text) {
  const out = {};
  const s = String(text);
  /* https only (the page renders it as a link), and only once whitespace FOLLOWS it:
     output arrives in chunks, the first URL seen is kept, and a URL cut off at a chunk
     end must not be stored as the link (round 20). */
  const url = (s.match(/https:\/\/[^\s'"<>]+(?=\s)/g) || [])
    .map((u) => u.replace(/[.,;:!?)\]}'"]+$/, ''))[0];
  if (url) out.authUrl = url;
  const code = s.replace(/https?:\/\/[^\s'"<>]+/g, ' ').match(/\b[A-Z0-9]{3,8}-[A-Z0-9]{3,8}\b/);
  if (code) out.userCode = code[0];
  return out;
}

/* A fresh dir for a sign-in: a named one must not already hold an account or a live
   sign-in; otherwise the first free work slot. madeDir says whether WE created it,
   so cleanup never deletes a dir it did not make. */
function resolveFreshGrokDir(label) {
  let spot;
  if (label != null && String(label).trim()) {
    const got = dirForLabel(label);
    if (!got.ok) return { error: got.because };
    /* Refuse on the FILES, not on identityOf: an auth.json we cannot describe (two entries,
       bad JSON) is still someone's credentials, and a failed sign-in's cleanup would delete it. */
    if (holdsCredentials(got.dir)) return { error: 'there is already a Grok account by that name on this computer' };
    if (activeGrokDirs.has(got.dir)) return { error: 'a sign-in for that name is already in progress' };
    if (accountclaim.claimHeld(got.dir)) return { error: 'another Grok account is being added under that name right now; try again in a moment' };
    spot = { label: got.label, dir: got.dir };
  } else {
    // Skip slots a live sign-in holds AND slots an API-key add has claimed.
    const skip = new Set(activeGrokDirs);
    for (;;) {
      spot = nextWorkDir(skip);
      if (!spot) return { error: 'we could not find a free spot for another account' };
      // A symlinked slot is skipped, not fatal (the unnamed key add does the same).
      let link = null;
      try { link = fs.lstatSync(spot.dir); } catch { link = null; }
      if (link && link.isSymbolicLink()) { skip.add(spot.dir); continue; }
      if (!accountclaim.claimHeld(spot.dir)) break;
      skip.add(spot.dir);
    }
  }
  let st = null;
  try { st = fs.lstatSync(spot.dir); } catch { st = null; }
  if (st && st.isSymbolicLink()) return { error: 'we could not make a place for that account on this computer' };
  let madeDir;
  try { fs.mkdirSync(spot.dir); madeDir = true; }
  catch (e) {
    if (e && e.code === 'EEXIST') madeDir = false;
    else return { error: 'we could not make a place for that account on this computer' };
  }
  // A reused slot must not hand an earlier account's display name to this one.
  if (!madeDir) { try { fs.unlinkSync(nameFile(spot.dir)); } catch { /* none */ } }
  return { dir: spot.dir, label: spot.label, madeDir };
}

/* A dir handed in to sign in AGAIN: it must be this computer's default grok home or a
   .grok-<name> dir directly in the home (so an arbitrary path is "not an account"), hold
   no key file, and hold a subscription sign-in whose email we can read. The email is what
   tells a refresh from a swap, so an account without one cannot be refreshed in place. */
function reauthTarget(dir) {
  const clean = path.resolve(String(dir == null ? '' : dir));
  const isDefault = clean === path.resolve(defaultDir());
  const named = path.dirname(clean) === path.resolve(homeDir()) && path.basename(clean).startsWith(DIR_PREFIX);
  if (!isDefault && !named) return { error: 'that is not a Grok account on this computer' };
  /* A symlinked account dir is refused, as storeKey, forget and remove refuse one: the rename
     below would otherwise write through the link into wherever it points. */
  let st = null;
  try { st = fs.lstatSync(clean); } catch { st = null; }
  if (st && st.isSymbolicLink()) return { error: 'that is not a Grok account on this computer' };
  const who = identityOf(clean);
  if (!who) return { error: 'that account has no readable sign-in to refresh' };
  if (who.authMode !== 'subscription') return { error: 'that account is an API key, not a Grok subscription' };
  if (!who.email) return { error: 'we could not read this account\'s identity, so it cannot be refreshed in place' };
  return { dir: clean, isDefault, expectEmail: who.email };
}

/* Move a finished sign-in's auth.json from the staging slot over the live one. One
   rename: the live file is replaced whole or not at all, and the staging copy is gone in
   the same call, so list() never sees two accounts for one person. WHOLE means the file
   grok just wrote replaces the old one, any other entries in it included, which is what a
   fresh `grok login` in that home would leave too (the openaiaccounts #2584 choice). */
function promoteReauth(stagingDir, liveDir) {
  try { fs.renameSync(authFile(stagingDir), authFile(liveDir)); return { ok: true }; }
  catch { return { ok: false, because: 'we signed in but could not update this account on the computer' }; }
}

/* The one existing subscription account a new sign-in as `email` belongs to, as a
   reauthTarget, or null: no email, no match, more than one match, or the match is being
   signed in already. `exceptDir` is the new sign-in's own slot. */
function sameAccountFor(email, exceptDir) {
  if (!email) return null;
  const want = String(email).toLowerCase();
  const skip = path.resolve(String(exceptDir || ''));
  const hits = list().filter((a) => a.authMode === 'subscription' && a.email
    && a.email.toLowerCase() === want && path.resolve(a.dir) !== skip);
  if (hits.length !== 1) return null;
  const t = reauthTarget(hits[0].dir);
  if (t.error || activeGrokDirs.has(t.dir)) return null;
  return t;
}

/**
 * Start a Grok subscription sign-in. Non-blocking; poll grokLoginStatus.
 * `reauthDir` signs in again AS that existing subscription account (see above); `label`
 * is then ignored, since the account keeps its own name.
 * @param {{label?:string, grokBin:string, reauthDir?:string}} args
 * @returns {{ok:true, sessionId:string} | {ok:false, because:string}}
 */
function startGrokLogin({ label, grokBin, reauthDir } = {}) {
  const bin = String(grokBin || '');
  if (!bin || !runners.isRunnable(bin)) return { ok: false, because: MISSING_RUNNER_SENTENCE };
  let reauth = null;
  if (reauthDir != null && String(reauthDir) !== '') {
    reauth = reauthTarget(reauthDir);
    if (reauth.error) return { ok: false, because: reauth.error };
    if (activeGrokDirs.has(reauth.dir)) return { ok: false, because: 'a sign-in for that account is already in progress' };
  }
  const spot = resolveFreshGrokDir(reauth ? null : label);
  if (spot.error) return { ok: false, because: spot.error };
  activeGrokDirs.add(spot.dir);
  // Held for the life of the sign-in, so forget/remove and a second sign-in again refuse it.
  if (reauth) activeGrokDirs.add(reauth.dir);
  /* XAI_API_KEY REMOVED, not blanked: an empty value still reads as set to grok. */
  const env = { ...process.env, GROK_HOME: spot.dir };
  delete env.XAI_API_KEY;
  /* The leader socket: grok's default is ~/.grok/leader.sock, the machine's own. A
     path inside the account dir can pass macOS's 104-byte socket-path limit for a long
     name, so it goes in the temp dir under a short per-sign-in name instead. */
  /* Read BEFORE the spawn, so nothing grok writes can be mistaken for what was already there. */
  const preexisting = spot.madeDir ? [] : GROK_WRITES.filter((n) => fs.existsSync(path.join(spot.dir, n)));
  const sessionId = crypto.randomBytes(16).toString('hex');
  const sock = path.join(os.tmpdir(), `kgrok-${sessionId.slice(0, 12)}.sock`);
  const args = ['login', '--device-auth', '--leader-socket', sock];
  let child;
  try {
    child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    activeGrokDirs.delete(spot.dir);
    if (reauth) activeGrokDirs.delete(reauth.dir);
    if (spot.madeDir) { try { fs.rmSync(spot.dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    return { ok: false, because: 'we could not start the Grok sign-in' };
  }
  const session = { preexisting, id: sessionId, child, dir: spot.dir, label: spot.label || null, typedLabel: reauth ? null : label, madeDir: spot.madeDir, state: 'starting', buf: '', account: null, error: null, timer: null, forceKillTimer: null, exited: false, reaped: false,
    reauthDir: reauth ? reauth.dir : null, reauthIsDefault: reauth ? reauth.isDefault : false, expectEmail: reauth ? reauth.expectEmail : null };
  grokSessions.set(sessionId, session);
  /* Anti-litter a sign-in that did not land an account: a dir we made goes whole; a
     reused slot loses only what grok writes there (auth.json, docs/, logs/, measured),
     never anything else in it. A landed account stays. */
  const dropDirIfOurs = () => {
    /* A sign-in again's slot is only ever staging: its auth.json was moved out on success,
       and nothing in it is an account either way, so it is cleaned like a failed sign-in. */
    if (session.account && !session.reauthDir) return;
    if (session.madeDir) { try { fs.rmSync(session.dir, { recursive: true, force: true }); } catch { /* best effort */ } return; }
    // Only what THIS sign-in created: an earlier agent's grok logs/ in a reused slot is not ours to delete.
    for (const name of GROK_WRITES) {
      if (session.preexisting.includes(name)) continue;
      try { fs.rmSync(path.join(session.dir, name), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };
  // Call only once the child is confirmed gone. Idempotent.
  const freeSlotAndDir = () => {
    activeGrokDirs.delete(session.dir);
    if (session.reauthDir) activeGrokDirs.delete(session.reauthDir);
    dropDirIfOurs();
    try { fs.rmSync(sock, { force: true }); } catch { /* best effort */ }
  };
  const onData = (d) => {
    session.buf += String(d);
    const parsed = parseGrokLoginOutput(session.buf);
    if (parsed.authUrl && !session.authUrl) session.authUrl = parsed.authUrl;
    if (parsed.userCode && !session.userCode) session.userCode = parsed.userCode;
    // Move on at the first thing a person can act on: the code, or the URL that carries it.
    if (session.state === 'starting' && (session.userCode || session.authUrl)) session.state = 'awaiting-code';
  };
  if (child.stdout) child.stdout.on('data', onData);
  if (child.stderr) child.stderr.on('data', onData);
  child.on('error', () => {
    if (grokIsTerminal(session)) return;
    session.state = 'error';
    session.error = 'the Grok sign-in process failed to run';
    freeSlotAndDir();
    reapGrokSession(session);
  });
  child.on('exit', (code) => {
    session.exited = true;
    if (session.forceKillTimer) { clearTimeout(session.forceKillTimer); session.forceKillTimer = null; }
    if (grokIsTerminal(session)) { freeSlotAndDir(); return; }
    if (code === 0 && session.reauthDir) {
      /* FAIL CLOSED: move the new sign-in over the live one only when BOTH emails are
         read and equal. Anything else leaves the live account exactly as it was. */
      const who = identityOf(session.dir);
      const got = who && who.authMode === 'subscription' ? who.email : null;
      // An email is one address whatever its capitals, so the comparison ignores them.
      if (!got) {
        session.error = 'we could not confirm that sign-in is the same account, so this account was left unchanged';
      } else if (got.toLowerCase() !== String(session.expectEmail).toLowerCase()) {
        session.error = 'that sign-in was for a different account, so this account was left unchanged';
      } else {
        const moved = promoteReauth(session.dir, session.reauthDir);
        const row = moved.ok ? rowFor(session.reauthDir, session.reauthIsDefault) : null;
        if (row) {
          session.state = 'connected';
          session.account = row;
          freeSlotAndDir();
          reapGrokSession(session);
          return;
        }
        session.error = moved.ok ? 'the sign-in could not be read back after updating this account' : moved.because;
      }
      session.state = 'error';
      freeSlotAndDir();
      reapGrokSession(session);
      return;
    }
    if (code === 0) {
      const who = identityOf(session.dir);
      if (who && who.authMode === 'subscription') {
        /* The same person signing in as a NEW account while one of theirs is already here
           (a lapsed ~/.grok is the common case: first run offers Connect for it) refreshes
           that account instead of adding a second with the same email. Only when exactly
           one account matches and nothing else is signing it in; otherwise the new slot
           stands, as before, rather than guessing. */
        /* A typed name asks for a separate named account, so it is never merged. And a rename
           that fails keeps the new sign-in as its own account (what happened before this
           merge existed) rather than throwing away a sign-in the person just finished. */
        const named = session.typedLabel != null && String(session.typedLabel).trim();
        const into = named ? null : sameAccountFor(who.email, session.dir);
        const moved = into ? promoteReauth(session.dir, into.dir) : { ok: false };
        if (moved.ok) {
          const row = rowFor(into.dir, into.isDefault);
          session.reauthDir = into.dir;   // the new slot is staging now, and is cleaned as such
          if (row) {
            session.state = 'connected';
            session.account = row;
            freeSlotAndDir();
            reapGrokSession(session);
            return;
          }
          // Said for a NEW sign-in, where the person never picked an account: name which one.
          session.error = 'your existing Grok account was updated, but we could not read it back';
          session.state = 'error';
          freeSlotAndDir();
          reapGrokSession(session);
          return;
        }
        if (session.typedLabel != null && String(session.typedLabel).trim()) writeName(session.dir, session.typedLabel);
        const row = rowFor(session.dir, false);
        if (row) {
          session.state = 'connected';
          session.account = row;
          freeSlotAndDir();
          reapGrokSession(session);
          return;
        }
      }
      session.error = 'the Grok sign-in finished but we could not read it back';
    } else {
      session.error = 'the Grok sign-in did not complete';
    }
    session.state = 'error';
    freeSlotAndDir();
    reapGrokSession(session);
  });
  session.timer = setTimeout(() => {
    if (grokIsTerminal(session)) return;
    try { session.child.kill(); } catch { /* best effort */ }
    armGrokForceKill(session);
    session.state = 'error';
    session.error = 'the Grok sign-in timed out';
    reapGrokSession(session);
  }, grokLoginTimeoutMs);
  if (session.timer && typeof session.timer.unref === 'function') session.timer.unref();
  return { ok: true, sessionId };
}

/** Whether this dir already holds credentials of ANY shape: a key file or a sign-in file,
    readable or not. The named sign-in and the named key add both refuse on this, never on
    identityOf alone, since an auth.json we cannot describe is still someone's. */
function holdsCredentials(dir) { return fs.existsSync(authFile(dir)) || fs.existsSync(keyFile(dir)); }

/** Whether a live sign-in holds this dir (the API-key add skips or refuses it). */
function isSignInPending(dir) { return activeGrokDirs.has(path.resolve(String(dir || ''))); }

/** Poll a Grok sign-in. @returns {{ok:true, state, authUrl?, userCode?, account?, error?} | {ok:false, because}} */
function grokLoginStatus(sessionId) {
  const s = grokSessions.get(sessionId);
  if (!s) return { ok: false, because: 'no such sign-in in progress' };
  return { ok: true, state: s.state, authUrl: s.authUrl, userCode: s.userCode, account: s.account, error: s.error };
}

/** Cancel a PENDING Grok sign-in; the exit handler frees the slot once the child is gone. */
function cancelGrokLogin(sessionId) {
  const s = grokSessions.get(sessionId);
  if (!s) return { ok: false, because: 'no such sign-in in progress' };
  if (grokIsTerminal(s)) return { ok: true, cancelled: false };
  s.state = 'cancelled';
  try { s.child.kill(); } catch { /* best effort */ }
  armGrokForceKill(s);
  reapGrokSession(s);
  return { ok: true, cancelled: true };
}

/* One shared sweep for concurrent callers (the #1618 collapse openaiaccounts uses):
   the slot holds the promise only while unsettled, so no answer outlives the moment
   it was true. Not a cache. */
const listLive = inflight.collapse(listLiveNow);

module.exports = {
  STATE, PROVIDER, PROVIDER_NAME, DIR_PREFIX, KEY_BASENAME, FORGOTTEN_PREFIX,
  homeDir, defaultDir, keyFile, identityOf, list,
  setFetcher, askModels, validateLive, checkLive, listLive, subscriptionLive,
  keyProblem, cleanLabel, dirForLabel, nextWorkDir,
  storeKey, forgetKey, forgetAccount, removeAccount,
  authFile, readAuth, parseGrokLoginOutput, startGrokLogin, reauthTarget, grokLoginStatus, cancelGrokLogin, setGrokTimers,
  isSignInPending, MISSING_RUNNER_SENTENCE, holdsCredentials,
  readName, writeName,
  get HOME_FOR_TEST() { return homeDir(); },
};
