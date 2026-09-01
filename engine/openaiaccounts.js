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
const codexupdate = require('./codexupdate');
const { spawnSync } = require('node:child_process');
const subscription = require('./subscription');
const inflight = require('./inflight');

/* 🛑 A FUNCTION, NOT A CONST (#1337, found by Angel reviewing this branch).
   Frozen at require time, this made `list()` DISAGREE WITH ITSELF: the default
   entry is `add(defaultDir(), true)` which resolves lazily, while the `.codex-*`
   SCAN below used the frozen value. So a caller that set
   `AGENT_WORKFORCE_HOME` after requiring this module got a list whose DEFAULT
   was sandboxed and whose SCAN read the operator's REAL home - sandboxed and
   not, in one call, with the sandboxed half being the reassuring one.
   ⇒ That is #1412's shape exactly, which is why this is not cosmetic. */
function homeDir() { return process.env.AGENT_WORKFORCE_HOME || os.homedir(); }
const PROVIDER = 'openai';
/* "OpenAI", not "OpenAI / Codex" (Mona Lisa, #540): Codex is the runner's name and
   a person never needs it to pick an account. */
const PROVIDER_NAME = 'OpenAI';

/** The default codex home. 🛑 ONE derivation, in codexupdate, CALLED rather
    than restated (#1337). This copy did not honour `CODEX_HOME`, so it could
    name a different home than the launch path wrote to. It also froze HOME at
    module load; calling makes it lazy, which is strictly more permissive and
    matches every other caller. */
