'use strict';

/**
 * The Claude accounts this machine can run agents on.
 *
 * 🔑 AN ACCOUNT IS A CONFIG DIRECTORY, NOT A LOGIN, and that is the whole of
 * this module's shape. `CLAUDE_CONFIG_DIR` selects which directory a Claude Code
 * process uses, and everything that process knows lives in there.
 *
 * 🛑 WHICH MEANS MOVING AN AGENT BETWEEN ACCOUNTS MOVES ITS MEMORY. Transcripts
 * live under `<dir>/projects`, so an agent pointed at a different account reads
 * as having no history — and the fleet's own write-up of this says the failure
 * out loud: *"An agent restarted onto a fresh account comes up with no memory,
 * and nothing on screen says so. It looks like a working agent and behaves like
 * a blank one."* Anything built on top of this module has to say that where the
 * choice is made.
 *
 * 📌 INSTRUCTIONS ARE SAFE, and it is worth stating so nobody re-derives the
 * scare: a Kosmos agent reads its instructions from its own worker folder, which
 * the supervisor passes as the working directory. Those do not live in the
 * config directory and do not move.
 *
 * ⚠️ THE NAMING IS LOad-BEARING RATHER THAN COSMETIC. `status.configRoots()`
 * finds `~/.claude` and any `~/.claude-*` that contains a `projects` directory,
 * and that is how memory readings are found. Naming Kosmos's account directories
 * `~/.claude-<label>` therefore keeps memory working across accounts for free.
 * Put them anywhere else and every agent on a second account reads Unknown.
 *
 * ⚠️ AND A `.claude-*` DIRECTORY IS NOT AUTOMATICALLY AN ACCOUNT. Measured on
 * this machine: `.claude-account-b` and `.claude-account-c` each carry a
 * `.claude.json` with an `oauthAccount`; `.claude-workers` carries none and is
 * not a login at all. The presence of that record is what makes a directory an
 * account, not the name.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
/* Safe to require from here: reporthook has zero engine dependencies, on
   purpose, because THIS module is one of its two callers (#561). */
const reporthook = require('./reporthook');
const inflight = require('./inflight');

/* 🛑 A FUNCTION, NOT A CONST (#1419). Frozen at require time this read straight
   past the sandbox seam: a caller that set `AGENT_WORKFORCE_HOME` AFTER
   requiring this module got `list()` returning the OPERATOR'S REAL ACCOUNTS,
   by their real email addresses, while believing it was sandboxed.
   ⭐ MEASURED, both arms: set after require -> 4 real accounts; set before
   require -> the 2 fixture accounts. Same call, opposite answers, decided by
   require order alone.
   ⇒ Same defect and same fix as `openaiaccounts.js` in #1337/#1420, which is
   where this was noticed. Keep it callable. */
function homeDir() { return process.env.AGENT_WORKFORCE_HOME || os.homedir(); }

/**
 * Where a config directory keeps its account record.
 *
 * 🛑 THE DEFAULT IS NOT WHERE THE OTHERS ARE, and this asymmetry would have
 * shipped as "your main account vanished from the list". Measured on this
 * machine:
 *
 *   ~/.claude.json                  <- the DEFAULT account's record, at HOME
 *   ~/.claude-account-b/.claude.json   an overridden config dir keeps its own
 *
 * There is no `~/.claude/.claude.json` at all. `engine/subscription.js` has
 * always read the HOME-level file, which is why the product has been right about
 * one account and would have been wrong about the first thing it said about two.
 */
/**
 * 🔑 EXPORTED AS THE ONE ANSWER for where an account directory keeps its
 * record: the DEFAULT account's sits BESIDE ~/.claude (at ~/.claude.json),
 * every other account's sits inside its directory. Anything resolving that
 * path by hand grows a second copy that misses the default (#527 was
 * exactly that, in subscription's scoped check). Keyed on the canonical
 * spelling of the default dir, same as every caller passes.
 */
/**
 * Is this config directory the DEFAULT one for this machine?
 *
 * 🔑 EXPORTED SO NOBODY COMPUTES IT AGAIN. `configFile` below has always encoded
 * this comparison, but only as a step toward a path, so a caller that wanted the
 * BOOLEAN had to re-derive it - and #1304 did exactly that, against bare
 * `os.homedir()`, which disagrees with this module under `AGENT_WORKFORCE_HOME`.
 * Two derivations of one fact is this codebase's most expensive habit; the fix
 * for a second one is to make the first callable rather than to write a third.
 */
function isDefaultDir(dir) {
  if (!dir) return null;
  /* 🛑 `homeDir()`, NOT A FROZEN CONST, AND A REBASE NEARLY COST THIS SILENTLY.
     Written against a `const HOME` that #1419 has since REMOVED in favour of the
     lazy `homeDir()` - "so it cannot re-freeze what homeDir() unfroze". A purely
     textual conflict resolution leaves `HOME` here, and THE CATCH BELOW WOULD
     SWALLOW THE ReferenceError and return null for every directory: `isDefault`
     silently unknown everywhere, no error, and no test that asserts a boolean
     rather than a throw would notice.
     ⇒ The catch is for an unreadable path, not for a coding mistake. Keeping one
     derivation means using the accessor the rest of this file uses. */
  /* 🛑 BOTH SIDES RESOLVED. This compared a RESOLVED left against an UNRESOLVED
     `path.join(homeDir(), '.claude')`, so under a relative AGENT_WORKFORCE_HOME it
     answered FALSE for a directory that IS the default. `forgetAccount` still
     handled it correctly (it compares resolved paths for the primary branch),
     which meant the exported helper and the engine disagreed about the one fact
     this helper exists to make
     un-re-derivable. `path.resolve` is a no-op on an already absolute path, so the
     ordinary case is unchanged. */
  try { return path.resolve(String(dir)) === path.resolve(homeDir(), '.claude'); } catch { return null; }
}

