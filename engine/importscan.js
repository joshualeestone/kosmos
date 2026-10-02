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

   THE FIX. Keep the last COMPLETE scan for keepMs as well, and let membership use it only when the
   fresh scan is partial. Membership still means "a path our own scanner returned": the request's path
   is never trusted, and the add route's read-time guards (lstat, O_NOFOLLOW, regular file, size cap)
   are unchanged and still run. A fresh COMPLETE scan that lacks the file is believed (the file is
   gone), whatever an older scan said. */

function createImportScan({ scan, now, cacheMs, keepMs }) {
  let cache = { at: 0, result: null };      // the complete scan served to callers for cacheMs
  let complete = { at: 0, result: null };   // the last complete scan, kept for keepMs (membership only)

  function get() {
    const t = now();
    if (cache.result && t - cache.at < cacheMs) return cache.result;
    let out = null;
    try {
      out = scan();
      /* #3/#2125: a PARTIAL result (scanning:true, the hatch not answered yet) is never cached, so the
         front-end's retry re-runs the scan and picks up the hatch's answer. */
      if (out && !out.scanning) { cache = { at: t, result: out }; complete = { at: t, result: out }; }
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

  /* Whether `file` is one this computer's scan offered. A scan that cannot run, and an empty or
     non-string file, are not members. */
  function known(file) {
    if (typeof file !== 'string' || !file) return false;
    const fresh = get();
    if (offers(fresh, file)) return true;
    // Only a PARTIAL scan falls back. A complete scan without the file is believed (it is gone), and a
    // scan that could not run at all refuses, as it always has.
    if (!fresh || !fresh.scanning) return false;
    return !!complete.result && now() - complete.at < keepMs && offers(complete.result, file);
  }

  return { get, warm, known };
}

module.exports = { createImportScan };