function defaultDir() {
  return codexupdate.defaultHome();
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

/**
 * The one read of auth.json, shared by identityOf() and checkLive() so
 * "the file is absent" and "the file is present but corrupted/unreadable"
 * stay two DIFFERENT facts everywhere in this module, not just where it
 * happened to matter first -- the same distinction subscription.js's own
 * readConfig() draws (absent -> a real NONE; unreadable -> UNKNOWN, never
 * silently folded into the same negative). Caught in challenge-loop
 * iteration 1: checkLive()'s first version treated both the same way,
 * which is exactly the asymmetry this module's own header rules against.
 */
function readAuthFile(dir) {
  let raw;
  try { raw = fs.readFileSync(authFile(dir), 'utf8'); } catch { return { kind: 'absent' }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { kind: 'unreadable' }; }
  if (!parsed || typeof parsed !== 'object') return { kind: 'unreadable' };
  return { kind: 'ok', data: parsed };
}

/** Pure: turns an already-parsed auth.json object into an identity, or null
    if its shape is not one this module recognises. No I/O -- callers that
    already have `readAuthFile()`'s parsed data (checkLive()) use this
    directly instead of re-reading the file identityOf() would otherwise
    read a second time. */
function identityFromData(parsed) {
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

/** What codex wrote about who this is; null when nobody is signed in here,
    or when auth.json exists but is unreadable/unrecognized. */
function identityOf(dir) {
  const got = readAuthFile(dir);
  if (got.kind !== 'ok') return null;
  return identityFromData(got.data);
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
  try { entries = fs.readdirSync(homeDir()); } catch { entries = []; }
  for (const name of entries.sort()) {
    if (!name.startsWith('.codex-')) continue;
    add(path.join(homeDir(), name), false);
  }
  return out;
}

/**
 * The prefix a forgotten account is moved to (#1372).
 *
 * 🛑 IT REPLACES `.codex-`, IT DOES NOT EXTEND IT, AND THAT IS THE WHOLE
 * TRICK. `list()` finds accounts by `name.startsWith('.codex-')`, so the
 * obvious `~/.codex-work1.removed` would still be listed and the account
 * would appear to survive its own removal. Moving the prefix is what makes
 * the directory invisible to the only definition of "an account".
 */
const FORGOTTEN_PREFIX = '.removed-codex-';

/**
 * Forget an OpenAI account WITHOUT deleting the credential (#1372).
 *
 * 🛑 A PERSON COULD ADD UP TO 500 AND REMOVE NONE. The only way back out was
 * deleting a dot-directory in Terminal, which is exactly the "total dead stop
 * in the water" Josh described. This is the way back.
 *
 * ⭐ FORGET RATHER THAN DELETE, and the reason is reversibility: a rename can
 * be undone by renaming back, and the credential stays on the person's own
 * computer. Deleting somebody's credential is not an act a "remove this
 * account" button should perform without being asked twice, and there is no
 * second ask here.
 *
 * 🔑 AN ACCOUNT IS A DIRECTORY. There is no registry, so there is nowhere to
 * record a forget INTO; the move IS the record. That is why this is a rename
 * and not a flag.
 *
 * ⚠️ `usedBy` IS SUPPLIED BY THE CALLER, deliberately. This module cannot ask
 * which agents are running without requiring `create.js`, which requires this
 * one. The route knows both and passes the answer in.
 *
 * @param {string} dir     the account directory, as `list()` reports it
 * @param {string[]} usedBy names of agents currently running on it
 */
function forgetAccount(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const base = path.basename(clean);

  /* Only ever a codex home directly inside this computer's home. A path from
     anywhere else is not ours to move, and saying so beats moving it. */
  if (path.dirname(clean) !== home || !(base === '.codex' || base.startsWith('.codex-'))) {
    return { ok: false, forgotten: false, because: 'that is not an OpenAI account on this computer' };
  }

  /* 🛑 REFUSED WHILE AN AGENT IS ON IT, AND THE AGENTS ARE NAMED. A rename
     moves a path that a running agent's plist points at by absolute path, so
     this refusal is not politeness, it is what makes the rename safe. And a
     refusal that cannot be acted on is the class this card came from: the
     person needs to know WHICH agents, not that there are some. */
  const agents = (Array.isArray(usedBy) ? usedBy : []).filter((n) => typeof n === 'string' && n);
  if (agents.length) {
    return {
      ok: false,
      forgotten: false,
      usedBy: agents,
      because: agents.length === 1
        ? `${agents[0]} is set up to run on this account. Move it to another account or remove it first.`
        : `${agents.length} agents are set up to run on this account: ${agents.join(', ')}. `
          + 'Move them to another account or remove them first.',
    };
  }

  if (!fs.existsSync(clean)) {
    return { ok: true, forgotten: false, because: 'that account is already gone from this computer' };
  }

  /* 🛑 THE NAME IS NOT THE ACCOUNT, and every guard above keys on the NAME. A
     directory called `.codex-anything` inside home passes all of them, so this
     route would rename a real folder that codex never wrote and report
     `forgotten: true`.
     ⚠️ MEASURED BEFORE BEING ADDED, not argued: a planted `~/.codex-notanaccount`
     holding one user file was renamed to `.removed-codex-notanaccount` with the
     file carried along, and the answer said it had been forgotten.
     📌 The Claude sibling has carried this guard since #1659, added after the same
     measurement found `.claude-workers` (a real non-account tree on this machine)
     inside its blast radius. This is the same exposure on the provider that has
     had a live Disconnect since #1372, and it is here rather than on its own card
     because deferring a SAFETY guard is a worse version of an argument I already
     rejected for a copy string.
     ⚠️ AFTER the existence check on purpose, so a directory that is simply gone is
     reported as gone rather than as "not an account".
     🛑 I CLAIMED A COST HERE THAT DOES NOT EXIST, and the correction matters more
     than the original claim. I wrote that an account with a CORRUPTED `auth.json`
     answers null here too, so it could no longer be disconnected from Settings,
     "exactly when somebody would want to".
     ⇒ MEASURED, and it is false: `list()` gates on `identityOf` as well, so such an
     account is never rendered and has no Disconnect control to begin with. Nothing
     changed for that person. The Claude sibling's `list()` gates the same way.
     ⚠️ AND THE SAME REASONING BOUNDS THE BENEFIT, so this is not a rescue of my own
     guard: the page only ever sends a `dir` that `list()` emitted, so a
     `.codex-notanaccount` cannot arrive from the button either.
     ✅ WHAT THIS GUARD ACTUALLY IS: defence in depth on an unauthenticated local
     HTTP endpoint that renames directories. Worth keeping for that reason and
     stated as that reason, rather than as a user-facing trade nobody can reach.
     📌 Kept because the alternative is worse: without this, a name-shaped folder
     the person made gets renamed with its contents and the answer says it was
     forgotten. Refusing to move something we cannot identify is the safer error.
     Measured, so the cost is a known size rather than a guess: `{label}` -> null,
     `{auth_mode, OPENAI_API_KEY}` -> an identity, unparseable -> null. */
  if (!identityOf(clean)) {
    return { ok: false, forgotten: false, because: 'that is not an OpenAI account on this computer' };
  }

  const label = base === '.codex' ? 'default' : base.slice('.codex-'.length);
  let target = path.join(home, FORGOTTEN_PREFIX + label);
  /* A second removal of the same label must not clobber the first one's
     credential, which would delete the thing this function exists not to
     delete. */
  for (let n = 2; fs.existsSync(target) && n < 500; n += 1) {
    target = path.join(home, `${FORGOTTEN_PREFIX}${label}-${n}`);
  }
  if (fs.existsSync(target)) {
    return { ok: false, forgotten: false, because: 'we could not find a free name to move that account to' };
  }
  try { fs.renameSync(clean, target); }
  catch { return { ok: false, forgotten: false, because: 'we could not move that account out of the way' }; }

  return {
    ok: true,
    forgotten: true,
    movedTo: target,
    /* 🛑 THE DEFAULT IS WHERE `defaultHome()` POINTS, NOT WHATEVER IS CALLED
       `.codex`. `AGENT_WORKFORCE_CODEX_HOME` and `CODEX_HOME` both move it
       (`codexupdate.js:46`), and the supervisor puts `CODEX_HOME` in a codex
       agent's environment, so this is reachable outside a test.
       ⇒ A basename check is wrong in BOTH directions, measured, both arms:
         CODEX_HOME=<home>/.codex-work  the row `list()` marks isDefault:true is
           disconnected with `wasDefault:false`, so the caller OMITS the history
           sentence while the transcripts really are gone (rollouts 1 -> 0).
         no override (control)  `.codex` reports true, so the flag can return
           the other answer and this measurement means something.
       The mirror is worse: with the home moved elsewhere, a leftover `.codex`
       reports true and the caller states a history loss that did not happen. */
    wasDefault: clean === path.resolve(defaultDir()),
    because: null,
  };
}

function cleanLabel(label) {
  return String(label == null ? '' : label).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The first free spot, the way accounts.nextWorkDir hands one out. */
function nextWorkDir() {
  for (let n = 1; n <= 500; n += 1) {
    const label = `work${n}`;
    const dir = path.join(homeDir(), `.codex-${label}`);
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
  if (/\s/.test(k.trim())) return 'that does not look like a key: a key has no spaces or line breaks in it';
  if (k.trim().length < 20) return 'that is too short to be a key';
  return null;
}

/* ONE copy of the missing-runner sentence (#979): the server's add route
   pre-checks with the shared resolver and answers this refusal itself
   (with the structured needsRunner shape around it), and addWithKey keeps
   its own last-line check for direct callers. Exported so both say the
   same words forever; the UI displays this sentence verbatim, so one
   source keeps the on-screen wording identical whichever path refused. */
const MISSING_RUNNER_SENTENCE = 'we could not find the OpenAI runner on this computer, so there is nothing to sign in to';

/**
 * Add an OpenAI account from an API key, through codex's own login so the
 * file it writes is the file it reads. Returns the new row, never the key.
 */
function addWithKey({ key, label, codexBin }) {
  const problem = keyProblem(key);
  if (problem) return { ok: false, because: problem };
  const bin = String(codexBin || '');
  if (!bin || !fs.existsSync(bin)) return { ok: false, because: MISSING_RUNNER_SENTENCE };
  let spot;
  if (label != null && String(label).trim()) {
    const clean = cleanLabel(label);
    if (!clean) return { ok: false, because: 'that is not a name we can use for an account' };
    spot = { label: clean, dir: path.join(homeDir(), `.codex-${clean}`) };
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

/* ── live check (#960) ───────────────────────────────────────────────────
   `codex login status` is LOCAL ONLY -- verified by pointing CODEX_HOME at a
   directory holding a fabricated, never-valid key and getting "Logged in
   using an API key" back anyway. It cannot be this module's live check.
   A raw apikey-mode key can be verified directly against OpenAI's own API
   (GET /v1/models, the standard cheap verification call: 200 for a working
   key, 401 for a rejected one), so this module gets its own real live check
   rather than trusting the shape of a local file -- the exact #881/#959
   discipline, applied to the other provider. Own fetcher seam, matching
   tokendoor.js's and subscription.js's per-module convention: each external
   I/O boundary in this codebase is independently controllable in tests. */
let fetcher = null;
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

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
  /* The harness seam: docs/browser-checks runs a real server process, where
     setFetcher() cannot reach, so the models URL itself is overridable, the
     way AGENT_WORKFORCE_RELEASE_BASE points the updater at a fixture. Read
     per call, so a test can set it after require. A shipped install never
     sets it, and an unset value is OpenAI's real endpoint. Without this the
     page gate sent a fake key to api.openai.com on every cut and, since
     #962 made the badge honest, read "did not accept this key" (0.5.59a). */
  const url = process.env.AGENT_WORKFORCE_OPENAI_MODELS_URL || 'https://api.openai.com/v1/models';
  try {
    return await f(url, { method: 'GET', headers: { authorization: 'Bearer ' + key } });
  } catch (err) {
    /* ⚠️ NO RAW err.message HERE -- the same rule subscription.js's checkLive()
       is built on: a raw network/fetch error can carry anything (a DNS
       failure string, a stack fragment, a proxy's own error page), and this
       module's whole reason for existing is sentences a non-technical
       person can read. Caught by this file's own test before it ever
       shipped, not by review. */
    return { status: 0, body: null, unreachable: true, because: 'we could not reach OpenAI to check whether this key still works' };
  }
}

/**
 * `identityOf()`'s file-read answer, but confirmed live with OpenAI.
 *
 * @returns {Promise<{state: string, plan: null, because: string, checkedLive: true}>}
 */
async function checkLive(dir) {
  const STATE = subscription.STATE;
  const got = readAuthFile(dir);
  /* ⚠️ ABSENT AND UNREADABLE ARE TWO DIFFERENT FACTS. No file at all is a
     real, positively confirmed NONE -- nobody has ever signed in here. A
     file that exists but does not parse (corrupted, half-written, a future
     codex version writing a shape this file cannot read) is UNKNOWN: we
     genuinely cannot tell, and asserting NONE for it would be exactly the
     false negative this whole feature exists to prevent. */
  if (got.kind === 'absent') {
    return { state: STATE.NONE, plan: null, checkedLive: true, because: 'nobody has signed in to this account yet' };
  }
  if (got.kind === 'unreadable') {
    return { state: STATE.UNKNOWN, plan: null, checkedLive: true, because: 'we could not read this account\'s settings' };
  }
  // identityFromData(), not identityOf(dir): identityOf() would re-read and
  // re-parse the SAME file readAuthFile() already read above into `got` --
  // caught in challenge-loop iteration 2, both as needless I/O and as a
  // narrow TOCTOU (the file could change between the two reads, so a
  // decision already made from `got` could silently disagree with a second,
  // independent read of it).
  const who = identityFromData(got.data);
  if (!who) {
    // The file parses, but not into a shape this module recognises (an
    // auth_mode neither apikey nor chatgpt, or an apikey entry with no
    // usable key) -- unrecognised, not absent, so this is UNKNOWN too.
    return { state: STATE.UNKNOWN, plan: null, checkedLive: true, because: 'we could not find a usable sign-in in this account\'s settings' };
  }
  if (who.authMode !== 'apikey') {
    /* ⚠️ UNKNOWN, NOT NONE, AND NOT A GUESSED CONNECTED EITHER. codex's
       ChatGPT-mode auth hands us an id_token (an identity claim), not a
       bearer credential usable against OpenAI's API the way apikey mode's
       raw key is -- there is no real live check to run here yet. Saying so
       honestly is the whole point of this fix: a badge this codebase cannot
       actually verify must never claim it did. */
    return {
      state: STATE.UNKNOWN, plan: null, checkedLive: true,
      because: 'this sign-in method is not yet checked live; it may or may not still work',
    };
  }
  // The key, from the SAME parsed read readAuthFile() already did above --
  // no second file read anywhere in this function any more.
  const key = got.data.OPENAI_API_KEY;
  if (typeof key !== 'string' || !key) {
    return { state: STATE.UNKNOWN, plan: null, checkedLive: true, because: 'we could not read this account\'s key to check it' };
  }
  const r = await askModels(key);
  if (r.unreachable) {
    return { state: STATE.UNKNOWN, plan: null, checkedLive: true, because: r.because };
  }
  if (r.status === 200) {
    return { state: STATE.CONNECTED, plan: null, checkedLive: true, because: 'OpenAI confirmed this key still works' };
  }
  if (r.status === 401 || r.status === 403) {
    /* ⚠️ A 401/403 IS NOT ALWAYS "THE KEY IS BAD". Caught in challenge-loop
       iteration 2: an OpenAI project key can be scoped/restricted in the
       dashboard and legitimately lack permission to LIST models while still
       being fully valid for everything an agent actually does with it --
       that also answers 401/403 here, for a permissions reason, not a
       revoked-key reason. Only OpenAI's own `invalid_api_key` error code is
       a POSITIVE confirmation the key itself is rejected; anything else
       shaped like a 401/403 is an honest "we asked and got refused, but
       cannot confirm the key is bad" -- UNKNOWN, not a guessed NONE. This
       is the same asymmetry rule as everywhere else in this module, applied
       to a response body's error code instead of a missing/corrupt file. */
    const code = r.body && r.body.error && typeof r.body.error.code === 'string' ? r.body.error.code : null;
    if (code === 'invalid_api_key') {
      return { state: STATE.NONE, plan: null, checkedLive: true, because: 'OpenAI did not accept this key' };
    }
    return {
      state: STATE.UNKNOWN, plan: null, checkedLive: true,
      because: 'OpenAI refused to check this key in a way that does not confirm the key itself is bad',
    };
  }
  return {
    state: STATE.UNKNOWN, plan: null, checkedLive: true,
    because: 'we asked OpenAI whether this key still works and it answered ' + (r.status || 'nothing usable'),
  };
}

/** Every OpenAI account, live-checked. One bad row's own failure cannot sink
    the others -- caught individually, falling back to UNKNOWN, never a
    false NONE. Mirrors accounts.listLive()'s exact contract. */
async function listLiveNow() {
  const rows = list();
  return Promise.all(rows.map(async (row) => {
    try {
      // Through module.exports, not the bare local name: this is what lets
      // a test monkey-patch checkLive() to exercise listLive()'s OWN catch
      // below specifically, rather than checkLive()'s internal one (which
      // never rejects by contract) -- the same self-reference #881's
      // accounts.js/subscription.js pair relies on, applied within one file
      // since this module has no separate consumer to require it through.
      return { ...row, connection: await module.exports.checkLive(row.dir) };
    } catch {
      return {
        ...row,
        connection: {
          state: subscription.STATE.UNKNOWN, plan: null, checkedLive: true,
          because: 'we could not check this account just now',
        },
      };
    }
  }));
}

/* #1618: concurrent callers share ONE sweep, matching accounts.js. Not a cache:
   the slot holds the promise only while it is unsettled, so no answer outlives
   the moment it was true, and a failed sweep is cleared like a successful one.
   The route asks both engines together, so collapsing each is what makes two
   concurrent requests cost one sweep rather than two. */
const listLive = inflight.collapse(listLiveNow);

module.exports = {
  list, identityOf, addWithKey, nextWorkDir, defaultDir, forgetAccount, FORGOTTEN_PREFIX, PROVIDER, PROVIDER_NAME, /* lazy, so it cannot re-freeze what homeDir() unfroze */
  get HOME_FOR_TEST() { return homeDir(); },
  checkLive, listLive, setFetcher, MISSING_RUNNER_SENTENCE,
};
