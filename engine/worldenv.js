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
 * 🔑 READ-ONLY, WHICH IS WHY REQUIRE-TIME IS SAFE HERE.
 * engine/boardauth's token is provisioned at start(), NOT at require, because
 * ensureToken() WRITES a file and a bare `require('./server')` in a unit test must
 * not touch the real store. This bootstrap only READS the registry and mutates the
 * env object -- it never writes a file, never mkdirs -- so it does not violate that
 * invariant. For the default world (every install today, and every sandboxed test)
 * the registry is absent, applyActiveWorldEnv is a no-op, and the env is unchanged:
 * byte-for-byte identical behaviour.
 *
 * ⚠️ ORDERING IS THE ONE INVARIANT. This must be required by server.js before any
 * root-freezing engine module. worlds.js (and its only require, store.js) freeze
 * nothing, so requiring them here is safe. server.worldenv-order.test.js guards the
 * invariant by asserting no other `require('./engine/...')` precedes this call in
 * server.js.
 */

const worlds = require('./worlds');

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
    // #2238: capture the booted world id at the SAME registry state applyActiveWorldEnv
    // reads, BEFORE any later setActiveWorld flips the pointer. applyActiveWorldEnv
    // itself reads activeWorld(base) to build the overrides, so this is consistent.
    bootedWorldId = worlds.activeWorld(base).id;
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
    return null;
  }
}

/* #2238: the world the running board booted into (captured above at boot, never a
   live registry re-read). null only if bootstrapWorldEnv was never called (e.g. a
   unit test that requires this module without booting) -- callers treat null as
   "unknown", not as the default. */
function bootedWorld() { return bootedWorldId; }

module.exports = { bootstrapWorldEnv, bootedWorld };