function configFile(dir) {
  /* Resolved first: a trailing slash or unnormalized spelling of the
     default dir must not silently fall to the inside-the-dir branch,
     which is the wrong-path bug this helper exists to prevent. */
  const clean = path.resolve(String(dir || ''));
  const isDefault = clean === path.resolve(homeDir(), '.claude');  /* same both-sides fix as isDefaultDir */
  /* Both branches return an ABSOLUTE path. The default branch used to return
     `path.join(homeDir(), ...)` unresolved, so a relative AGENT_WORKFORCE_HOME
     made this one branch cwd-dependent while the other was not: the same input
     class the resolve fix above was written for. */
  return isDefault ? path.resolve(homeDir(), '.claude.json') : path.join(clean, '.claude.json');
}

/**
 * The account a config directory is signed in to, or null.
 *
 * ⚠️ NULL FOR EVERY UNREADABLE SHAPE rather than a guess: a missing file, a
 * file that is not JSON, and a config with no `oauthAccount` are all "this is
 * not a signed-in account", and none of them is an error worth surfacing.
 */
function identityOf(dir) {
  let raw;
  try { raw = fs.readFileSync(configFile(dir), 'utf8'); } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const acct = parsed && parsed.oauthAccount;
  if (!acct || typeof acct !== 'object') return null;
  const email = typeof acct.emailAddress === 'string' ? acct.emailAddress
    : typeof acct.email === 'string' ? acct.email : null;
  return {
    email,
    organization: typeof acct.organizationName === 'string' ? acct.organizationName : null,
  };
}

/**
 * Every account on this machine, the default one first.
 *
 * 📌 `~/.claude` IS ALWAYS FIRST AND IS NEVER SYNTHESISED. It is the directory
 * Claude Code uses with no override, so it is the account an agent runs on
 * unless something says otherwise — and it is the one the rest of the product
 * has always meant by "your account".
 */
/**
 * Does this account write its transcripts into the SAME tree as the primary?
 *
 * The primary trivially does. Anything else has to be a symlink resolving to
 * the primary's `projects`, which is what `prepare()` creates and what somebody
 * wired by hand on this machine before Kosmos could.
 *
 * ⚠️ FALSE ON ANY DOUBT. A broken symlink, an unreadable directory and a real
 * directory of its own all answer false, because the only action this gates is
 * moving an agent's working life onto that account.
 */
function sharesMemory(dir, isDefault) {
  if (isDefault) return true;
  const primary = path.join(homeDir(), '.claude', 'projects');
  const here = path.join(dir, 'projects');
  try {
    if (!fs.lstatSync(here).isSymbolicLink()) return false;
    return fs.realpathSync(here) === fs.realpathSync(primary);
  } catch { return false; }
}

/**
 * Point an EXISTING account's transcripts at the primary tree.
 *
 * 🔑 `prepare()` does this for accounts Kosmos creates; this is the same act for
 * one that was already on the machine when Kosmos arrived. Josh's rule is about
 * the agent, not about who made the directory: *"her memory should follow her
 * everywhere she goes."*
 *
 * 🛑 IT WILL NOT REPLACE A REAL DIRECTORY. A `projects` folder with somebody's
 * actual history in it is not ours to delete, and deleting it is precisely the
 * amnesia this whole area exists to prevent, arriving from the other direction.
 * An empty one is safe to swap and is the common case for an account that has
 * never run an agent.
 */
function share(dir) {
  const primary = path.join(homeDir(), '.claude', 'projects');
  const here = path.join(dir, 'projects');
  /* 🛑 `isDefaultDir(dir)`, NOT A THIRD HAND-ROLLED COMPARISON. This read
     `dir === path.join(homeDir(), '.claude')`: raw string equality, NEITHER side
     resolved, which is the exact pattern the helper at :87 exists to end.
     ⚠️ AND THIS ONE IS THE DESTRUCTIVE CALLER, which is why it matters more than
     the other two. A trailing slash made `share('<home>/.claude/')` classify the
     DEFAULT as non-default, take the mutation path, `rmSync` ~/.claude/projects
     and symlink it TO ITSELF: realpath and readdir then throw ELOOP and
     `sharesMemory` answers false for every account on the machine, while the
     return value is a cheerful { ok: true }.
     📌 Not reachable through /api/accounts/share, which looks the row up in
     `list()` and passes the canonical spelling. But `share` is exported, and this
     branch is the one asserting that the two derivations can no longer disagree. */
  if (sharesMemory(dir, isDefaultDir(dir) === true)) return { ok: true, already: true };
  let st = null;
  try { st = fs.lstatSync(here); } catch { st = null; }
  if (st && !st.isSymbolicLink()) {
    let empty = false;
    try { empty = fs.readdirSync(here).length === 0; } catch { empty = false; }
    if (!empty) {
      return { ok: false, because: 'that account already keeps its own history here, and we will not delete it' };
    }
  }
  try {
    fs.mkdirSync(primary, { recursive: true });
    if (st) fs.rmSync(here, { recursive: true, force: true });
    fs.symlinkSync(primary, here);
  } catch {
    return { ok: false, because: 'we could not point that account at your agents\' history' };
  }
  return { ok: true, already: false };
}

