# kosmos#2461: "Add to Kosmos" on a found agent file says "not one we found to import"

## Cause (measured from source, reproduced in a unit test)
- The import panel lists `/api/scan-import`; its Add posts the file to `/api/agent-import-file`, which re-checks
  membership against `getImportScan()` (one population; the card's cause 2 does not hold).
- Files in Downloads, Documents and Desktop come from the app's scan hatch, whose answer is CONSUMED on read
  (engine/discover.js `defaultTccScan`). The complete scan was cached for SCAN_CACHE_MS = 30 s only.
- An Add more than 30 s after the list painted re-scans; the hatch must be asked again, so that scan is
  PARTIAL (`scanning:true`, none of those folders' rows) and the offered file fails membership. That is the
  card's cause 1. Josh's test files were loose files a person downloads, the exact population affected.
- The first-run "Add to Kosmos" is a different flow (`/api/connect-agent {dir, name}`) and never shows this
  message.

## Change
- `engine/importscan.js` (new): the import scan's cache plus `known(file)`. Same 30 s cache; it ALSO keeps the
  last COMPLETE scan for 15 min (IMPORT_OFFER_KEEP_MS), consulted only when the fresh scan is PARTIAL.
- `server.js`: getImportScan, the dismiss snapshot (warm cache only) and the add route use it.
- Unchanged: a request's path is never trusted (membership is still "a path our own scanner returned");
  the read-time guards (lstat, O_NOFOLLOW|O_NONBLOCK, regular file, size cap) still run on every add.

## Decided, and rejected
- Rejected: a longer cache. It would also delay a newly downloaded file appearing in the list, and it
  does not help a re-scan that is partial.
- Rejected: keeping the hatch result file instead of consuming it. Consuming it is what stops a later,
  unrelated session from reading an old answer (discover.js), and that is a different guarantee.
- A fresh COMPLETE scan that lacks the file is believed, so a deleted file is never brought back by an
  old offer. A scan that throws refuses, as before.
- SPLIT: the card's second acceptance line (type a name for a nameless file while adding) is a UI change
  needing a browser check. Today a nameless file gets an honest message pointing to Create an agent.
  Follow-up card, not this PR.

## Weakest premise
That Josh's two failures were this timing path. The source makes it the only way this refusal reaches a
file the list offered, but nobody watched his clock. What would change my mind: the refusal within 30 s
of the list painting, which this change would not fix.

## Tests
- engine/importscan-2461.test.js (8): the reported case (offered, Add at 45 s, partial re-scan) is
  accepted; inside the cache window there is no new scan; a fresh complete scan without the file refuses;
  a failed scan refuses; the 15 min keep window expires; a path no scan returned is never a member; a
  partial scan is never cached or remembered; the add route uses importScan.known (source pin).
- 5 sabotages, each red by rc: no fallback (the old logic), complete scan not believed, no keep window,
  route on the bare scan, partial cached.
- server.agent-import-1652.test.js 18/18 unchanged.
