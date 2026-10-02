# kosmos#2461: "Add to Kosmos" on a found agent file says "not one we found to import"

## Cause (measured from source, reproduced in a unit test)
- The import panel lists `/api/scan-import`; its Add posts the file to `/api/agent-import-file`, which re-checks
  membership against `getImportScan()` (one population; the card's cause 2 does not hold).
- Files in Downloads, Documents and Desktop come from the app's scan hatch, whose answer is CONSUMED on read
  (engine/discover.js `defaultTccScan`). The complete scan was cached for SCAN_CACHE_MS = 30 s only.
- An Add more than 30 s after the list painted re-scans; the hatch must be asked again, so that scan is
  PARTIAL (`scanning:true`, none of those folders' rows) and the offered file fails membership. That is the
  card's cause 1. Josh's test files were loose files a person downloads, the exact population affected.
- WRONG in the first version (review 1): first-run is affected too. Its agent FOLDER rows use
  `/api/connect-agent`, but its loose-FILE rows (`frPaintScan` -> `foundImportRowsHtml`) go through the same
  `.fr-importgo` handler, `addImportedInPlace`, and this route.
- A SECOND path (review 1): the next Add, more than about 30 s after the first, finds the hatch's new answer
  stale and its request given up, so discover returns a scan marked complete with `bounded.tccUnavailable`
  and no rows from those folders. A scan cut off at MAX_IMPORTABLE (`bounded.importable`) can also lack a
  file that is still there. The first version trusted both and refused.

## Change
- `engine/importscan.js` (new): the import scan's cache plus `known(file)`. Same 30 s cache. It remembers every
  file any scan OFFERED (partial, limited or full), at most 5,000, oldest dropped first, with NO time limit
  (review 2). A FULL scan (complete; every folder reached, no tccUnavailable; not cut off, no
  bounded.importable; visited > 0) forgets every remembered file it does not offer. A file is a member if
  the fresh scan offers it or it is still remembered.
- `server.js`: getImportScan, the dismiss snapshot (warm cache only) and the add route use it.
- Unchanged: a request's path is never trusted (membership is still "a path our own scanner returned");
  the read-time guards (lstat, O_NOFOLLOW|O_NONBLOCK, regular file, size cap) still run on every add.

## Decided, and rejected
- Rejected: a longer cache. It would also delay a newly downloaded file appearing in the list, and it
  does not help a re-scan that is partial.
- Rejected: keeping the hatch result file instead of consuming it. Consuming it is what stops a later,
  unrelated session from reading an old answer (discover.js), and that is a different guarantee.
- Only a FULL scan that lacks the file proves it gone. A deleted file not yet seen missing by a full scan
  passes membership and is then refused by the read-time guards (the file is not there), with the read error.
- Rejected (review 2): a 15 min keep window. The panel never re-fetches after it paints, so a list left open
  longer refused again, and the window bought nothing: every add re-runs the read guards.
- Accepted residuals, stated: (1) the native hatch does not flag a protected folder it failed to read, so
  such a scan counts as full and forgets that folder's offers (fixing it is a native-app change); (2) first-run
  rows painted from the AUTO scan (/api/scan-agents, before file access is granted) are not remembered; they
  are normally in the import scan too, except a Gemini file squeezed past MAX_IMPORTABLE by over 60
  protected-folder rows (that scan is capped, so the file would be refused).
  A scan that throws refuses, as before.
- SPLIT: the card's second acceptance line (type a name for a nameless file while adding) is a UI change
  needing a browser check. Today a nameless file gets an honest message pointing to Create an agent.
  Follow-up card, not this PR.

## Weakest premise
That Josh's two failures were one of these two timing paths (first Add after 30 s; a later Add after the
hatch gave up). I claimed in the first version that timing was the only way, and review 1 found a second
path, so this claim has already been wrong once. What would change my mind: the refusal within 30 s of the
list painting, which this change would not fix.

## Tests
- engine/importscan-2461.test.js (15; review 1 added the second-add, gave-up, capped and isFull cases; review 2
  added the lunch case, the prune, the walked-nothing scan, and isFull on REAL discover.scan results): the reported case (offered, Add at 45 s, partial re-scan) is
  accepted; inside the cache window there is no new scan; a fresh complete scan without the file refuses;
  a failed scan refuses; a list left open for hours still adds (no time limit); a path no scan returned is never a member; a
  partial scan is never cached or remembered; the add route uses importScan.known (source pin).
- 8 sabotages, each red by rc: no memory (the original bug), trust any complete scan (the review-1 bug),
  gave-up counts as full, capped counts as full, walked-nothing counts as full, a full scan does not prune,
  a failed scan falls back, route on the bare scan. (A ninth, "full scan not believed" in known(), stayed
  green: that check was redundant with the prune, so it was removed rather than kept as a line that
  cannot fail.)
- server.agent-import-1652.test.js 18/18 unchanged.

## Review 1 (opus, blind, 2026-10-01 22:22): 1 blocker, 3 warnings, 2 nits, all taken
Blocker: a second Add after the hatch gave up was refused (redesigned: remember every offer; only a FULL scan
proves a file gone). Warnings: first-run loose-file rows are affected (plan corrected); a complete-but-limited
scan was believed (isFull); the tests only covered the case that already worked (gave-up, capped, two-add
fixtures). Nits: the route's security comment states the 15 min window; doubled brackets in a comment fixed.

## Review 2 (opus, blind, 2026-10-01 22:28): 0 blockers, 4 warnings, 3 nits
Taken: no time limit (lunch case); server comments match the rule; isFull tested on real discover.scan
results; a full scan prunes (the proof is kept); a walked-nothing scan is not full. Stated, not fixed: the
hatch's unflagged read failure (native-app change) and auto-scan first-run rows (see residuals above).

## Review 3 (opus, blind, whole diff, 2026-10-01 22:32): 0 blockers, 0 warnings, 3 nits, all taken. CONVERGED.
The gave-up and capped fixtures now carry visited, so they test their own flags (each flag's sabotage now
fails 3 tests, not only the real-scan one); stale "keep window" wording removed; the remembered Map stores
`true`, as only presence and order matter. Unit 15/15. Converged at iteration 3. Next: full validation, proof
file, PR.