/**
 * #2420: does this directory hold a stored api-key Claude account? An api-key
 * account writes NO `oauthAccount` -- only a mode-600 key file
 * (claudeaccounts.KEY_BASENAME) and a settings.json `apiKeyHelper` pointer -- so
 * `identityOf()` is null for it and `list()` would skip it. The key file is the
 * marker that makes such a directory an account, exactly as an `oauthAccount` is
 * the marker for a subscription one (and exactly the marker `nextWorkDir` already
 * treats as "occupied").
 *
 * Lazy require, matching `nextWorkDir`: claudeaccounts -> subscription ->
 * (lazy) accounts, so a top-level require here could re-enter this module
 * mid-load. Fails CLOSED (false) if the module cannot load or the stat throws:
 * a directory we cannot confirm holds a key is never surfaced as an account.
 */
function apiKeyStored(dir) {
  let keyFile = null;
  try { keyFile = require('./claudeaccounts').keyFile(dir); } catch { return false; }
  try { return fs.existsSync(keyFile); } catch { return false; }
}

function list() {
  const out = [];
  const seen = new Set();
  const add = (dir, isDefault) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const who = identityOf(dir);
    /* #2420: a directory with a stored api-key but NO oauthAccount is a
       first-class api-key Claude account that `identityOf` (which reads
       oauthAccount only) cannot see. The default account is never one of these
       -- it is the subscription account Claude Code uses with no override -- and
       the `!who` guard means a directory somehow carrying BOTH markers is
       surfaced as its subscription account: the more informative identity. That
       dual-marker state is now prevented at CREATION from both directions -- the
       create route's taken-label guard blocks a key over an existing oauth, and
       (added with this slice, because making api-key dirs visible here is what
       made it reachable) the /api/connect/start guard blocks an OAuth reauth over
       an existing key. `apiKeyStored` is only reached when `identityOf` is null,
       so the fast 5-second tick pays no extra stat for a real oauth account. */
    const apiKey = !who && isDefault !== true && apiKeyStored(dir);
    if (!who && !apiKey) return;
    out.push({
      dir,
      label: isDefault ? null : path.basename(dir).replace(/^\.claude-/, ''),
      isDefault: isDefault === true,
      email: who ? who.email : null,
      organization: who ? who.organization : null,
      /* #2420: whether this account runs on a pasted API key rather than an
         OAuth subscription login. `listLiveNow` reads it to pick the right
         live-badge reader (claudeaccounts.checkLive vs subscription.checkLive);
         it is `false` on every subscription row so the field is present with one
         meaning across the list, never absent-vs-false. */
      apiKey: apiKey === true,
      /* Whether a memory reading taken on this account can be FOUND. See the
         naming note at the top: `status.configRoots` only looks at `~/.claude`
         and `~/.claude-*`, and only when a `projects` directory is there. */
      memoryReadable: fs.existsSync(path.join(dir, 'projects')),
      /* 🛑 THE STRONGER QUESTION, AND THE ONE THAT DECIDES WHETHER AN AGENT MAY
         BE MOVED HERE. `memoryReadable` only asks whether a transcripts tree
         EXISTS at this account; `memoryShared` asks whether it is the SAME tree
         the rest of the machine writes to. An account with its own separate
         tree reads as perfectly fine and gives an agent moved onto it a blank
         history -- which presents as a working agent behaving like a new one,
         with nothing on screen saying why.
         📌 Measured on this machine: `.claude-account-b/projects` and `-c` are
         both symlinks to `~/.claude/projects`, wired by hand months before this
         function existed. That hand-wiring is the precedent, and `prepare()`
         does it for every account Kosmos makes. This field is what lets the
         screen tell the two kinds of account apart. */
      memoryShared: sharesMemory(dir, isDefault === true),
    });
  };

  add(path.join(homeDir(), '.claude'), true);
  let entries = [];
  try { entries = fs.readdirSync(homeDir()); } catch { entries = []; }
  for (const name of entries.sort()) {
    if (!name.startsWith('.claude-')) continue;
    add(path.join(homeDir(), name), false);
  }
  return out;
}

/**
 * `list()`, with each row's connection LIVE-CHECKED against Anthropic (#881).
 *
 * 🛑 NOT `list()` ITSELF. `list()` is called once per 5-second board-status
 * tick (server.js) specifically because that poll cannot afford anything
 * heavier than a directory stat; layering a live subprocess call in there
 * would repeat the mistake `subscription.js`'s own file-cache header warns
 * against, worse. This function exists ONLY for the on-demand `GET
 * /api/accounts` route -- opened deliberately (Settings > Accounts), never
 * ticked -- where paying a real check's cost is the entire point.
 *
 * Parallel, not serial: one account's live check taking the full timeout
 * must not make every other account's row wait behind it.
 */
