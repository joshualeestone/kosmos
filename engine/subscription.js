'use strict';

/**
 * Is a Claude subscription connected on this machine?
 *
 * ⚠️ THIS IS THE FIRST QUESTION FIRST RUN ASKS, AND THE ONE MOST LIKELY TO BE
 * ANSWERED WRONG.
 *
 * The obvious field is `hasAvailableSubscription`. It is a trap. Measured on
 * this machine, on a working Claude Max 20x account, right now:
 *
 *     hasAvailableSubscription   false      <-- the obvious check
 *     organizationType           claude_max
 *     billingType                stripe_subscription
 *     organizationRateLimitTier  default_claude_max_20x
 *
 * So a naive check tells a PAYING CUSTOMER they are not subscribed, on the
 * screen that decides whether they keep the product. There is no recovering
 * from that: they either go and buy a second subscription or they close it.
 *
 * ⚠️ AND `subscriptionType` APPEARS TWICE with different values in some
 * configs — the same field name in two places, one of them `null`. Any check
 * has to say WHICH one it read. This module reads neither.
 *
 * ⚠️ THE RULE THIS MODULE IS BUILT ON, and it is this codebase's rule applied
 * to the highest-stakes screen: **there are three answers, not two.** Connected,
 * not connected, and *we cannot tell* — and "we cannot tell" must never be
 * rendered as "not connected", because the cost of those two mistakes is wildly
 * asymmetric. Telling somebody who has no subscription that we are unsure costs
 * them one extra click. Telling somebody who pays that they do not pay loses
 * them.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HOME = os.homedir();

/**
 * ⚠️ Overridable, so the tests never read the operator's real account — and so
 * this can be pointed at a fixture rather than mocked. `create` and `remove`
 * take their roots the same way.
 */
const CONFIG = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG
  || path.join(HOME, '.claude.json');

const STATE = { CONNECTED: 'connected', NONE: 'none', UNKNOWN: 'unknown' };

/**
 * The positive signals, in the order we trust them.
 *
 * ⚠️ A LIST, not a single field, because any one of them can be absent in a
 * config shape we have not seen. `authMethod` and `apiProvider` are documented
 * in the requirements as evidence and are NOT present in the current config on
 * this machine — so a check that required them would answer `none` for a live
 * Max account today. Absence of a signal is not a negative signal.
 */
const SUBSCRIBED_ORG_TYPES = ['claude_max', 'claude_pro', 'claude_team', 'claude_enterprise'];

/**
 * The plans we positively recognise as NOT subscribed.
 *
 * ⚠️ A SECOND LIST, and it exists so that `none` is something we assert rather
 * than something we fall through to. Anything named that is on neither list is
 * a plan we have not seen, and the honest answer for that is `unknown`.
 */
const UNSUBSCRIBED_ORG_TYPES = ['claude_free', 'free'];

