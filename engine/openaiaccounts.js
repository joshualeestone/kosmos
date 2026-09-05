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
const runners = require('./runners');

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
 * #2095: the human-chosen display NAME, kept in a small sidecar file INSIDE the
 * account dir (beside auth.json). It is deliberately SEPARATE from the dir label:
 * the label is `cleanLabel`-slugged to a safe path (`[a-z0-9-]`, lowercased), so
 * "My Work Account" becomes the path fragment "my-work-account" -- fine for a
 * directory, wrong for a screen. This preserves EXACTLY what the person typed,
 * and unlike the label it also exists for a default `~/.codex` account (which has
 * no `.codex-<label>` to read a name out of).
 *
 * Best-effort and fail-open EVERYWHERE, on purpose: a missing/unreadable file is
 * a real "no name" (null), never an error, so an account with no name still lists
 * and still works; and a failed WRITE never fails the add -- the account is fully
 * usable unnamed. Being inside the dir, it rides the forget-rename with everything
 * else, and `list()` never sees it (that scan is of homeDir for `.codex-*` DIRS).
 */
function nameFile(dir) {
  return path.join(path.resolve(String(dir || '')), '.kosmos-name');
}
function readName(dir) {
  try {
    // Re-apply the same code-point clamp on READ, not only on write, so the
    // bound holds however the bytes got into the file (a hand-edited or legacy
    // sidecar), not merely for names this module itself wrote.
    const n = [...fs.readFileSync(nameFile(dir), 'utf8').trim()].slice(0, NAME_MAX).join('').trimEnd();
    return n || null;
  } catch { return null; }
}
/* #2095: clamp so a RAW API call to the connect route (the form input maxlengths
   at 40, but the HTTP endpoint does not) cannot store an unbounded name that then
   bloats every /api/accounts response. 120 matches the agent-name clamp
   (create.js), generous for a display label and bounded. */