async function listLiveNow() {
  // Lazy require, matching subscription.js's own `require('./accounts')`
  // inside check() -- these two modules require each other, and a
  // top-level require on either side would deadlock on load order.
  const subscription = require('./subscription');
  // #2420: the live-badge reader for an api-key Claude row. Lazy, same load-order
  // reason as the require in `apiKeyStored`; cached, so this costs nothing after
  // the first call.
  const claudeaccounts = require('./claudeaccounts');
  const rows = list();
  const checked = await Promise.all(rows.map(async (row) => {
    try {
      /* 🛑 THE DEFAULT ROW IS NOT `configDir: row.dir`. Measured directly,
         not assumed: `configFile()` above already special-cases the
         default account's config as `<HOME>/.claude.json`, a file
         BESIDE `<HOME>/.claude`, not inside it -- and confirmed live on
         this machine, `CLAUDE_CONFIG_DIR=<HOME>/.claude` makes the real
         `claude` binary read `<HOME>/.claude/.claude.json` instead (a
         stale, near-empty decoy file here, 464 bytes, next to the real
         132KB one `check()` already knows to read at the sibling path).
         Passing row.dir for the default account would make the single
         most common install ALWAYS read as not-signed-in -- exactly the
         "tell a paying customer they are not connected" failure this
         whole feature exists to prevent, reintroduced by the fix meant
         to catch it. Omitting configDir for the default row lets `claude
         auth status` use its own built-in default resolution instead,
         which this machine confirms lands on the real account. */
      let connection;
      if (row.isDefault) {
        connection = await subscription.checkLive();
      } else if (row.apiKey) {
        /* #2420: an api-key account has no OAuth subscription to query -- its
           liveness is whether the STORED KEY still authenticates. checkLive
           reads the mode-600 key file and asks Anthropic, keeping the same
           asymmetry every reader here keeps: only a positive rejection is NONE,
           unreachable is UNKNOWN. Shape-matched with `plan: null` so every row's
           connection carries the same fields (the subscription arm and the catch
           arm below both do), and the badge overlay in server.js reads one
           vocabulary regardless of how the row was checked. `plan: null` is
           written AFTER the spread on purpose: an api-key account has no
           subscription plan, so plan is null regardless of anything checkLive
           might one day return. */
        const c = await claudeaccounts.checkLive(row.dir);
        connection = { ...c, plan: null };
      } else {
        connection = await subscription.checkLive({ configDir: row.dir });
      }
      return { ...row, connection };
    } catch {
      // ⚠️ ONE ACCOUNT'S CHECK FAILING NEVER SINKS THE WHOLE LIST. `unknown`,
      // never `none` -- the same asymmetry subscription.js is built on.
      // ⚠️ NO RAW err.message HERE EITHER (same rule, same challenge-loop
      // pass that fixed subscription.js's own catch): checkLive() never
      // rejects by contract, so this is defense in depth against that
      // contract regressing, not a path that fires today -- but the
      // sentence still has to be hand-written for the day it does.
      return {
        ...row,
        connection: {
          state: subscription.STATE.UNKNOWN, plan: null, checkedLive: true,
          because: 'we could not check this account just now',
        },
      };
    }
  }));
  return checked;
}

/**
 * Make a directory a Kosmos account can be signed in to.
 *
 * 🔑 THE RULE THIS ENCODES IS JOSH'S, 2026-08-22, and it is a principle rather
 * than a setting: **an agent's memory belongs to the agent.** His words: *"her
 * memory should follow her everywhere she goes"* — across models, across
 * accounts, and across providers the day there is a second one.
 *
 * 📌 WHICH FALLS OUT ALMOST FREE, because of what the store is already keyed by.
 * Claude Code files transcripts under the DIRECTORY A SESSION WAS LAUNCHED IN,
 * and Kosmos launches every agent in its own folder. So the tree is already
 * per-agent; it just happens to live inside whichever config directory is in
 * use. Pointing every account at ONE tree therefore does not move memory to a
 * new home — it stops a second home from existing.
 *
 * 🛑 AND WITHOUT THIS, A SECOND ACCOUNT IS A QUIET AMNESIA. The fleet's own
 * write-up of this failure: *"An agent restarted onto a fresh account comes up
 * with no memory, and nothing on screen says so. It looks like a working agent
 * and behaves like a blank one."* That is the outcome this function exists to
 * make impossible rather than to warn about.
 *
 * ⚠️ THE NAME IS LOAD-BEARING TWICE OVER. `~/.claude-<label>` is what
 * `status.configRoots()` scans, so a directory named anything else is invisible
 * to the memory reading even with the tree shared.
 */
/**
 * The sanitized label and the config dir it maps to, WITHOUT any side effect
 * (#2420). `prepare` uses this and then creates the dir; a caller that must
 * decide something about the dir BEFORE creating it (e.g. refuse a taken label
 * without prepare's hooks-merge touching an existing account) uses it alone.
 * Returns `{ ok:true, clean, dir }` or `{ ok:false, because }`, the same label
 * validation prepare has always applied.
 */
function dirForLabel(label) {
  const clean = String(label == null ? '' : label).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!clean) return { ok: false, because: 'that is not a name we can use for an account' };
  return { ok: true, clean, dir: path.join(homeDir(), `.claude-${clean}`) };
}

function prepare(label) {
  const named = dirForLabel(label);
  if (!named.ok) return { ok: false, because: named.because };
  const clean = named.clean;
  const dir = named.dir;
  const shared = path.join(homeDir(), '.claude', 'projects');

  try { fs.mkdirSync(dir, { recursive: true }); }
  catch { return { ok: false, because: 'we could not make a place for that account on this computer' }; }

  const projects = path.join(dir, 'projects');
  let memoryShared = false;
  try {
    const st = fs.lstatSync(projects);
    /* Already pointed somewhere. A real directory here is somebody's existing
       history and is NOT ours to replace — that is the amnesia this guards
       against, arriving from the other direction. */
    memoryShared = st.isSymbolicLink() && fs.realpathSync(projects) === fs.realpathSync(shared);
  } catch {
    try {
      fs.mkdirSync(shared, { recursive: true });
      fs.symlinkSync(shared, projects);
      memoryShared = true;
    } catch { memoryShared = false; }
  }
  /* Born with its reporting hooks (#561), the same born-correct-or-not-born
     rule as the memory symlink above: an account dir Kosmos makes carries
     the Layer 1 wiring from its first moment, so an agent moved onto it
     reports itself the way every default-account agent does. Merge-only
     (reporthook keeps this function's own never-clobber posture), and fail
     SOFT: an account that could not get its hooks is still an account --
     the board falls back to scraping it, which is honest and visible,
     while a refused prepare would be a worse failure for a smaller cause.
     The field in the return is what lets a screen say which happened.
     Reused spots get this free: the connect route re-runs prepare. */
  const hooks = reporthook.ensureWired(path.join(dir, 'settings.json'), reporthook.hookScriptPath());
  return { ok: true, dir, label: clean, memoryShared, hooksWired: hooks.wired === true };
}

