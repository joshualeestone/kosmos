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
     answered FALSE for a directory that IS the default. `forgetAccount` refused it
     correctly anyway because it compares resolved paths, which meant the exported
     helper and the engine disagreed about the one fact this helper exists to make
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

function list() {
  const out = [];
  const seen = new Set();
  const add = (dir, isDefault) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const who = identityOf(dir);
    if (!who) return;
    out.push({
      dir,
      label: isDefault ? null : path.basename(dir).replace(/^\.claude-/, ''),
      isDefault: isDefault === true,
      email: who.email,
      organization: who.organization,
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
      const connection = row.isDefault
        ? await subscription.checkLive()
        : await subscription.checkLive({ configDir: row.dir });
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
function prepare(label) {
  const clean = String(label == null ? '' : label).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!clean) return { ok: false, because: 'that is not a name we can use for an account' };
  const dir = path.join(homeDir(), `.claude-${clean}`);
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
 * 🛑 THE DEFAULT ACCOUNT IS REFUSED, AND THAT IS ONE OF THREE PLACES THIS
 * DIVERGES FROM THE OPENAI SIDE. The others: the `identityOf` check below (the
 * OpenAI sibling has none, so a `.codex-*` directory carrying no auth.json is
 * renamed on request), and the `|| 'unnamed'` label fallback where `.codex`
 * maps to `'default'`. An earlier version of this docblock called the default
 * refusal THE one divergence, which would send the next reader to
 * `openaiaccounts.js` expecting a parity that is not there.
 *
 * ⚠️ WHY THE DEFAULT IS REFUSED, STATED NARROWLY, BECAUSE AN EARLIER VERSION OF
 * THIS DOCBLOCK OVERCLAIMED IT AND THE OVERCLAIM WAS COPIED INTO THREE OTHER
 * PLACES. That version said: `prepare()` symlinks EVERY account Kosmos makes at
 * `~/.claude/projects`, so renaming that directory strands the transcripts of
 * accounts nobody asked to remove (measured: two accounts on the fleet machine
 * had both `projects` AND `settings.json` linked in). **All true, and it reads
 * as "removing the default is impossible". It is not.**
 * 🛑 The default's account record is `~/.claude.json`, a SIBLING FILE OUTSIDE
 * the directory (`configFile()`), and `list()` emits the default row from that
 * file. So taking the default off the list never required moving `~/.claude`.
 * ⇒ THE HONEST REASON IS A PRODUCT CALL, NOT AN IMPOSSIBILITY, and it is two
 * facts rather than one: moving `~/.claude.json` would sign the person out of
 * their own terminal Claude Code, which is not this button's business; and
 * moving the DIRECTORY would strand history belonging to accounts they did not
 * touch. Both fail in the quiet direction, so the refusal stands. What does not
 * stand is the claim that the act cannot be done.
 * 📌 AND THE SENTENCE SAYS "MAY" FOR A MEASURED REASON. It said "any other
 * accounts here KEEP their history inside it", which is vacuously true on a
 * single-account machine and true when memory is shared, but AFFIRMATIVELY
 * FALSE for an account with its own `projects` directory -- a state this module
 * models explicitly (`sharesMemory`, `memoryShared: false`) and the page renders
 * its own arm for. Three cases, and the earlier wording was right about two.
 * "May" is true in all three, and this is the third time this one sentence has
 * been narrowed: it is easier to assert a condition than to check it.
 * ⚠️ THAT LAST SENTENCE USED TO SAY the refusal 'names the way forward rather
 * than being a dead end'. The DEFAULT refusal deliberately names none: the
 * comment below records that both candidate remedies were removed because
 * neither was reachable (one implies the button then works, the other names an
 * affordance the page does not have). The sentence outlived the wording it was
 * written for and contradicted both the code and the plan.
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
    return {
      ok: false,
      forgotten: false,
      /* 🛑 THE REASON IS UNCONDITIONAL BECAUSE THE REFUSAL IS. An earlier
         version said "Remove the other accounts first, or sign out of this one
         instead": the first implies the button becomes usable, which it never
         does, and the second names an affordance the product does not have
         (measured: no sign-out control exists on the page). It also claimed
         other accounts keep their history here, which is FALSE on a
         single-account machine -- the common install, and the row list() always
         emits. A reason that is true only sometimes, stated as fact, on a
         refusal that is always.
         📌 PRECISELY WHAT THE REWRITE ACHIEVED, because the earlier version of
         this comment overstated it. The clause now reads "other accounts here
         MAY keep their history inside it", which is true in all three cases the
         module models: none exist, they share the primary tree, or they keep
         their own (`sharesMemory` / `memoryShared: false`).
         ⚠️ AND THIS COMMENT WAS ITSELF STALE FOR ONE ITERATION: it described an
         intermediate wording ("ANY other accounts", vacuously true) that the
         next rewrite replaced, so two comments about one sentence disagreed
         while the sentence sat three lines below both of them. The genuinely unconditional half is
         the first sentence (this is the folder Claude Code uses when nothing
         says otherwise), and that is what carries the refusal. */
      because: 'Kosmos does not remove this computer\u2019s main Claude folder. It is the one Claude Code uses when nothing says otherwise, and other accounts here may keep their history inside it.',
    };
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
     carries a `.claude.json` with an `oauthAccount`. Measured on the fleet
     machine, `.claude-workers` carries none and is the workers/inbox tree.
     Without this check `forgetAccount` renamed it, because every guard above
     keys on the NAME.
     ⚠️ AFTER the existence check on purpose: `identityOf` answers null for a
     missing directory too, so checking earlier would turn "already gone" into
     "not an account" and lose the quiet-success arm. */
  if (!identityOf(clean)) {
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

  /* `wasDefault` is a constant here and there is no branch that sets it true:
     the default is refused above, so it can never reach this line. Kept so the
     success shape matches `openaiaccounts.forgetAccount`, whose default CAN be
     forgotten. Said out loud to save the next reader hunting for the branch. */
  return { ok: true, forgotten: true, movedTo: target, wasDefault: false, because: null };
}

module.exports = { list, listLive, forgetAccount, FORGOTTEN_PREFIX, identityOf, prepare, share, sharesMemory, nextWorkDir, configFile, isDefaultDir, /* lazy, so it cannot re-freeze what homeDir() unfroze */
  get HOME_FOR_TEST() { return homeDir(); } };
