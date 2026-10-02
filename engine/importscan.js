'use strict';
/* kosmos#2461: the on-demand import scan's cache, and the membership check POST /api/agent-import-file
   makes against it, in one place with the scan and the clock passed in so the order of events can be
   tested.

   THE DEFECT. A file in Downloads, Documents or Desktop is found through the app's scan hatch, whose
   answer is CONSUMED when read (engine/discover.js defaultTccScan), and the complete scan is cached for
   only SCAN_CACHE_MS (30 s). A person who presses "Add to Kosmos" more than 30 s after the list painted
   makes the add route scan again; that scan has to ask the hatch again, so it comes back PARTIAL
   (scanning:true, none of those folders' rows), and the file the list offered is "not one we found on
   this computer to import". Josh hit it on 0.6.47 (2026-09-07).

   A SECOND path to the same refusal (review 1): the next Add, more than about 30 s after the first, finds
   the hatch's new answer already stale and its request given up, so discover returns a scan marked
   COMPLETE (scanning:false) but with bounded.tccUnavailable and no rows from those folders. A scan cut off
   at MAX_IMPORTABLE (bounded.importable) can likewise lack a file that is still there. The panel never
   re-fetches the list after it paints, so the file is still on screen when it is refused.

   THE FIX. Remember every file a scan OFFERED (partial, limited or full). A file is a member if the fresh
   scan offers it, or if it was offered before and no FULL scan has since lacked it. A FULL scan (complete,
   every folder reached: no tccUnavailable, not cut off: no bounded.importable, and something walked)
   forgets every remembered file it does not offer, so it is the one thing that proves a file gone. There
   is NO time limit (review 2): the panel never re-fetches after it paints, so a list left open over lunch
   must still add, and a window buys nothing, because every add re-runs the read guards below. A scan that
   cannot run refuses, as before.
   ⚠️ isFull trusts discover's flags, and through them the native hatch: a protected folder the hatch
   could not read (contentsOfDirectory failing) is not flagged today (native-app/main.swift), so such a
   scan counts as full and forgets that folder's offers. Accepted residual, stated rather than fixed here. Membership still means
   "a path our own scanner returned": the request's path is never trusted, and the add route's read-time
   guards (lstat, O_NOFOLLOW, regular file, size cap) are unchanged and still run, so an offered file that
   has since been deleted is refused there. */

const MAX_REMEMBERED = 5000;   // offered files kept for membership; the oldest go first

/* A scan that saw everything it could have offered: only such a scan can say a file is gone. `visited` > 0
   rules out discover's walked-nothing early return (a sandbox it refuses to walk), which carries no flag. */
function isFull(result) {
  const b = (result && result.bounded) || {};
  return !!result && !result.scanning && b.tccUnavailable !== true && b.importable !== true
    && typeof b.visited === 'number' && b.visited > 0;
}

function createImportScan({ scan, now, cacheMs }) {
  let cache = { at: 0, result: null };   // the complete scan served to callers for cacheMs
  const offered = new Map();             // file -> when a scan last offered it (membership only), oldest first

  function remember(result, t) {
    if (!result || !Array.isArray(result.importable)) return;
    if (isFull(result)) {                // a full scan proves gone whatever it does not offer
      const has = new Set(result.importable.map((c) => c && c.file));
      for (const f of [...offered.keys()]) if (!has.has(f)) offered.delete(f);
    }
    for (const c of result.importable) {
      if (!c || typeof c.file !== 'string' || !c.file) continue;
      offered.delete(c.file);            // re-insert, so the Map stays oldest-first
      offered.set(c.file, t);
    }
    while (offered.size > MAX_REMEMBERED) offered.delete(offered.keys().next().value);
  }

  function get() {
    const t = now();
    if (cache.result && t - cache.at < cacheMs) return cache.result;
    let out = null;
    try {
      out = scan();
      /* #3/#2125: a PARTIAL result (scanning:true, the hatch not answered yet) is never cached, so the
         front-end's retry re-runs the scan and picks up the hatch's answer. Every result's rows are
         remembered: the list paints partial rows too. */
      if (out && !out.scanning) cache = { at: t, result: out };
      remember(out, t);
    } catch { out = null; }
    return out;
  }

  /* The complete scan still inside the cache window, or null. For callers that must not start a scan
     of their own (a fresh one can raise the macOS folder prompt). */
  function warm() {
    return cache.result && now() - cache.at < cacheMs ? cache.result : null;
  }

  const offers = (result, file) => !!(result && Array.isArray(result.importable)
    && result.importable.some((c) => c && c.file === file));

  /* Whether `file` is one this computer's scan offered. */
  function known(file) {
    if (typeof file !== 'string' || !file) return false;
    const fresh = get();
    if (offers(fresh, file)) return true;
    if (!fresh) return false;            // the scan could not run: refuse, as always
    /* No separate "a full scan lacks it" check here: get() just ran remember(), which forgets everything a
       FULL scan does not offer, so `offered` already says so. */
    return offered.has(file);
  }

  return { get, warm, known };
}

module.exports = { createImportScan, isFull };