/**
 * The first free work-account spot (#248/#324): ~/.claude-workN where free
 * means the directory does not exist, or exists with no identity signed in
 * to it. The reuse arm is deliberate: a cancelled add-another-account
 * attempt leaves a prepared, unclaimed directory behind, and without reuse
 * every retry would litter work2, work3, ... while work1 sat empty. A dir
 * with an account block in its config, or whose config cannot be read,
 * may be somebody's account and is skipped; a config with no account
 * block is the shape a cancelled launch leaves and is reused; and the
 * projects entry must be absent or already the shared-tree link, the
 * same thing prepare demands, so a spot is never offered that prepare
 * would then refuse forever.
 */
function nextWorkDir() {
  /* #2420: the basename an api-key Claude account stores its key under. Resolved
     ONCE (require caches, but hoisting reads cleaner than a per-iteration call) and
     runtime, so claudeaccounts -> subscription -> (lazy) accounts never re-enters
     this module mid-load. If the module cannot load, this is null and the occupancy
     check below is skipped -- failing OPEN, which is SAFE here: a claudeaccounts that
     will not load means the api-key feature never ran, so no key files exist to
     contaminate a reused slot. */
  let apiKeyBasename = null;
  try { apiKeyBasename = require('./claudeaccounts').KEY_BASENAME; } catch { apiKeyBasename = null; }
  for (let n = 1; n <= 500; n += 1) {
    const label = `work${n}`;
    const dir = path.join(homeDir(), `.claude-${label}`);
    if (!fs.existsSync(dir)) return { label, dir };
    /* ⚠️ THREE GRADES OF CONFIG, three answers. Missing: free. Present
       and readable with NO account block: free, and this is the arm the
       contract's anti-litter promise lives in, because the CLI writes a
       theme-and-onboarding .claude.json the moment it launches, so the
       COMMON cancel leaves exactly this shape behind. Present with an
       account block, or unreadable, or unparseable: NOT free, because it
       may be somebody's signed-in account and a wrong guess overwrites
       their credentials. */
    let cfgFree = false;
    try {
      const raw = fs.readFileSync(configFile(dir), 'utf8');
      try {
        const parsed = JSON.parse(raw);
        const acct = parsed && parsed.oauthAccount;
        cfgFree = !acct || typeof acct !== 'object';
      } catch { cfgFree = false; }
    } catch (err) { cfgFree = Boolean(err && err.code === 'ENOENT'); }
    if (!cfgFree) continue;
    /* #2420: an api-key Claude account writes NO oauthAccount -- only a
       settings.json apiKeyHelper and a mode-600 key file -- so the cfg check
       above reads it as free. It is NOT free: handing its slot to a
       subscription "add another account" would leave both an apiKeyHelper and
       an oauthAccount in the dir, and Claude Code prefers apiKeyHelper, so the
       subscription's billing would silently switch to the stored key (the
       inverse of the taken-label guard the api-key connect route applies). A
       stored key file means occupied. */
    if (apiKeyBasename && fs.existsSync(path.join(dir, apiKeyBasename))) continue;
    /* And freeness demands exactly what preparability demands, or a
       half-formed spot is offered forever while prepare refuses it
       forever: the projects entry must be absent, or a symlink that
       RESOLVES to the shared tree. A symlink pointing elsewhere, a
       broken one, and a real directory are all somebody's state. */
    /* ⚠️ TWO DIFFERENT ENOENTs, split on purpose: lstat throwing ENOENT
       means NO projects entry (free), while realpath throwing ENOENT
       means the entry EXISTS as a symlink whose target does not resolve,
       which is somebody's broken state and, worse, a spot prepare can
       never claim (it will not replace an existing link), so calling it
       free would wedge every future attempt on the same dead dir. */
    let projectsOk = false;
    const projects = path.join(dir, 'projects');
    let entry = null;
    try { entry = fs.lstatSync(projects); }
    catch (err) { projectsOk = Boolean(err && err.code === 'ENOENT'); }
    if (entry) {
      try {
        projectsOk = entry.isSymbolicLink()
          && fs.realpathSync(projects) === fs.realpathSync(path.join(homeDir(), '.claude', 'projects'));
      } catch { projectsOk = false; }
    }
    if (projectsOk) return { label, dir };
  }
  /* 500 signed-in work accounts is not a real machine; say so rather than
     loop forever. */
  return null;
}

/* #1618: concurrent callers share ONE sweep. Not a cache - the slot holds the
   promise only while it is unsettled, so nobody is ever handed an answer from a
   moment that has passed, and a failed sweep is cleared like a successful one.
   A TTL cache was tried on #1618 and the suite killed it in one run, because a
   window converts `cannot tell` back into a confident `not connected`, which is
   the one thing this sweep exists never to do.
   ⚠️ `inflight.collapse`, not the `share` exported below: that one is about two
   accounts sharing MEMORY and the collision of names would be a nasty one. */
const listLive = inflight.collapse(listLiveNow);

const FORGOTTEN_PREFIX = '.removed-claude-';

