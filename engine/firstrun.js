'use strict';

/**
 * Whether this machine has been through first run, and what first run should
 * say when it has not.
 *
 * ⚠️ "ADOPTING" YOUR EXISTING AGENTS IS NOT AN IMPORT, AND THE SCREEN MUST NOT
 * PRETEND IT IS.
 *
 * The prototype shows "We found 5 agents → Continue", which reads like a
 * migration step. It is not one. The board is built from `tmux list-panes`, so
 * every agent already on the machine is ALREADY on the board before anybody
 * clicks anything — measured: 13 agents visible on this machine, none of them
 * created by Kosmos, nothing imported.
 *
 * So the honest thing that screen does is **show somebody that we can already
 * see their fleet**. That is worth a screen — it is the moment the promise
 * "manage the agents you already use" becomes visible — but building an import
 * behind it would be building a fake step that can fail, for work that has
 * already happened.
 *
 * ⚠️ What first run therefore persists is exactly one fact: that it has been
 * seen. Not a list of adopted agents, not a migration record. One flag, so the
 * app knows whether to open on the welcome or on the board.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const status = require('./status');
const subscription = require('./subscription');
const connect = require('./connect');

const FLAG = path.join(store.ROOT, 'first-run.json');

/**
 * ⚠️ Read through the same reader the rest of the product uses, and fail the
 * same way: a flag we cannot read is NOT "they have never been here". Telling
 * a returning person they are new is a small insult; showing them onboarding
 * over their working board is a bigger one.
 */
function seen() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FLAG, 'utf8'));
    return parsed && parsed.completedAt ? { known: true, done: true, at: parsed.completedAt } : { known: true, done: false };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { known: true, done: false };
    // Unreadable: we do not know. The caller treats that as "done", because
    // the cost of re-running onboarding over somebody's working board is
    // higher than the cost of not showing it once.
    return { known: false, done: true };
  }
}

