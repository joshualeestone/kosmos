'use strict';

/*
 * #1704 slice 2b: apply the ACTIVE world's data-root env BEFORE any other engine
 * module is required.
 *
 * 🛑 WHY THIS EXISTS, AND WHY IT CANNOT WAIT FOR start().
 * ~26 engine modules capture the data root at REQUIRE time -- `const BASE =
 * store.ROOT` (commitments, you, policy, limits, remote, notify, ping, forget,
 * engmode, heartbeat-setting, autoupdate) and, the shape the first survey missed,
 * `const DIR = path.join(store.ROOT, 'x')` (a11ystatus, activity, liveness,
 * disruption, attachments, messages, usage, firstrun, sendertoken, discover,
 * cloudflare, githubdevice, tokendoor, remove, selfreport). `store.ROOT` is a live
 * getter, but a plain `const` reads it ONCE, at module load, and every data-file
 * path is then built from that frozen value.
 *
 * server.js requires all of those at its top level, BEFORE start() runs. slice 2a
 * applied the active world's env INSIDE start() (believing the #1443 invariant --
 * "roots are per-call" -- held fleet-wide; it does not, for these ~26). So on a
 * board that boots into a NAMED world, the frozen modules keep serving the DEFAULT
 * world's you.json / policy.json / commitments/ / limits.json / ... while the rest
 * of the board serves the named world: a systemic cross-world data BLEED.
 *
 * 2a's envOverridesFor overrides the whole data root (AGENT_WORKFORCE_DATA /
 * _PROJECTS / _WORKERS), so the design intent is wholesale per-world isolation --
 * every one of those frozen reads is a bug. Setting the env HERE, before server.js
 * requires anything, makes every freeze (present AND future) capture the correct
 * active-world root in ONE place, rather than lazifying 26 modules and re-doing it
 * for every module added later.
 *
 * 🔑 REQUIRE-TIME SAFETY: NO WRITE ON THE DEFAULT-WORLD / TEST PATH.
 * engine/boardauth's token is provisioned at start(), NOT at require, because
 * ensureToken() WRITES a file and a bare `require('./server')` in a unit test must
 * not touch the real store. For the default world (every install today, and every
 * sandboxed test) the registry is absent, applyActiveWorldEnv is a no-op, the
 * boot-guard is skipped (activeId === DEFAULT_ID), and the env is unchanged:
 * byte-for-byte identical behaviour, no file written. So this bootstrap does not
 * violate the boardauth invariant on the paths that invariant protects.
 * ⚠️ NARROWER THAN IT USED TO BE (#2528): for a NON-default active world this
 * bootstrap now DOES write -- worldbootguard.recordAttempt (a counter file, mkdir
 * included), and the abandon path resets the pointer via worlds.setActiveWorld.
 * That write is deliberate (a boot that crashes before `listening` must still be
 * counted, and only require-time runs early enough), and it is all fail-open. The
 * only latent cost: a NON-boot `require('./server')` on a real install with a named
 * world active would accrue the counter; that context does not exist in the tree
 * today (every test is the default/sandboxed world), but a future one must not
 * assume this bootstrap is write-free.
 *
 * ⚠️ ORDERING IS THE ONE INVARIANT. This must be required by server.js before any
 * root-freezing engine module. worlds.js (and its only require, store.js) freeze
 * nothing, so requiring them here is safe. server.worldenv-order.test.js guards the
 * invariant by asserting no other `require('./engine/...')` precedes this call in
 * server.js.
 */

const worlds = require('./worlds');
const worldbootguard = require('./worldbootguard');

/* #2238: the world the LIVE board actually BOOTED into, captured at bootstrap and
   never changed for the life of the process. This is deliberately NOT a live
   registry read: POST /api/worlds/active writes the new activeWorldId into the
   registry the INSTANT it is called, but a running board keeps serving the world
   whose env was applied HERE at boot until it restarts. A world-switch reconnect
   poll must see the OLD id until the board has actually rebooted onto the new one;
   echoing the registry pointer would flip to the new id during the restart window
   and false-succeed the poll before the switch took effect. So /api/status reports
   THIS value, not worlds.activeWorld(base).id. */
let bootedWorldId = null;
/* #2528: the registry base captured at boot (world-INDEPENDENT), so the boot-guard
   can clear this world's failed-boot counter once the board is listening. Captured
   before applyActiveWorldEnv moves AGENT_WORKFORCE_DATA, so it cannot be re-derived
   from process.env afterwards. */
let bootedBase = null;
/* #2628: when this boot ABANDONS a non-default world that will not come up (the
   #2528 fallback), record which world it was, its display name, and WHEN, so the
   running board can report it via /api/status. The switcher's reconnect otherwise
   only sees the board come back on the default world and waits out its whole timeout
   with no explanation -- Josh's "the restart button errored and I am back in Kosmos 1"
   with no reason. This is null on a normal boot (a fresh process that boots a world
   successfully never sets it), so a non-null value means THIS process abandoned that
   world at `at`. The `at` timestamp lets a consumer ignore a stale abandon from an
   earlier boot (see the reconnect's at > switchStart guard). */