/**
 * Take a Claude account off the list (#1659).
 *
 * The Claude half of the OpenAI removal shipped in #1372. Same act, same shape,
 * same refusal, deliberately: two buttons sitting in one row builder, under one
 * word, must not mean two different things depending on a provider the person
 * is not thinking about.
 *
 * 🔑 IT FORGETS RATHER THAN DELETES. The directory is renamed out of the way, so
 * the sign-in file is still on this computer and a removal is recoverable by
 * somebody who knows where to look. "Removed" and "deleted" are different
 * promises and the caller is told which one it got.
 *
 * 🛑 THE DEFAULT ACCOUNT IS REMOVABLE NOW (#2684), and HOW differs from a
 * secondary. A secondary is renamed aside; the default's identity is the
 * `oauthAccount` key in `~/.claude.json` -- a SIBLING FILE outside the directory
 * (`configFile()`), which is where `list()` reads the default row from. The
 * `.claude` dir itself is Claude Code's home and may hold other accounts' history
 * via prepare()'s `projects` symlinks. So the primary branch below clears ONLY
 * that key (atomically, preserving the file mode) and KEEPS the dir + every other
 * config key: the connection leaves the list without signing the person out of
 * terminal Claude Code or stranding anyone's history. The running-agents guard is
 * inlined in that branch (a registered agent still blocks it), and forget and
 * remove converge for the default because there is no dir to safely rename-aside
 * or rmSync. (OpenAI differs: there the whole `.codex` dir IS the account, so its
 * default is whole-dir deletable -- see openaiaccounts.removeAccount.)
 */
function forgetAccount(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const base = path.basename(clean);

  /* Only ever a Claude account directly inside this computer's home. A path
     from anywhere else is not ours to move, and saying so beats moving it. */
  if (path.dirname(clean) !== home || !(base === '.claude' || base.startsWith('.claude-'))) {
    return { ok: false, forgotten: false, because: 'that is not a Claude account on this computer' };
  }

  if (base === '.claude') {
    /* #2684: the PRIMARY is removable now, by clearing its oauth identity from
       <HOME>/.claude.json rather than touching the dir (see clearDefaultIdentity
       for why the dir must survive). The running-agents guard still applies and
       is inlined here because the primary path returns before the shared block
       below: an agent's launch file points at this dir by absolute path, so a
       still-registered agent must be moved off it first. Josh's own use case
       (2026-09-11, #2684) is to move every agent to another account and THEN
       remove the original, so at his delete time this list is empty. */
    const primaryAgents = (Array.isArray(usedBy) ? usedBy : []).filter((n) => typeof n === 'string' && n);
    if (primaryAgents.length) {
      return {
        ok: false,
        forgotten: false,
        usedBy: primaryAgents,
        because: primaryAgents.length === 1
          ? `${primaryAgents[0]} is set up to run on this account. Move it to another account or remove it first.`
          : `${primaryAgents.length} agents are set up to run on this account: ${primaryAgents.join(', ')}. `
            + 'Move them to another account or remove them first.',
      };
    }
    const res = clearDefaultIdentity();
    if (!res.ok) return { ok: false, forgotten: false, because: res.because };
    /* wasDefault:true lets the caller's messaging say the MAIN connection was
       removed; forgotten:true on both arms because from the person's view the
       primary is gone from the list whether or not there was an identity to
       clear. No movedTo: nothing was renamed aside, so there is nothing to
       restore to -- re-connecting is a fresh sign-in.
       📌 defaultCleared distinguishes "we just cleared an identity" (true) from
       "it was already signed out, nothing to clear" (false). No server/web caller
       branches on it yet; it is asserted by the tests and kept for a future
       messaging split (e.g. "signed out" vs "already signed out"). */
    return { ok: true, forgotten: true, wasDefault: true, defaultCleared: res.already !== true, because: null };
  }

  /* 🛑 REFUSED WHILE AN AGENT IS ON IT, AND THE AGENTS ARE NAMED. The agent's
     launch file points at this directory by absolute path, so the refusal is
     not politeness, it is what makes the rename safe. And a refusal a person
     cannot act on is a dead end: they need to know WHICH agents. */
  const agents = (Array.isArray(usedBy) ? usedBy : []).filter((n) => typeof n === 'string' && n);
  if (agents.length) {
    return {
      ok: false,
      forgotten: false,
      usedBy: agents,
      /* 🛑 "IS SET UP TO RUN ON", NOT "IS RUNNING", AND THE CHANGE IS A TRUTH FIX
         RATHER THAN A WORDING PREFERENCE. This said "is running on this account",
         which was accurate while only the live roster could populate `agents`. The
         #1693/#1697 union now includes REGISTERED-BUT-STOPPED agents, so the
         sentence started sending people to look for a running agent that is not
         running, on the exact path that exists to stop them losing one.
         📌 Reworded in openaiaccounts.js too: same sentence, same defect, and the
         two buttons now sit in one row builder under one word. */
      because: agents.length === 1
        ? `${agents[0]} is set up to run on this account. Move it to another account or remove it first.`
        : `${agents.length} agents are set up to run on this account: ${agents.join(', ')}. `
          + 'Move them to another account or remove them first.',
    };
  }

  if (!fs.existsSync(clean)) {
    return { ok: true, forgotten: false, because: 'that account is already gone from this computer' };
  }

  /* 🛑 THE NAME IS NOT THE ACCOUNT, AND THIS FUNCTION IS THE ONE PLACE THAT
     MATTERED. The docblock at the top of this module states the invariant and
     `list()` enforces it: a `.claude-*` directory is an account only if it
     carries a `.claude.json` with an `oauthAccount` OR a stored api-key file.
     Measured on the fleet machine, `.claude-workers` carries neither and is the
     workers/inbox tree. Without this check `forgetAccount` renamed it, because
     every guard above keys on the NAME.
     📌 #2420: an api-key account is invisible to `identityOf` (which reads
     `oauthAccount` only), so the guard also accepts a dir carrying the stored
     key file -- the same `apiKeyStored` marker `list()` surfaces it by. Keying
     both on that one helper means the removable set matches the listed set.
     ⚠️ AFTER the existence check on purpose: `identityOf` answers null for a
     missing directory too, so checking earlier would turn "already gone" into
     "not an account" and lose the quiet-success arm. */
  const hadKey = apiKeyStored(clean);
  if (!identityOf(clean) && !hadKey) {
    return { ok: false, forgotten: false, because: 'that is not a Claude account on this computer' };
  }

  const label = base.slice('.claude-'.length) || 'unnamed';
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

  /* #2420: an api-key account's credential is a raw key on disk, not an OAuth
     token inside .claude.json. Forgetting it must take the key back the way
     forgetCodexFolder takes back the codex trust it wrote -- otherwise the
     renamed-aside dir keeps a live, mode-0600 raw key that no account uses.
     🛑 AFTER the rename, not before, and best-effort: erasing before the rename
     would destroy the credential on a rename FAILURE (the arm above returns an
     error while the key is already gone) -- the oauth path destroys nothing on
     that arm, and this must match it. So the rename is the commit point; the key
     erase and pointer unwire are cleanup on the moved dir that cannot un-forget
     the account if they fail.
     📌 A swallowed erase failure therefore leaves the raw key in the aside dir,
     and that residual is accepted rather than surfaced: the rename we just made
     proves write access to the dir, so a forgetKey throw here is near-impossible.
     Surfacing it would also mean logging around a credential, which this module
     family avoids on purpose -- openaiaccounts' codex login drops stdout/stderr so
     a pasted key cannot echo into a log.
     📌 Only when the account HAD a key (`hadKey`), and the gate is PROTECTIVE
     rather than cosmetic. forgetKey on an oauth dir would rm a nonexistent key
     file (a no-op), but unwireApiKeyHelper strips ANY `apiKeyHelper` -- so running
     the erase unconditionally would clobber a hand-set apiKeyHelper an oauth
     account may legitimately carry, a setting this slice never wrote. Gating on
     hadKey is what keeps that oauth path unchanged; the CONTROL test builds exactly
     that oauth-with-a-hand-set-helper case and reds if the gate is removed. A
     dual-marker dir (both an oauth token and a stray key -- prevented at creation
     now, per list()'s comment) has hadKey true, so its stray key is still swept. */
  if (hadKey) {
    let ca = null;
    try { ca = require('./claudeaccounts'); } catch { ca = null; }
    if (ca) {
      try { ca.forgetKey(target); } catch { /* best effort: the account is already forgotten */ }
      try { ca.unwireApiKeyHelper(path.join(target, 'settings.json')); } catch { /* best effort */ }
    }
  }

  /* `wasDefault` is a constant false here: this is the SECONDARY (rename-aside)
     path, which the default never reaches -- #2684 handles the default in its own
     branch above (identity cleared, returns wasDefault:true) rather than falling
     through to here. Kept so the success shape matches openaiaccounts.forgetAccount.
     Said out loud to save the next reader hunting for the branch. */
  return { ok: true, forgotten: true, movedTo: target, wasDefault: false, because: null };
}