function complete() {
  fs.mkdirSync(path.dirname(FLAG), { recursive: true });
  const tmp = `${FLAG}.${process.pid}.new`;
  fs.writeFileSync(tmp, `${JSON.stringify({ completedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(tmp, FLAG);
  } catch (err) {
    // ⚠️ Take the half-written file with us. A full disk or a read-only volume
    // leaves `first-run.json.<pid>.new` sitting beside the real flag forever,
    // and the next reader of this directory has to work out which is which.
    try { fs.unlinkSync(tmp); } catch { /* it was never the point */ }
    throw err;
  }
  /**
   * ⚠️ THIS IS WEAKER THAN "we read it back and it is there", and the route
   * above it should not claim otherwise. `seen()` deliberately answers
   * `done: true` for an UNREADABLE flag -- because re-running onboarding over
   * somebody's working board is the worse mistake -- so a write that landed on
   * a file we then could not parse reports success. What this actually
   * establishes is "nothing here will make onboarding come back", which is the
   * thing the screen needs to know, and not the same sentence.
   */
  return seen().done === true;
}

/** How many agents are already here, and can we trust the answer? */
function fleet(opts) {
  try {
    const agents = status.paneRoster();
    /**
     * ⚠️ `paneRoster` cards carry `sessionName`, NOT a display name -- the name
     * a person recognises is parsed out of the agent's instruction file by
     * `readIdentity`. Mapping `.name` here returned an array of nulls, and the
     * screen would have shown "We found 4 agents" over four blank rows.
     *
     * Caught by reading the route's output rather than its status code, which
     * was 200 the whole time.
     */
    // Names ONLY when asked: each one costs a readIdentity instruction-file
    // read, and state() (every /api/first-run call, every Check again press)
    // needs the count alone -- in the 600-agent case that motivated pruning
    // the wire field, deriving-and-discarding was 600 file reads per call.
    if (!(opts && opts.withNames)) return { known: true, count: agents.length, names: [] };
    const names = agents.map((a) => {
      try { return status.readIdentity(a.sessionName).displayName || a.sessionName; }
      catch { return a.sessionName; }
    });
    // The 12-cap predates the wire field it was written for (fleetNames,
    // pruned when the fleet screen went count-only); it survives as a
    // courtesy bound for callers that do ask, not a load-bearing rule.
    return { known: true, count: agents.length, names: names.slice(0, 12) };
  } catch {
    // ⚠️ An unreachable tmux is not an empty machine. That confusion is the
    // one this codebase is built against, and here it would route somebody
    // with a working fleet down "create your first agent".
    return { known: false, count: null, names: [] };
  }
}

/**
 * What first run should show, decided in one place so the screen cannot
 * disagree with the engine about which path somebody is on.
 */
async function state() {
  const flag = seen();
  /* 🛑 checkLive, NOT check (#874). `check()` reads `oauthAccount.organizationType`
     out of a local file and returns CONNECTED whenever it names a paid plan. A
     LOGGED-OUT person still has that field, so the first screen of the product
     showed Josh's sister a green "Connected" tick while she was signed out. She
     trusted it, found Settings disagreeing, and used "add a provider" as the only
     route she had, which made a duplicate account.

     ⚠️ NOT A MISSING CAPABILITY. `subscription.checkLive()` has existed all along
     and `engine/accounts.js` already calls it, which is exactly why Settings got
     the right answer and this screen did not. Two paths, two answers, and the
     louder one was the unverified one.

     📌 COST, weighed rather than waved past. This adds one `claude auth status`
     to a route that already shells out to `tmux list-panes` through `fleet()`
     below, and Settings pays the same price on every open. `server.js:1702`'s
     five-second status tick keeps `checkCached()` and is untouched: that one IS
     a poll, and the cost note at `server.js:3211` is about `/api/found-agents`,
     not about this.

     🛑 CORRECTED (#1556): that last clause was wrong and it is fixed here rather
     than left to contradict the newer note below. `server.js:3211` explains why
     `/api/found-agents` is NOT folded into `/api/first-run`, and its "That route is
     polled" refers back to `/api/first-run`, which is THIS route. So the cost note
     IS about this one. See the block further down for which sense of "polled" it
     means: user-driven repeats, not a timer.

     ⭐ And it is what makes "Check again" mean anything. Before this, that button
     re-read the same file and returned the same wrong answer, confidently. */
  /* ⚠️ STARTED HERE, AWAITED LATER, SO THE TWO PROBES OVERLAP.
     This route already shells out twice (`claude auth status`, then tmux), and
     #1556 adds a third. Serial, that is roughly double the worst-case latency on
     a route that gates whether the onboarding overlay opens. Kicking the promise
     off before the first await costs nothing and reorders nothing else. The
     `.catch` is attached AT CREATION, so a rejection can never be unhandled while
     it sits here unawaited. */
  const willInstallSoon = connect.willInstall().catch(() => null);
  const live = await subscription.checkLive();
  /* ⚠️ THE PLAN NAME STILL COMES FROM THE FILE, AND ONLY WHEN THE LIVE CHECK
     SAID YES. `checkLive()` returns `plan: null` on purpose: `claude auth
     status` says "max" where `check()` says "claude_max", and that module
     declined to assert the two vocabularies map 1:1. But this screen renders
     `(sub.plan || 'A Claude subscription') + ' is connected'`, so taking the
     live answer alone would quietly downgrade "Claude Max is connected" to the
     generic sentence for every paying customer.

     ⇒ The two fields answer different questions and are sourced accordingly.
     WHETHER you are signed in is a claim about the world and must be verified.
     WHICH plan the local file names is a description, and it is only ever shown
     on the arm the live check already confirmed. A logged-out person never
     reaches it. */
  const sub = live.state === subscription.STATE.CONNECTED
    ? { ...live, plan: subscription.check().plan }
    : live;
  const here = fleet();

  /**
   * ⚠️ THE FORK IS ONLY OFFERED WHEN WE CAN ACTUALLY COUNT. If tmux could not
   * be asked we do not know whether they have agents, and guessing "create
   * your first one" at somebody with a running fleet is the version of this
   * mistake that looks broken.
   */
  const path_ = !here.known ? 'unknown' : (here.count > 0 ? 'adopt' : 'create');

  /* ⚠️ THE CATCH IS BELT AND BRACES, AND IT IS CURRENTLY UNREACHABLE. Say that
     plainly rather than describing a live fail-open path, because `willInstall()`
     catches on every route it has: the bin resolution sits in one try (a throw
     there returns true), the runnability check sits in that SAME try, so a throw
     is caught either way: from `require('./runners')` itself, or from
     `resolveBin('claude')`, which can throw on its own account (it derives a home
     directory and joins paths) before it ever asks whether the file is runnable.
     📌 THE OPERATIVE CLAIM: both CLAUDE rungs of `resolveBin` compute `present` with
     `isRunnable`, so every `resolveBin('claude')` enters it transitively. Measured,
     with a control. (Not all six of its return points do; two return `present: false`
     without it, which does not affect this catch.) Two earlier drafts of this
     paragraph were false in opposite directions; both are recorded in the plan.
     ⇒ The naming was never the defect. What matters for THIS catch is only that both
     throw sources sit inside the same try: the `require('./runners')` itself, and
     `resolveBin` before it ever asks about runnability (it derives a home and joins
     paths).
     📌 THIS ALSO NAMED `isRunnable` AS A THIRD THROW SOURCE. IT IS NOT ONE:
     `isRunnable` wraps its entire body in try/catch and returns false, so it cannot
     throw. Two of the three named sources were right and the third was invented.

     ⇒ THE OPERATIVE CLAIM, which is what this whole block exists to state: nothing
     after that try can reject, so the `.catch` cannot fire
     today.

     It stays because the property it defends is the one that matters (an unknown
     must never become a confident "no install needed", which costs an unannounced
     281MB download), and because a future edit inside `willInstall` could make it
     reachable. What it must NOT do is read as a guarantee the code is providing
     right now. This repo names that trap itself, in `frClaudeDownloadBytes`'s doc block in
     web/index.html (named rather than line-numbered, because a line number in a
     32k-line file drifts):
     saying a function can return null when it cannot is how a dead branch gets pinned by a
     test that can never fail for the reason it states. */
  const willInstall = await willInstallSoon;

  return {
    done: flag.done,
    // Carried so the screen can say WHY it is not offering the fork, rather
    // than silently picking one.
    fleetKnown: here.known,
    fleetCount: here.count,
    // No names on the wire: the fleet screen shows the COUNT only (Josh's
    // ruling, 2026-08-17, the 600-agent case). fleet() still derives names
    // for callers that need them; a field nothing reads is a claim nothing
    // checks.
    path: path_,
    subscription: sub,
    /**
     * 🛑 #1556: THIS SHAPE IS DICTATED BY THE READER, NOT CHOSEN.
     * `frClaudeInstallNeeded()` reads `FR.connect.willInstall`, and `FR` is
     * assigned WHOLESALE from this payload at both of its two assignment sites.
     * So the key has to be `connect` and it has to be an object, or the reader
     * sees `undefined` and fails open to asking everybody.
     *
     * ⚠️ I FIRST SHIPPED THIS FIELD ON `/api/connect`, WHERE NOTHING READS IT.
     * The route answered correctly on three boards and the screen did not change
     * by one character, because `FR` never carries `/api/connect`'s reply. This
     * file's own line above says it: "a field nothing reads is a claim nothing
     * checks." I verified the half that worked and called the card done.
     *
     * ⭐ IT BELONGS HERE FOR A SECOND REASON, NOT ONLY CORRECTNESS: `/api/connect`
     * is on a 1000ms TIMER during a live flow (`setInterval`, web/index.html), and
     * an awaited probe there stacks concurrent subprocesses. This route is not on a
     * timer: its two callers are a button (`frRecheck`) and page boot
     * (`firstRunBoot`), and it already awaits `checkLive()`.
     *
     * 📌 `server.js` calls this route "polled", meaning user-driven repeats: every
     * Check again, every repaint of the setup flow. That is a real cost note and it
     * is NOT the timer sense used above. Both are true, so this comment names which
     * one it means; the two probes above are overlapped for exactly that reason.
     *
     * `willInstallBytes` is deliberately absent: separate card, needs the
     * manifest. its only reader (`frClaudeDownloadBytes`) already handles its absence. Named, not
     * counted: an earlier draft here said "both readers" and there is exactly one,
     * which is the same count-in-a-comment defect this branch corrects elsewhere.
     */
    connect: { willInstall },
  };
}

module.exports = { state, seen, complete, fleet, FLAG };