function readConfig(file) {
  let raw;
  try {
    raw = fs.readFileSync(file || CONFIG, 'utf8');
  } catch (err) {
    // ⚠️ NO FILE is a real answer: Claude Code has never run here, so there is
    // nothing connected. Anything else — a permissions error, an unreadable
    // disk — is us being unable to look, which is not the same thing.
    if (err && err.code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unreadable', because: 'we could not read the Claude settings on this computer' };
  }
  try {
    return { kind: 'ok', data: JSON.parse(raw) };
  } catch {
    // ⚠️ "damaged", NOT "not readable as JSON". Josh, 2026-08-12: "the warnings
    // can't talk about JSON for non-technical people." He is right, and this
    // string is not internal: it reaches the first-run screen and the board's
    // connection notice, which are the two screens that decide whether somebody
    // keeps the product. A person who does not know what JSON is learns nothing
    // from this except that something is broken and they are not the audience.
    //
    // The distinction from the branch above is kept, because it is useful in
    // support even when the reader cannot name it: that one is "we could not
    // open it", this one is "we opened it and it is damaged".
    return { kind: 'unreadable', because: 'the Claude settings on this computer are damaged' };
  }
}

/**
 * @returns {{state: string, plan: string|null, because: string}}
 */
/**
 * ⚠️ `opts.configDir` points the check at ANOTHER account's settings file
 * (#248/#324: a connect flow for a second account must read the account it
 * is creating, never the global one, or a machine whose main account is
 * connected early-exits every add-another-account attempt). Absent, the
 * resolution is exactly what it always was.
 */
function check(opts) {
  /* Through accounts.configFile, the one answer: the DEFAULT account's
     record sits BESIDE its directory, and a hand-joined path here told a
     future default-dir caller that nobody had signed in (#527). */
  const file = opts && typeof opts.configDir === 'string' && opts.configDir
    ? require('./accounts').configFile(opts.configDir) : null;
  const scoped = Boolean(file);
  const got = readConfig(file);

  if (got.kind === 'absent') {
    return {
      state: STATE.NONE,
      plan: null,
      /* A scoped check reads ONE embryonic account on a machine whose
         main account may be fine; its sentences must not claim facts
         about the whole computer. */
      because: scoped ? 'nobody has signed in to this account yet.'
        : 'Claude has not been set up on this computer yet.',
    };
  }
  if (got.kind === 'unreadable') {
    return {
      state: STATE.UNKNOWN,
      plan: null,
      because: scoped ? 'we could not read this account\'s settings' : got.because,
    };
  }

  const acct = got.data && got.data.oauthAccount;
  // ⚠️ `Array.isArray` too: `typeof [] === 'object'`, so an array slipped past
  // this guard and fell all the way through to the flat negative.
  if (!acct || typeof acct !== 'object' || Array.isArray(acct)) {
    /**
     * ⚠️ UNKNOWN, NOT NONE. A config with no account block might mean nobody
     * has signed in — or it might mean a shape we have not seen. The first is
     * likely and the second is possible, and only one of them is safe to
     * assert. The screen offers to connect either way; it just does not tell
     * them they have nothing.
     */
    return {
      state: STATE.UNKNOWN,
      plan: null,
      because: scoped ? 'nobody has finished signing in to this account yet'
        : 'we could not find a Claude account in the settings on this computer',
    };
  }

  const org = typeof acct.organizationType === 'string' ? acct.organizationType : null;
  const billing = typeof acct.billingType === 'string' ? acct.billingType : null;

  if (org && SUBSCRIBED_ORG_TYPES.includes(org)) {
    return {
      state: STATE.CONNECTED,
      plan: planName(org, acct.organizationRateLimitTier),
      because: 'a Claude subscription is connected on this computer',
    };
  }

  /**
   * ⚠️ A SUBSCRIPTION WE DO NOT RECOGNISE IS NOT THE ABSENCE OF ONE — AND THAT
   * RULE WAS GATED ON THE ONE FIELD THIS MODULE DECIDED NOT TO DEPEND ON.
   *
   * The first version only reached `unknown` when `billingType` was present.
   * So an account whose `organizationType` we had never seen, with no billing
   * field in that config shape, fell straight through to "no Claude
   * subscription is connected on this computer yet" — the exact sentence the
   * header at the top of this file says loses us a paying customer, reached
   * through the exact gap the header warns about four lines further down
   * ("any one of them can be absent in a config shape we have not seen…
   * absence of a signal is not a negative signal").
   *
   * So the DEFAULT for a named-but-unrecognised plan is now `unknown`,
   * whatever `billingType` says, and `none` is asserted only for plans we
   * positively recognise as unsubscribed, or for an account naming no plan at
   * all. This list will still go out of date; it now goes out of date in the
   * direction that costs one click instead of a customer.
   */
  /**
   * ⚠️ THE ONE NEGATIVE WE ASSERT FROM AN ACCOUNT: a plan we positively
   * recognise as unsubscribed. Everything else about an account that exists
   * falls through to `unknown` below.
   */
  if (org && UNSUBSCRIBED_ORG_TYPES.includes(org)) {
    return {
      state: STATE.NONE,
      plan: null,
      because: 'no Claude subscription is connected on this computer yet.',
    };
  }

  if (org && !UNSUBSCRIBED_ORG_TYPES.includes(org)) {
    return {
      state: STATE.UNKNOWN,
      plan: null,
      because: `this computer has a Claude account we do not recognise the plan of (${org})`,
    };
  }

  /**
   * ⚠️ AN ACCOUNT IS HERE, AND IT NAMES NO PLAN. THAT IS `unknown`.
   *
   * This used to fall through to the flat negative, and it is reachable on a
   * real machine: measured, a config whose `oauthAccount` carries
   * `accountUuid` / `emailAddress` / `organizationUuid` but none of the profile
   * fields — a shape this product has already been bitten by once, since
   * `authMethod` and `apiProvider` are documented as evidence and are absent
   * here too.
   *
   * The result was that somebody SIGNED IN was shown "No Claude subscription is
   * connected yet. Get a subscription at claude.ai, then sign in to Claude on
   * this computer." That is the sentence this whole module exists to avoid, said
   * to the person least able to make sense of it.
   *
   * ⚠️ And the asymmetry was backwards: the branch above already answers
   * `unknown` for STRICTLY WEAKER evidence — no account block at all — so
   * having an account was being treated as more damning than having none.
   *
   * `none` is now asserted only where a plan is named and recognised as
   * unsubscribed, or where Claude has never run here at all (no config file),
   * which is the one genuinely negative fact available.
   */
  return {
    state: STATE.UNKNOWN,
    plan: null,
    because: 'this computer has a Claude account, but the settings do not say which plan '
      + (billing ? 'it is on' : 'it is on or whether it is paid'),
  };
}

/* ---- the live check (#881) -----------------------------------------------
   ⚠️ check()/checkCached() above answer "does the SAVED CONFIG on this
   computer look like a subscription" -- a shape-check, never a call to
   Anthropic. This answers the harder, truer question: does the held token
   actually still work. Built on `claude auth status --json`, Anthropic's
   own first-party command for this -- not a hand-rolled HTTP call against
   an undocumented endpoint, and not Keychain access from this codebase
   (the real OAuth token lives in macOS Keychain, `Claude Code-credentials`,
   never in the file check() reads; `claude auth status` already owns
   reading it safely, so this module does not need to).

   🔑 SCOPED THE SAME WAY check() IS: CLAUDE_CONFIG_DIR is the env var
   engine/accounts.js already documents as selecting which account a
   Claude Code process reads -- so a per-account live check reuses an
   existing seam rather than inventing new attribution logic.

   🛑 NEVER CALLED FROM THE 5-SECOND STATUS TICK. Traced every caller of
   accounts.list() (which is what would feed a live check into that tick)
   before writing this: server.js's board-status poll reads accounts.list()
   once per tick specifically to AVOID paying a cost "the five-second poll
   would pay forever" for a plain file stat -- a live subprocess call
   there, once per account, forever, would be exactly that anti-pattern,
   worse. This is wired ONLY into the on-demand GET /api/accounts route
   (accounts.listLive()), which every caller in web/index.html fires on a
   deliberate action (opening Settings > Accounts, adding an account), never
   a poll loop. */
let runner = null;
/** Tests only: inject a fake `claude auth status` runner. Own seam, not
    shared with connect.js's `run()` -- see the plan for why (each
    external-I/O boundary in this codebase gets its own independently
    controllable seam, matching tokendoor.js's and githubdevice.js's
    per-module `fetcher`). Pass null to restore the real subprocess call. */
function setRunner(fn) { runner = typeof fn === 'function' ? fn : null; }

/**
 * Where Claude Code lives. ONE definition, in engine/runners.js.
 *
 * ⚠️ THIS USED TO BE A THIRD COPY. `engine/runners.js`, `engine/connect.js`
 * and `engine/subscription.js` each spelled out
 * `AGENT_WORKFORCE_CLAUDE_BIN || ~/.local/bin/claude`, and when #979 gave
 * the resolver an AGENT_WORKFORCE_HOME rung the copies silently disagreed
 * with it about exactly that rung -- the drift pair the resolver exists to
 * end, one file over. Required lazily so the module graph stays acyclic.
 */
function claudeBinPath() {
  return require('./runners').resolveBin('claude').bin;
}

function runAuthStatus(env) {
  if (runner) return Promise.resolve(runner(env));
  return new Promise((resolve) => {
    execFile(claudeBinPath(), ['auth', 'status', '--json'], { env, timeout: 8000 }, (err, stdout) => {
      // ⚠️ `err` IS CARRIED THROUGH, NOT DISCARDED, but it is not treated as
      // failure by itself: `claude auth status` exits 1 for a genuine,
      // well-formed "not logged in" answer (measured) -- so an exit-code
      // error with valid JSON on stdout is not a real failure. checkLive()
      // below only consults `err` when stdout could NOT be parsed into a
      // usable answer, so a REAL failure (a missing binary, a timeout) gets
      // its own honest message instead of being folded into the generic
      // "could not make sense of the answer" one alongside a clean negative.
      resolve({ stdout: String(stdout || ''), err: err || null });
    });
  });
}

/**
 * `check()`'s file-read answer, but confirmed live with Anthropic.
 *
 * @param {{configDir?: string}} [opts] same contract as check()'s configDir.
 * @returns {Promise<{state: string, plan: string|null, because: string, checkedLive: true}>}
 */
async function checkLive(opts) {
  const configDir = opts && typeof opts.configDir === 'string' && opts.configDir ? opts.configDir : null;
  // ⚠️ NO configDir MEANS "the true default account", NOT "whatever
  // CLAUDE_CONFIG_DIR this process happens to have ambiently" -- this
  // agent's OWN session runs under a real CLAUDE_CONFIG_DIR (a
  // Kosmos-managed multi-account machine), which is exactly the kind of
  // ambient value that would otherwise leak into a caller who explicitly
  // asked for the unscoped default. check() never has this problem (it
  // reads a fixed CONFIG path derived only from AGENT_WORKFORCE_CLAUDE_CONFIG,
  // never CLAUDE_CONFIG_DIR); checkLive() matches that guarantee by
  // deleting the key rather than trusting it to be unset.
  const env = { ...process.env };
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  let result;
  try {
    result = await runAuthStatus(env);
  } catch {
    // ⚠️ NO RAW err.message HERE. Caught in challenge-loop iteration 2: this
    // module's own header rule ("the warnings can't talk about JSON for
    // non-technical people") applies to every because string, and a raw
    // subprocess error can carry anything -- a stack trace, a path, an
    // errno name. Unreachable from the real execFile path today (it
    // resolves, never rejects; only an injected test runner can throw),
    // but the sentence still has to be hand-written for the day something
    // does reach it.
    return {
      state: STATE.UNKNOWN, plan: null, checkedLive: true,
      because: 'we could not reach Claude Code to check whether this account is signed in',
    };
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { parsed = null; }
  // ⚠️ THE ONLY WAY IN IS A REAL BOOLEAN `loggedIn`. Caught in challenge-loop
  // iteration 1, reproduced directly: the first version treated anything
  // OTHER than `loggedIn === true` as NONE -- so a missing `loggedIn` key,
  // `null`, or any future schema change that still parses as valid JSON
  // would confidently tell a possibly-signed-in account "Anthropic says
  // this account is not signed in". `check()` right above this function is
  // built entirely around the opposite discipline (assert NONE only from a
  // POSITIVELY recognised negative, default everything else to UNKNOWN);
  // this now matches it exactly.
  if (!parsed || typeof parsed !== 'object' || typeof parsed.loggedIn !== 'boolean') {
    // A real subprocess failure (missing binary, timeout) earns its own
    // honest message instead of the generic "could not make sense" one --
    // only reached here, never for `claude auth status`'s clean "not
    // logged in" answer, which is exit 1 with well-formed JSON and is
    // handled by the boolean branch below, not this one.
    if (result.err) {
      // ⚠️ `killed === true` ONLY, NOT `code === 'ETIMEDOUT'`. Verified
      // against Node's own documented execFile behavior (challenge-loop
      // iteration 2 caught the first version asserting a code Node never
      // actually sets here): a timeout kill sets `killed: true` and
      // `signal` (SIGTERM by default), never `error.code = 'ETIMEDOUT'`
      // -- that string is an errno convention from other subsystems this
      // path does not go through.
      const because = result.err.code === 'ENOENT'
        ? 'we could not find Claude Code on this computer to check with'
        : result.err.killed === true
          ? 'Claude Code took too long to answer whether this account is signed in'
          : 'we asked Claude Code whether this account is signed in and it did not answer';
      return { state: STATE.UNKNOWN, plan: null, checkedLive: true, because };
    }
    return {
      state: STATE.UNKNOWN, plan: null, checkedLive: true,
      because: 'we asked Claude Code whether this account is signed in and could not make sense of the answer',
    };
  }
  if (parsed.loggedIn === true) {
    // ⚠️ `plan: null`, DELIBERATELY, NOT A GUESSED MAPPING. `claude auth
    // status`'s `subscriptionType` ("max") is a different vocabulary from
    // check()'s `organizationType` ("claude_max") that planName() expects
    // -- not verified to correspond 1:1 across every plan, and nothing
    // that currently calls checkLive() displays this field anyway.
    return {
      state: STATE.CONNECTED, plan: null, checkedLive: true,
      because: 'Anthropic confirmed this account is signed in',
    };
  }
  // Only reached when parsed.loggedIn is the literal boolean false --
  // guarded by the typeof check above, so this is a positively recognised
  // negative, never a guess.
  return {
    state: STATE.NONE, plan: null, checkedLive: true,
    because: 'Anthropic says this account is not signed in',
  };
}

/** What to call the plan on screen. Never a raw enum. */
function planName(org, tier) {
  const base = {
    claude_max: 'Claude Max',
    claude_pro: 'Claude Pro',
    claude_team: 'Claude Team',
    claude_enterprise: 'Claude Enterprise',
  }[org] || null;
  if (!base) return null;
  // `default_claude_max_20x` -> "20x". Cosmetic, and skipped rather than
  // guessed when the tier is a shape we do not recognise.
  const m = typeof tier === 'string' ? tier.match(/_(\d+x)$/) : null;
  return m ? `${base} ${m[1]}` : base;
}

/* ---- the cached read, for the status tick -------------------------------
   ⚠️ THIS EXISTS FOR A MEASURED REASON, NOT A SUSPECTED ONE. `check()` parses
   the Claude config, which is 95,152 bytes on the machine this was written on,
   and the board asks for status every 5 seconds. That is twelve 95KB parses a
   minute, forever, to answer a question whose answer changes when somebody logs
   in or out. The README calls that class of work "the difference between a page
   that idles cool and one that spins a fan".

   ⚠️ AND THIS IS THE LEAST TRUSTWORTHY CODE IN THE FEATURE, so read its failure
   mode before changing it. A stale cache here does not merely serve an old
   number: it would keep reporting `connected` AFTER the connection broke, which
   is precisely the case this whole feature was built to catch. The cache lying
   is worse than the cache not existing.

   So the key is deliberately paranoid. It is not just mtime:

     - `mtimeMs` catches an edit,
     - `size` catches an edit that somehow lands on the same millisecond,
     - `ino` catches an ATOMIC REPLACE, which is how a lot of tools write config
       (write a temp file, rename over the target). That leaves mtime and size
       plausible-looking on a brand new file, and the inode is what gives it
       away.

   A failed stat is a KEY, not an error. `missing:ENOENT` is a different key
   from any real file, so a deleted config invalidates rather than sticking on
   the last good answer. Same for a permissions change. That is the property
   that stops this from lying.

   Known and accepted: a filesystem with coarse mtime granularity could hide an
   edit that also preserved size AND inode. Rewriting a JSON config in place,
   within one mtime tick, to the same byte length, is not a thing that happens
   to this file. Documented rather than defended against. */
let cached = null;      // { key, verdict }

function statKey() {
  try {
    const st = fs.statSync(CONFIG);
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch (err) {
    return `missing:${(err && err.code) || 'ERR'}`;
  }
}

/**
 * `check()`, but it only re-reads the file when the file has actually changed.
 * Safe to call on every status tick.
 *
 * @returns {{state: string, plan: string|null, because: string}}
 */
function checkCached() {
  const key = statKey();
  if (cached && cached.key === key) return cached.verdict;
  const verdict = check();
  cached = { key, verdict };
  return verdict;
}

/** Tests only: drop the memo so a case can start from a known state. */
function resetCache() { cached = null; }

module.exports = {
  check, checkCached, resetCache, planName, STATE, CONFIG_PATH: CONFIG,
  checkLive, setRunner,
};