/**
 * #2684: remove the PRIMARY/default (`.claude`) connection.
 *
 * The primary is special and neither renaming nor deleting its DIRECTORY is the
 * right mechanism: `~/.claude` is the folder Claude Code uses when nothing says
 * otherwise, and secondary accounts may symlink their `projects/` into it
 * (`sharesMemory`), so removing the dir would destroy Claude Code's home and
 * orphan other accounts' history. The primary's IDENTITY is not in the dir at
 * all -- it is the `oauthAccount` key in `<HOME>/.claude.json` (`configFile` of
 * the default dir). So "remove the primary connection" means surgically deleting
 * ONLY that key, via a JSON round-trip that preserves every other key (MCP
 * servers, project state, ...), and leaving the `.claude` dir untouched. Because
 * the dir survives, there is no history to orphan, so this needs no
 * shared-history guard -- only the running-agents guard its callers already run.
 *
 * This is why both the delete and the disconnect doors call this for the primary:
 * with no dir to rename-aside or `rmSync`, clearing the identity is the one safe
 * act, and after it `identityOf('.claude')` is null so the connection is gone
 * from `list()`.
 *
 * Return shape: `{ ok, already, because }`. `already:true` means there was no
 * identity to clear (no config file, or no `oauthAccount`) -- a quiet success,
 * the same shape the sibling functions use for an account that is already gone.
 * A refusal (`ok:false`) is reserved for a config file we could not read as JSON
 * or could not write: we never leave `<HOME>/.claude.json` half-written or
 * corrupt.
 */