const NAME_MAX = 120;
function writeName(dir, name) {
  // Clamp by CODE POINT ([...s] iterates code points), not UTF-16 unit, so the
  // 120-char boundary can never split an astral char (an emoji surrogate pair)
  // into a lone half that serialises as U+FFFD. trimEnd after clamping so a cut
  // that lands on a space does not store a trailing blank.
  const n = [...String(name == null ? '' : name).trim()].slice(0, NAME_MAX).join('').trimEnd();
  if (!n) return false;
  try { fs.writeFileSync(nameFile(dir), n); return true; }
  catch { return false; }
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
    // #2095: the exact human-chosen name, null if it was never set. Kept apart
    // from `label` so a screen can show what the person typed, not the path slug.
    name: readName(dir),
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
       reports true and the caller states a history loss that did not happen.
       ⚠️ SCOPE, SO THIS IS NOT READ AS COVERING THE WHOLE `CODEX_HOME` RANGE: it
       fixes the flag for a named home INSIDE the person's home folder. Point
       `CODEX_HOME` OUTSIDE it and `list()` still emits the row as `isDefault:true`
       with a live Disconnect, while the first guard below refuses every press
       because the parent is not home. Measured, both arms: an outside-home row
       returns `that is not an OpenAI account on this computer`, while the control
       inside home returns `ok:true`. That is a live control that can never act,
       which is the shape this file refuses elsewhere. It PREDATES this change and
       is not fixed here; it is carded rather than widened silently. */
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
  /* #1616: runnable, not merely present. existsSync says yes to a folder at the codex
     path, and the spawn below then fails with a worse message than this one. Same
     definition as the first-run screen and every gate in create.js. */
  if (!bin || !runners.isRunnable(bin)) return { ok: false, because: MISSING_RUNNER_SENTENCE };
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
  // #2095: persist the EXACT name the person typed (the RAW `label`, before
  // cleanLabel slugged it into the path) BEFORE rowFor reads it, so the returned
  // account carries the name. Best-effort: a failed write leaves a fully working
  // account that simply has no display name. Only on a successful login (a failed
  // login is torn down below, so a name file there would be litter).
  if (run.status === 0 && label != null && String(label).trim()) writeName(spot.dir, label);
  const row = run.status === 0 ? rowFor(spot.dir, false) : null;
  if (!row) {
    // Anti-litter: a failed add leaves no half-made account behind.
    if (madeDir) { try { fs.rmSync(spot.dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    return { ok: false, because: 'the OpenAI runner did not accept that key' };
  }
  /* `madeDir` rides on the success answer so a caller that undoes the add later
     (addWithKeyLive, after a live rejection) can honour the SAME anti-litter
     guard this function uses above: remove the whole directory only when we
     created it, never one that was already here. */
  return { ok: true, account: row, madeDir };
}

/**
 * addWithKey, then confirm the key LIVE with OpenAI before the add stands (#1315).
 *
 * 🛑 THE SYMPTOM THIS FIXES: addWithKey validates a key only by `codex login
 * --with-api-key`'s exit status, which is LOCAL ONLY -- a fabricated,
 * never-valid key still exits 0 (see the live-check comment below). So the
 * add route ACCEPTED a dead or typo'd key, and the account only read
 * not-connected LATER, on the badge. To the person that is "I added my key and
 * it will not connect." This runs the SAME live check the badge uses, at ADD
 * time, so a key OpenAI positively rejects is refused at entry.
 *
 * ⚠️ IT REUSES checkLive's ASYMMETRY RATHER THAN REINVENTING IT, and that is
 * the whole point. Only OpenAI's own `invalid_api_key` code is a positive
 * rejection (checkLive maps it to NONE); a scope-restricted project key that
 * 401s on model-listing while working fine for everything an agent does, or an
 * unreachable OpenAI, is UNKNOWN -- and we ACCEPT those, never blocking a good
 * key on an answer that does not confirm the key is bad. After a SUCCESSFUL
 * addWithKey the auth file exists, so checkLive's other NONE branch (an absent
 * file) cannot fire here: post-add, NONE means invalid_api_key and nothing else.
 *
 * Async because the live check is; addWithKey stays sync so its own callers and
 * tests are untouched. Same {ok, account}/{ok:false, because} contract as
 * addWithKey, so the one route calling it changes by one awaited word.
 */
async function addWithKeyLive({ key, label, codexBin }) {
  const added = addWithKey({ key, label, codexBin });
  if (!added.ok) return added;
  const live = await checkLive(added.account.dir);
  if (live.state === subscription.STATE.NONE) {
    /* Positively rejected. Undo the add so no half-made, never-usable account
       is left behind -- the same anti-litter promise addWithKey keeps on its
       own local-failure path, extended to the one failure it could not see.
       🛑 AND THE SAME GUARD, not a stronger one. addWithKey removes the whole
       directory ONLY when it created it (`madeDir`), precisely so it never
       deletes a directory that was already here -- addWithKey can succeed into a
       pre-existing dir that merely lacked an auth.json (a reused work slot, or a
       labelled `.codex-<label>` folder with other contents). So: whole dir only
       when we made it; otherwise remove JUST the files this add wrote -- the
       auth.json AND the #2095 `.kosmos-name` sidecar -- which is safe because
       addWithKey only SUCCEEDS into a dir that had no auth.json before (it
       refuses a taken label), so both files present now are ours to undo and
       nothing else in that directory is.
       🛑 #2095: the name file MUST be removed here too. Without it, a labelled
       add into a pre-existing auth-less slot that is then live-rejected orphans
       `.kosmos-name`; since nextWorkDir reuses an auth-less dir, a LATER add
       would inherit that stale name -- a different account showing someone
       else's typed name. */
    try {
      if (added.madeDir) fs.rmSync(added.account.dir, { recursive: true, force: true });
      else {
        fs.rmSync(authFile(added.account.dir), { force: true });
        fs.rmSync(nameFile(added.account.dir), { force: true });
      }
    } catch { /* best effort */ }
    return { ok: false, because: 'OpenAI did not accept this key' };
  }
  /* `madeDir` was an internal detail for the cleanup above; it never belongs in
     the answer the route serializes, so it does not ride out on success. */
  return { ok: true, account: added.account };
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

/* #1026: the OpenAI side of the model picker, sourced from the /v1/models the
   key check already fetches and used to discard, never from a hardcoded name.
   A wrong model name is not cosmetic -- it is an agent that fails to start --
   so the `arg` a runner is launched with is always a real id the account just
   told us it has. This module only decides WHICH of those to show and how to
   describe them.

   ⚠️ FILTERING IS THE WORK, not an afterthought. /v1/models returns everything
   the key can reach: embeddings, tts, whisper, image, moderation, realtime and
   transcribe models codex cannot drive as a chat agent, mixed in with the chat
   models. Two filters, and the safety ORDER is deliberate:
     - an ALLOWLIST of chat families by id prefix (gpt-5, gpt-4.1, gpt-4o,
       chatgpt, o1, o3, o4, plus the bare gpt-4 catch-all and codex; see the
       OPENAI_CHAT_FAMILIES constant). A brand-new chat family with an unknown prefix is
       missed until this list learns it -- an UNDER-offer, which is invisible
       and safe. The opposite error, offering a non-chat model, is the
       fail-to-start this card exists to prevent, so we take the safe side on
       purpose and name it as the weakest premise.
     - a DENYLIST of non-chat variants WITHIN those families (gpt-4o-audio-*,
       -realtime-*, -transcribe, -search-*, -tts and the like), because those
       ARE gpt-4o-* by prefix yet are not chat-completion models a runner drives.
   Between the two, only plausibly-drivable chat models survive.

   The `why` lines are copy keyed by family (no runner can produce them); the
   `arg`/id always comes from the account. */
/* rank low = more capable / preferred as default. prefix matched lowercased.
   ⚠️ ORDER MATTERS: openaiModelClass takes the FIRST prefix an id startsWith, and
   some prefixes nest ('gpt-4o' and 'gpt-4.1' both startWith 'gpt-4'), so the
   specific families are listed BEFORE the bare 'gpt-4' catch-all. A row's why/
   rank comes from the first match, so mis-ordering would mis-describe a model,
   never mis-classify it as non-chat. */
const OPENAI_CHAT_FAMILIES = [
  { rank: 0, prefix: 'gpt-5', why: 'OpenAI\'s most capable. For work where being right matters more than being quick.' },
  { rank: 1, prefix: 'o3', why: 'Reasoning-focused. Slower, and it works through harder problems step by step.' },
  { rank: 1, prefix: 'o4', why: 'Reasoning-focused. Slower, and it works through harder problems step by step.' },
  { rank: 2, prefix: 'gpt-4.1', why: 'A strong all-rounder, with room for long jobs.' },
  { rank: 3, prefix: 'gpt-4o', why: 'The everyday choice. Quick, and good at most work.' },
  { rank: 4, prefix: 'chatgpt', why: 'The model behind ChatGPT\'s default experience.' },
  { rank: 5, prefix: 'o1', why: 'An earlier reasoning model. Slower, for step-by-step problems.' },
  // The bare gpt-4 family (gpt-4, gpt-4-turbo, gpt-4-*-preview): older but real
  // chat models. AFTER gpt-4.1/gpt-4o so those match first.
  { rank: 6, prefix: 'gpt-4', why: 'An earlier generation, still capable for most everyday work.' },
  // codex's own small model. The runner here IS codex, so codex-mini-latest is a
  // model this runner can actually drive -- excluding it would drop the one model
  // named for the runner itself (#1026 iteration 1).
  { rank: 7, prefix: 'codex', why: 'A smaller, faster model tuned for code tasks.' },
];
// Non-chat variants that share a chat family's prefix but codex cannot drive as
// an agent. Substring match, lowercased. 'search' also drops the web-search
// preview models (gpt-4o-search-preview, gpt-4o-mini-search-preview) and the
// deep-research models (o3-deep-research etc.) on purpose -- they are
// specialised/constrained, not standard chat-completion models a runner drives.
// 'instruct' catches the legacy completions models (gpt-3.5-turbo-instruct),
// which are not chat either. This is the deliberate under-offer side (see the
// plan's weakest premise): missing one of these is invisible; offering a model
// that fails to start is the failure this card exists to prevent.
const OPENAI_NON_CHAT = ['audio', 'realtime', 'transcribe', 'tts', 'search', 'image', 'embedding', 'moderation', 'whisper', 'dall-e', 'instruct'];

/* #2140 (Josh, 0.6.35 feedback item 9): sort the OpenAI picker most-powerful-first.
   Josh's order runs by GPT VERSION descending (5.6 > 5.5 > 5.4 > ...), then by
   TIER within a version (Terra > Soul > Luna, Pro > plain > Nano > Mini).

   THE ACTUAL BUG (measured, not assumed): a newer tier the account returns, e.g.
   `gpt-5.6-terra`, ALREADY matched the fixed `gpt-5` prefix, so it was a
   recognised chat model at gpt-5's rank (0) -- NOT dropped, NOT marked, NOT last.
   The defect was ORDER: gpt-5.6-terra, gpt-5.5-pro, gpt-5.4-* all tied at rank 0
   and fell to the `id.localeCompare` tiebreak, so `gpt-5.4-*` could sort ABOVE
   `gpt-5.6-*` alphabetically. (Only a MAJOR bump like gpt-6 was truly 'unknown'
   and ranked last.) So this fix is an ORDER-ONLY override, applied in
   chatModelsFromList: a gpt id NEWER than the top fixed family gets a rank that
   sorts it above every fixed family, by version then tier. It does NOT change
   the model's CLASS -- a recognised gpt-5.<x> stays recognised (no marker), and
   an unrecognised higher major (gpt-6) stays 'unknown' (keeps its
   "compatibility not verified" marker and can never be the pre-selected default),
   it just sorts first. Forward-compatible: gpt-6 sorts above gpt-5.6 with no code
   change; gpt-5 and below fall through to their fixed ranks (no regression).

   ⚠️ ID-FORMAT ASSUMPTION, the one thing that could make this a no-op: the parse
   reads `gpt-<major>[.<minor>]`, OpenAI's shape (gpt-4o, gpt-4.1, gpt-5). The raw
   /v1/models ids for the 5.6/5.5/5.4 tiers are a live per-account fetch and are
   NOT in this repo, so this is built and tested against that shape; a non-gpt id
   would miss the parse and fall back to its class's rank (safe, not a wrong
   order) until the regex learns the shape. */
const OPENAI_TOP_KNOWN_VERSION = 5; // the highest fixed family prefix (gpt-5)
function openaiTierScore(low) {
  // Josh's within-version order, higher score = more capable = sorts earlier.
  if (low.includes('terra')) return 9;
  if (low.includes('soul')) return 8;
  if (low.includes('luna')) return 7;
  if (low.includes('pro')) return 6;
  if (low.includes('nano')) return 4;
  if (low.includes('mini')) return 3;
  return 5; // a plain version with no tier word sits between pro and nano
}
/* The rank for a gpt id NEWER than the top known family, or null if it is not
   such an id. Negative so it sorts ABOVE every fixed family (min fixed rank 0);
   higher version and higher tier => more negative => earlier. `major*1000 +
   minor*10` leaves room for a two-digit minor (gpt-5.10 > gpt-5.6) and the tier
   score. Pure. */
function openaiHighTierRank(low) {
  const m = low.match(/gpt-?(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = parseInt(m[1], 10);
  const minor = m[2] ? parseInt(m[2], 10) : 0;
  // Only NEWER than the top fixed family (gpt-5): a higher major, or gpt-5.<minor>
  // for minor > 0. gpt-5 itself and everything below fall through unchanged.
  if (!(major > OPENAI_TOP_KNOWN_VERSION || (major === OPENAI_TOP_KNOWN_VERSION && minor > 0))) return null;
  return -((major * 1000 + minor * 10) + openaiTierScore(low));
}

/* #2140 (Astra): the /v1/models filter has THREE outcomes, not two, and the
   third is the point of this slice. An id is one of:
     - 'chat'    a recognised chat family -> offer it normally.
     - 'nonchat' a denylisted non-chat variant (audio/tts/embedding/realtime/
                 transcribe/search/image/moderation/whisper/dall-e/instruct): it
                 DEFINITELY cannot drive a chat agent, so it stays dropped (#1026).
     - 'unknown' neither -- a model we do not recognise yet (a future gpt-6/o5).
                 It MIGHT be a new chat family, so Astra's rule is mark, do not
                 erase: offer it ranked LAST with a "compatibility not verified"
                 note, never as the default. Folding unknown in with nonchat (the
                 old null) silently dropped a drivable future model.
   The denylist is checked FIRST so a non-chat variant inside a known family
   (gpt-4o-audio-*) classifies as nonchat, never unknown. Pure. */
function openaiModelClass(id) {
  const low = String(id).toLowerCase();
  if (OPENAI_NON_CHAT.some((bad) => low.includes(bad))) return { kind: 'nonchat' };
  const fam = OPENAI_CHAT_FAMILIES.find((f) => low.startsWith(f.prefix));
  return fam ? { kind: 'chat', fam } : { kind: 'unknown' };
}

/* #2140 (Astra): an offered-but-unrecognised model. Ranked after every known
   family so it never sorts to the top or becomes the default; marked in the
   LABEL so the marker shows in the dropdown itself (the why-note only elaborates
   the SELECTED row); and given an honest why. No em dash (house style). */
const OPENAI_UNKNOWN_RANK = 999;
const OPENAI_UNVERIFIED_MARK = ' (compatibility not verified)';
const OPENAI_UNVERIFIED_WHY = 'We do not recognise this model, so we cannot confirm it works as a chat agent. It may not start. Pick it only if you know it is a chat model OpenAI can run.';

/** 'gpt-4o' -> 'GPT-4o'; 'o3'/'chatgpt-*' left as OpenAI writes them. Cosmetic. */
function prettyOpenaiLabel(id) {
  const s = String(id);
  return /^gpt/i.test(s) ? s.replace(/^gpt/i, 'GPT') : s;
}

/* #2191: the snapshot-base of an OpenAI id -- the id with a trailing ISO-date
   snapshot suffix (`-YYYY-MM-DD`) removed, and nothing else.

   ⚠️ ONLY the trailing ISO date is stripped, on purpose. `-mini` / `-nano` /
   `-preview` and `-latest` are NOT snapshots -- gpt-4o-mini is a DIFFERENT model
   from gpt-4o, and chatgpt-4o-latest is an alias, not a dated cut -- so they are
   part of the base and must never collapse together. And the date must be
   TRAILING: `gpt-4-1106-preview` carries its date mid-id, so it is left intact
   (a small, old residual, documented on #2191) rather than risk mangling it.
   The dominant modern bloat is the trailing-ISO form (gpt-4o-2024-08-06,
   o3-2025-04-16, gpt-4o-mini-2024-07-18, ...), which this collapses. */
function openaiSnapshotBase(id) {
  return String(id).replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/* Pure: the /v1/models `data` array -> the chat-model menu rows, most-capable
   first, ONE row per model (dated snapshots collapsed, #2191), exactly one
   marked default. No I/O, so a test drives it directly with a fixture list. The
   default is the most capable row that is not a -mini / -nano / -preview variant
   (else the first) -- chosen among what the account actually has, never invented. */
function chatModelsFromList(data) {
  const rows = (Array.isArray(data) ? data : [])
    .map((m) => (m && typeof m.id === 'string' ? m.id : null))
    .filter(Boolean)
    .map((id) => {
      const c = openaiModelClass(id);
      if (c.kind === 'nonchat') return null; // dropped (#1026), never offered
      /* #2140 item 9: a gpt id NEWER than the top fixed family (gpt-5) sorts to
         the TOP by version then tier. This is an ORDER override only -- it does
         NOT change the class: a recognised gpt-5.<x> (already chat via the gpt-5
         prefix) keeps its recognised status and family why; an unrecognised
         higher major (gpt-6) stays 'unknown', keeping its unverified marker and
         never-default status, it just sorts first. */
      const hi = openaiHighTierRank(String(id).toLowerCase());
      if (c.kind === 'chat') return { id, rank: hi != null ? hi : c.fam.rank, why: c.fam.why, unverified: false };
      // unknown: still OFFERED and still marked unverified; ranked at top only if
      // it parses as a newer version, else last (the #2217 behaviour).
      return { id, rank: hi != null ? hi : OPENAI_UNKNOWN_RANK, why: OPENAI_UNVERIFIED_WHY, unverified: true };
    })
    .filter(Boolean);
  /* #2191: collapse dated snapshots to one representative per base, so the
     picker shows "gpt-4o", not gpt-4o plus every gpt-4o-YYYY-MM-DD OpenAI
     returns. Prefer the base ALIAS id when the account lists it (the alias
     always points at the current snapshot, which is what a non-technical user
     wants); otherwise the newest dated snapshot. The chosen `arg` is ALWAYS a
     real id the account returned -- an alias is used only when present, never
     synthesized, preserving the #1026 invariant that a runner launches with a
     real model id. */
  const byBase = new Map();
  for (const r of rows) {
    const base = openaiSnapshotBase(r.id);
    const prev = byBase.get(base);
    if (!prev) { byBase.set(base, r); continue; }
    const prevIsAlias = prev.id === base;
    const curIsAlias = r.id === base;
    // The exact alias beats any dated snapshot. Between two of the same kind
    // (two snapshots, or a duplicate alias), the greater id wins -- ISO dates
    // sort by recency, so that is the newest snapshot.
    if (curIsAlias && !prevIsAlias) { byBase.set(base, r); continue; }
    // Plain `>` (not localeCompare): the two ids share an identical base prefix
    // and differ only in a fixed-width trailing YYYY-MM-DD of ASCII digits, so
    // lexical order is chronological order, locale-independently -- the newest wins.
    if (curIsAlias === prevIsAlias && r.id > prev.id) byBase.set(base, r);
  }
  const collapsed = [...byBase.values()];
  collapsed.sort((a, b) => (a.rank - b.rank) || a.id.localeCompare(b.id));
  const out = collapsed.map((r) => ({
    key: r.id, provider: 'openai',
    label: prettyOpenaiLabel(r.id) + (r.unverified ? OPENAI_UNVERIFIED_MARK : ''),
    arg: r.id, why: r.why,
    ...(r.unverified ? { unverified: true } : {}),
  }));
  if (out.length) {
    const isLite = (id) => /-(mini|nano|preview)(-|$)/i.test(id);
    /* #2140: the default is chosen only among VERIFIED (recognised) rows -- an
       unverified model is offered but NEVER pre-selected (Astra). If the account
       lists ONLY unverified models, there is no default: the create/detail
       pickers each prepend their own "Let OpenAI choose" as the selected option,
       so a no-default menu is never a menu with nothing selected. */
    const verified = out.filter((m) => !m.unverified);
    const flagship = verified.find((m) => !isLite(m.arg)) || verified[0];
    if (flagship) flagship.default = true;
  }
  return out;
}

/* #2191: the FULL set of runnable chat-model ids the account returned, deduped
   and UN-collapsed. This is the validation allowlist for a chosen model, kept
   separate from chatModelsFromList's collapsed DISPLAY menu: a snapshot id the
   account genuinely has (e.g. a stored gpt-4o-2024-08-06) must still validate,
   even though the picker now shows only its collapsed representative. Mirrors
   the menu's offerable set (chat AND #2140 unknown ids), so it never admits a
   denylisted non-chat id but does validate an offered-unverified one. Pure. */
function chatRunnableIds(data) {
  const seen = new Set();
  for (const m of (Array.isArray(data) ? data : [])) {
    const id = m && typeof m.id === 'string' ? m.id : null;
    // #2140: offerable => runnable. Chat AND unknown ids validate (an unknown id
    // is offered, so a stored/chosen one must not be refused); only denylisted
    // non-chat ids stay out (they are never offered, so never chosen).
    if (id && openaiModelClass(id).kind !== 'nonchat') seen.add(id);
  }
  return [...seen];
}

/* #2191: the validation allowlist for a chosen model, derived from an
   accountModels() result. Returns the array of ids a choice may be checked
   against, or NULL when validation must NOT refuse -- i.e. the account could not
   be checked (not ok), so the choice fails OPEN (#1916, never block on a
   validator that could not answer). Prefers the full un-collapsed runnableKeys
   (so a real snapshot id validates even though the menu collapses it); falls
   back to the collapsed menu keys only if an older result shape omits
   runnableKeys. Shared by both the create and change-model routes so their
   validation cannot drift. Pure. */
function runnableAllowlist(got) {
  if (!got || !got.ok) return null;
  if (Array.isArray(got.runnableKeys)) return got.runnableKeys;
  if (Array.isArray(got.models)) return got.models.map((m) => m && m.key).filter(Boolean);
  return null;
}

/**
 * The chat models a specific OpenAI account can run, as picker rows -- sourced
 * from that account's own /v1/models (the call the key check already makes),
 * filtered to chat families, with a `why` line and a default. Same key-reading
 * and honest-answer discipline as checkLive(): absent / unreadable /
 * unrecognised / non-apikey each answer with a plain sentence, and a network
 * failure or a non-200 is reported as such -- never as an empty menu that would
 * read like "this account has no models".
 *
 * @returns {Promise<{ok: boolean, models: Array, because?: string}>}
 */
async function accountModels(dir) {
  const got = readAuthFile(dir);
  if (got.kind === 'absent') return { ok: false, models: [], because: 'nobody has signed in to this account yet' };
  if (got.kind === 'unreadable') return { ok: false, models: [], because: 'we could not read this account\'s settings' };
  const who = identityFromData(got.data);
  if (!who) return { ok: false, models: [], because: 'we could not find a usable sign-in in this account\'s settings' };
  if (who.authMode !== 'apikey') {
    // A ChatGPT-mode sign-in hands codex an id_token, not a bearer key usable
    // against /v1/models -- the same limit checkLive() states, said here too.
    return { ok: false, models: [], because: 'this sign-in cannot list models yet; it is not an API key' };
  }
  const key = got.data.OPENAI_API_KEY;
  if (typeof key !== 'string' || !key) return { ok: false, models: [], because: 'we could not read this account\'s key' };
  const r = await askModels(key);
  if (r.unreachable) return { ok: false, models: [], because: r.because };
  // #2140 error matrix (Astra's spec): a non-200 is NOT one undifferentiated
  // "no models" state. Map the status to an honest, distinct `because` so the
  // note the user sees names what actually happened -- a rejected key is not an
  // unreachable OpenAI, and a permission denial is not "no models".
  if (r.status === 401) {
    /* #2140 refinement: split the 401 the SAME way checkLive() (#1315) and
       addWithKeyLive() already do -- only OpenAI's own `invalid_api_key` code is
       a positive rejection of the key itself. Any other 401 (or a bodyless one)
       is a permissions/scope answer: a project key restricted from listing
       models 401s HERE while running inference fine, so telling that account to
       "reconnect" overstates a working key as broken. The scope case joins the
       403 shape -- the account WORKS, it just cannot enumerate models, so it
       uses OpenAI's default rather than being told the key is bad. */
    const code = r.body && r.body.error && typeof r.body.error.code === 'string' ? r.body.error.code : null;
    if (code === 'invalid_api_key') {
      return { ok: false, models: [], because: 'this account\'s API key was rejected by OpenAI (401)' };
    }
    return { ok: false, models: [], because: 'this account\'s key cannot list models, though the key itself works (401)' };
  }
  if (r.status === 403) {
    // Name the denied OPERATION, never "no models": /v1/models needs api.model.read
    // on the key AND the project role, and a read-only or wrong-project key 403s.
    return { ok: false, models: [], because: 'this account\'s key is not allowed to list models (403)' };
  }
  if (r.status === 429) {
    // OpenAI answers 429 for BOTH request-rate and spend/quota; the structured
    // error code separates them (insufficient_quota / billing vs rate_limit_*).
    const code = (r.body && r.body.error && (r.body.error.code || r.body.error.type)) || '';
    // NB: not "limit" -- `rate_limit_exceeded` contains it and is a rate case, not billing.
    if (/quota|billing|insufficient|spend/i.test(String(code))) {
      return { ok: false, models: [], because: 'this account has hit its OpenAI usage or billing limit (429)' };
    }
    // Ambiguous 429 (no/parseless body, so no code) falls to the RATE wording on
    // purpose: it is the softer, retryable read. Defaulting the unknown case to
    // billing would false-alarm a genuine rate-limit (the common 429) as a spend
    // problem; a billing 429 in practice carries `insufficient_quota`, so it takes
    // the arm above rather than this default.
    return { ok: false, models: [], because: 'OpenAI is rate-limiting this account right now (429)' };
  }
  if (typeof r.status === 'number' && r.status >= 500) {
    return { ok: false, models: [], because: 'OpenAI is having trouble right now (' + r.status + ')' };
  }
  if (r.status !== 200) {
    return { ok: false, models: [], because: 'OpenAI did not return this account\'s models (it answered ' + (r.status || 'nothing usable') + ')' };
  }
  const data = r.body && Array.isArray(r.body.data) ? r.body.data : [];
  const models = chatModelsFromList(data);
  if (!models.length) {
    // The key works and OpenAI answered, but none of what it can reach is a
    // chat model we recognise -- a real, distinct answer, not a failure.
    return { ok: false, models: [], because: 'this account has no chat models we recognise yet' };
  }
  /* #2191: `models` is the COLLAPSED display menu (one row per model, dated
     snapshots folded away). `runnableKeys` is the FULL un-collapsed set of chat
     ids the account returned. They differ on purpose: the picker should be
     short, but a chosen model must be validated against everything the account
     can actually run -- a stored/submitted snapshot id like gpt-4o-2024-08-06 is
     still runnable even though the menu now shows only "gpt-4o". The change-model
     and create routes validate against runnableKeys so curation narrows the
     DISPLAY, not the runnable set. */
  return { ok: true, models, runnableKeys: chatRunnableIds(data) };
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
  list, identityOf, addWithKey, addWithKeyLive, nextWorkDir, defaultDir, forgetAccount, FORGOTTEN_PREFIX, PROVIDER, PROVIDER_NAME, /* lazy, so it cannot re-freeze what homeDir() unfroze */
  get HOME_FOR_TEST() { return homeDir(); },
  checkLive, listLive, setFetcher, MISSING_RUNNER_SENTENCE,
  accountModels, chatModelsFromList, openaiSnapshotBase, chatRunnableIds, runnableAllowlist, openaiModelClass,
  readName, writeName,   // #2095: the human-chosen display name (sidecar file)
};