let abandonedWorld = null;

/*
 * Capture the pre-override registry base from the ORIGINAL env, then apply the
 * active world's overrides in place. Returns the base (the world-INDEPENDENT
 * registry location, which the /api/worlds routes need) or null on a broken login
 * env -- in which case the board boots as the default world, unchanged. Fail-open:
 * a broken/absent registry can never stop the board booting.
 */
function bootstrapWorldEnv(env = process.env) {
  try {
    const base = worlds.baseRoot(env); // MUST be captured before the override moves it
    bootedBase = base;
    // #2238: capture the booted world id at the SAME registry state applyActiveWorldEnv
    // reads, BEFORE any later setActiveWorld flips the pointer. applyActiveWorldEnv
    // itself reads activeWorld(base) to build the overrides, so this is consistent.
    const activeId = worlds.activeWorld(base).id;

    // #2528: if a non-default world is not coming up -- shouldAbandon: it has failed
    // THRESHOLD consecutive boots (a confirmed world gone bad) OR it has never served
    // and just failed a boot (#2528 fast-follow: the never-served fast path) -- abandon
    // it and boot the DEFAULT world instead, so a dead world can never lock the user out
    // permanently. Reset the pointer to default so the switcher and the board agree, and
    // clear the counter so a later retry of that world starts fresh (a transient failure
    // should not brand it dead forever).
    if (activeId !== worlds.DEFAULT_ID && worldbootguard.shouldAbandon(base, activeId)) {
      console.error('#2528: world "' + activeId + '" is not coming up (never served, or a '
        + 'confirmed world that failed repeatedly); falling back to the default world.');
      // #2628: capture the abandoned world's display name BEFORE setActiveWorld flips the
      // pointer to default (after which activeWorld(base) would name the default world).
      // Fail-open: if the name lookup throws, fall back to the id so the signal still fires.
      let abandonedName = activeId;
      try { abandonedName = worlds.activeWorld(base).name || activeId; } catch (_) { /* keep id */ }
      abandonedWorld = { id: activeId, name: abandonedName, at: Date.now() };
      let didReset = false;
      try { worlds.setActiveWorld(base, worlds.DEFAULT_ID); didReset = true; }
      catch (_) { /* fail-open: the default-env return below still lands on default THIS boot */ }
      // Clear the failed-boot counter ONLY if the pointer actually reset. If the registry
      // is unwritable, keep it >= its abandon level so EVERY subsequent boot falls back,
      // rather than re-accruing before recovering (#2528 iter-1). The `confirmed` marker is
      // set-once and intentionally NOT cleared: a world that once served stays known-good,
      // so a deliberate re-switch to it gets THRESHOLD tries again (on a fresh count).
      if (didReset) worldbootguard.clear(base, activeId);
      bootedWorldId = worlds.DEFAULT_ID;
      return base; // default world: no override applied
    }

    // Record this boot attempt for a non-default world BEFORE applying its env, so a
    // boot that crashes before the board serves still counted. The board clears it
    // the instant it is listening (server.js), so a healthy world's count returns to
    // zero every boot and never approaches the threshold.
    if (activeId !== worlds.DEFAULT_ID) worldbootguard.recordAttempt(base, activeId);

    bootedWorldId = activeId;
    const applied = worlds.applyActiveWorldEnv(env, base);
    if (Object.keys(applied).length) {
      // Diagnostic -> stderr, so it never pollutes anything parsing stdout.
      console.error('#1704: booting into a named world; data roots:', applied);
    }
    return base;
  } catch (_e) {
    // legacy / broken env -> the board boots as the DEFAULT world, so that is the
    // world it booted into (fail-open, matching the base=null return).
    bootedWorldId = worlds.DEFAULT_ID;
    bootedBase = null;
    return null;
  }
}

/* #2238: the world the running board booted into (captured above at boot, never a
   live registry re-read). null only if bootstrapWorldEnv was never called (e.g. a
   unit test that requires this module without booting) -- callers treat null as
   "unknown", not as the default. */
function bootedWorld() { return bootedWorldId; }

/* #2528: the registry base the running board booted from, so server.js can clear
   this world's failed-boot counter once the board is listening. null if
   bootstrapWorldEnv was never called or hit the broken-env fail-open path. */
function bootedBaseDir() { return bootedBase; }

/* #2628: the world this boot abandoned (id, display name, and the ms timestamp of the
   abandon), or null on a normal boot. /api/status surfaces it so the switcher can tell
   the user "X could not start" instead of silently landing them on the default world.
   The timestamp is included so a consumer can distinguish THIS switch's abandon from a
   stale one recorded on an earlier boot. */
function lastAbandonedWorld() { return abandonedWorld; }

module.exports = { bootstrapWorldEnv, bootedWorld, bootedBaseDir, lastAbandonedWorld };