function clearDefaultIdentity() {
  const cfg = configFile(path.join(homeDir(), '.claude')); /* <HOME>/.claude.json */
  let raw;
  try { raw = fs.readFileSync(cfg, 'utf8'); }
  catch { return { ok: true, already: true, because: null }; } /* no config => nothing signed in */
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    /* 🛑 DO NOT TOUCH A FILE WE CANNOT PARSE. Rewriting it would destroy the very
       unrelated config (MCP servers, project state) this mechanism exists to
       preserve. Refuse and say so, rather than risk corrupting it. */
    return { ok: false, already: false, because: 'we could not read this computer’s Claude config, so the main connection was left untouched' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.prototype.hasOwnProperty.call(parsed, 'oauthAccount')) {
    return { ok: true, already: true, because: null }; /* already disconnected */
  }
  delete parsed.oauthAccount;
  /* Two-space indent + trailing newline: the shape Claude Code itself writes, so
     a human diff of `.claude.json` after this stays legible. Only `oauthAccount`
     is gone; every other key round-trips unchanged.
     🛑 ATOMIC temp+rename, matching every other JSON-config write in this engine
     (worlds.js, remove.js, discover.js). A direct writeFileSync on `.claude.json`
     -- routinely MBs of `projects`/state -- issues multiple write() syscalls, so a
     crash/kill/power-loss mid-write would TRUNCATE exactly the unrelated config this
     clear exists to preserve. rename() is atomic: a crash leaves the original file
     intact and only a stray `.tmp` behind. The catch handles a JS-level failure;
     the rename handles the process-level one the promise in this docblock is about.
     ⚠️ PRESERVE THE MODE. A fresh temp adopts the umask, so a mode-600 `.claude.json`
     (it can hold a token) would silently widen to 644 -- the atomic-write idiom's
     known permission-discard trap. stat the original, write the temp, chmod it back,
     then rename. */
  try {
    let mode = 0o600;
    try { mode = fs.statSync(cfg).mode & 0o777; } catch { /* keep the 600 default */ }
    const tmp = `${cfg}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n', { mode });
      fs.chmodSync(tmp, mode);
      fs.renameSync(tmp, cfg);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort: never leave a partial temp */ }
      throw e;
    }
  } catch { return { ok: false, already: false, because: 'we could not update this computer’s Claude config to remove the main connection' }; }
  return { ok: true, already: false, because: null };
}

/**
 * #2264: DELETE AND REMOVE a Claude account -- the destructive sibling of
 * forgetAccount. forgetAccount RENAMES the directory aside (reversible, the
 * credential survives on disk); this DELETES it, so the sign-in is gone from
 * this computer. Josh, 2026-09-05: a connection to someone else's account he no
 * longer wants to see at all, credential and all -- "not just disconnect it".
 *
 * 🛑 EVERY GUARD forgetAccount HAS, because deleting is strictly more dangerous
 * than renaming: same-home + name shape; the DEFAULT `.claude` is REMOVABLE (#2684) by
 * clearing its oauth identity from `~/.claude.json`, KEEPING the dir + other
 * accounts' symlinked history (it is Claude Code's home); the
 * running-agents gate (a running agent's launch file points here by absolute
 * path); and the identity guard (NEVER rm a name-shaped folder that is not an
 * account -- `.claude-workers` is the measured example). Only the final step
 * differs: rmSync instead of renameSync. Irreversible on purpose; the UI asks
 * with a destructive confirm.
 */
function removeAccount(dir, usedBy) {
  const home = path.resolve(homeDir());
  const clean = path.resolve(String(dir == null ? '' : dir));
  const base = path.basename(clean);

  if (path.dirname(clean) !== home || !(base === '.claude' || base.startsWith('.claude-'))) {
    return { ok: false, removed: false, because: 'that is not a Claude account on this computer' };
  }
  if (base === '.claude') {
    /* #2684: the PRIMARY is deletable now, by clearing its oauth identity from
       <HOME>/.claude.json -- NOT by rmSync-ing the dir, which is Claude Code's
       home and may hold secondaries' symlinked history (see clearDefaultIdentity).
       So the delete and disconnect doors converge for the primary: there is no
       dir to rename-aside or remove without collateral loss, and clearing the
       identity is the one safe act. The running-agents guard is inlined here for
       the same reason forgetAccount's is: the primary returns before the shared
       block below. */
    const primaryAgents = (Array.isArray(usedBy) ? usedBy : []).filter((n) => typeof n === 'string' && n);
    if (primaryAgents.length) {
      return {
        ok: false,
        removed: false,
        usedBy: primaryAgents,
        because: primaryAgents.length === 1
          ? `${primaryAgents[0]} is set up to run on this account. Move it to another account or remove it first.`
          : `${primaryAgents.length} agents are set up to run on this account: ${primaryAgents.join(', ')}. `
            + 'Move them to another account or remove them first.',
      };
    }
    const res = clearDefaultIdentity();
    if (!res.ok) return { ok: false, removed: false, because: res.because };
    return { ok: true, removed: true, wasDefault: true, defaultCleared: res.already !== true, because: null };
  }
  const agents = (Array.isArray(usedBy) ? usedBy : []).filter((n) => typeof n === 'string' && n);
  if (agents.length) {
    return {
      ok: false,
      removed: false,
      usedBy: agents,
      because: agents.length === 1
        ? `${agents[0]} is set up to run on this account. Move it to another account or remove it first.`
        : `${agents.length} agents are set up to run on this account: ${agents.join(', ')}. `
          + 'Move them to another account or remove them first.',
    };
  }
  if (!fs.existsSync(clean)) {
    return { ok: true, removed: false, because: 'that account is already gone from this computer' };
  }
  /* Same identity guard as forgetAccount, and the same #2420 relaxation: an
     api-key account (a `.claude-*` dir with the stored key file but no
     oauthAccount) is a real account and must be deletable, while a name-shaped
     dir that is NEITHER (`.claude-workers`) is still refused. `rmSync` below
     takes the whole dir, key file included, so unlike forget there is no separate
     erase step -- only the guard needs relaxing. */
  if (!identityOf(clean) && !apiKeyStored(clean)) {
    return { ok: false, removed: false, because: 'that is not a Claude account on this computer' };
  }
  try { fs.rmSync(clean, { recursive: true, force: true }); }
  catch { return { ok: false, removed: false, because: 'we could not delete that account from this computer' }; }
  return { ok: true, removed: true, because: null };
}

module.exports = { list, listLive, forgetAccount, removeAccount, FORGOTTEN_PREFIX, identityOf, prepare, dirForLabel, share, sharesMemory, nextWorkDir, configFile, isDefaultDir, /* lazy, so it cannot re-freeze what homeDir() unfroze */
  get HOME_FOR_TEST() { return homeDir(); } };
