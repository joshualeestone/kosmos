---
pre_challenge: true
method: challenge-loop
branch: adoption-disk-scan-1938
diff_hash: d4403967240765af68b4034b64412aef8b9eaf2e73504061f3b2f339cdb2175f
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T04:09:31Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 surfaced zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER, 6 WARNINGs, 1 CONVENTION, ~11 NITs, plus STRENGTHs
**Fixed:** 1 BLOCKER + 6 WARNINGs + 1 CONVENTION + 5 NITs | **Deferred:** 6 NITs | **Asked:** 0

Final validation (full `tools/run-tests.sh`) passed single-tenant on the converged HEAD,
including the browser-checks phase with `render-scan-board.js` wired into the runner.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] web/index.html paintScanBoard - board polled /api/scan-agents every 5s, each a full disk walk on the event loop --> FIXED (9cbc7c72: 30s server-side cache + invalidation)
- [WARNING] engine/discover.js scan() - found() ran twice per poll --> FIXED (same cache; scan runs at most once per TTL)
- [NIT] server.js:4029 HEAD emits a body --> DEFERRED (shared sendJson pattern across every GET|HEAD route; a HEAD fix belongs in the helper, out of scope)
- [NIT] engine/discover.js sandbox-refusal bounded:{} vs shaped --> FIXED (shaped consistently)

#### Iteration 2
**New findings:** 1 BLOCKER, 0 WARNINGs, 1 CONVENTION, 1 NIT
- [BLOCKER] engine/discover.js connect() - a nameless scan candidate (file introduces somebody but names nobody) showed a name field, but connect() refused the whole population; every nameless row was un-addable (pre-dates the scan; found().adoptable hit it too) --> FIXED (b11e9bc8: complete #1531 ruling 2(a), a typed name wins when the file introduces-but-unnamed; no-name refusal unchanged; + register-1531 test)
- [CONVENTION] .claude/plans/adoption-disk-scan-1938.md em dashes --> FIXED (removed; product strings were already clean)
- [NIT] server.js remove route does not invalidate the scan cache --> DEFERRED (removed Kosmos agents stay in found()'s records, so the scan excludes them via the found().agents dedup regardless of the cache; the four invalidated routes are the ones touching the scan's own offer population)

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] engine/discover.js connect() widened refusal too broad - a supplied name adopted-and-started ANY readable CLAUDE.md, including a non-introducing build-notes file (reachable by direct API call) --> FIXED (f2556430: re-assert INTRODUCES inside connect() + a build-notes-plus-name control)
- [WARNING] engine/discover.js scan() - a symlinked scan ROOT was dropped by lstat, hiding agents under a symlinked ~/work --> FIXED (stat-follow the curated root; children stay lstat-refused; + symlinked-root test)
- [NIT] readClaudeHead byte-vs-char comment inaccurate --> FIXED (corrected; the byte bound is deliberate so a scan of many files never allocates a whole large file)
- [NIT] scan-board Add did not tick() the grid --> FIXED (tick gate includes #scan-wrap)
- [NIT] cssId collision on identical 60-char tails --> DEFERRED (pre-existing shared helper used by adoptRowsHtml; vanishingly rare)

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] engine/discover.js scan() - case-variant roots (projects/Projects, Kosmos/kosmos) are one physical dir on a case-insensitive FS, and $HOME re-reaches a curated parent under the on-disk case, and a symlinked root can alias another; seenDirs keyed on the literal path double-listed one agent --> FIXED (dd850cb1: key seenDirs on the canonical realpath; + a symlink-alias dedup test, deterministic on any FS)
- [NIT] bounded.depth not surfaced in the "there may be more" note --> FIXED (documented as deliberate: a depth-cap hit is the normal case and would train the person to ignore the note)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** - no new actionable findings.
- [NIT] engine/discover.js found-dedup keys on the literal path while found().agents dirs are realpath'd - a duplicate offer on a symlinked-root + in-records combo --> DEFERRED (benign by the design's own "one Skip" tolerance; a full fix needs realpath-normalizing found()'s transcript-derived dirs too)
- [NIT] server.js the disk walk is synchronous on the event loop --> DEFERRED (bounded, cached to at most once per 30s, acceptable for a local single-user app)
- [NIT] web/index.html preview payload ~400KB at the 100-candidate cap re-sent per poll --> DEFERRED (localhost transport, bounded by the candidate cap, typical machine has a handful of candidates; SCAN_SIG dedup already prevents re-rendering unchanged rows)
- [NIT] found() runs twice on a scan cache miss --> DEFERRED (only on a miss, at most once per 30s, found() is bounded)

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | scan disk-walk every 5s poll | FIXED | 9cbc7c72 |
| 2 | 1 | WARNING | engine/discover.js | found() twice per poll | FIXED | 9cbc7c72 |
| 3 | 1 | NIT | server.js | HEAD emits a body | DEFERRED | shared sendJson helper |
| 4 | 1 | NIT | engine/discover.js | bounded:{} on sandbox refusal | FIXED | 9cbc7c72 |
| 5 | 2 | BLOCKER | engine/discover.js | nameless scan row un-addable | FIXED | b11e9bc8 |
| 6 | 2 | CONVENTION | plan file | em dashes | FIXED | b11e9bc8 |
| 7 | 2 | NIT | server.js | remove route no cache invalidation | DEFERRED | found() records dedup covers it |
| 8 | 3 | WARNING | engine/discover.js | connect() accepted a non-introducing file + name | FIXED | f2556430 |
| 9 | 3 | WARNING | engine/discover.js | symlinked scan root dropped | FIXED | f2556430 |
| 10 | 3 | NIT | engine/discover.js | byte-vs-char comment | FIXED | f2556430 |
| 11 | 3 | NIT | web/index.html | scan-board Add no grid refresh | FIXED | f2556430 |
| 12 | 3 | NIT | web/index.html | cssId collision | DEFERRED | pre-existing shared helper |
| 13 | 4 | WARNING | engine/discover.js | case-variant/alias roots double-list | FIXED | dd850cb1 |
| 14 | 4 | NIT | engine/discover.js | bounded.depth undisclosed | FIXED | dd850cb1 |
| 15 | 5 | NIT | engine/discover.js | found-dedup literal vs realpath | DEFERRED | benign one-Skip on symlinked-root+records |
| 16 | 5 | NIT | server.js | synchronous walk on event loop | DEFERRED | bounded + cached, local single-user |
| 17 | 5 | NIT | web/index.html | preview payload size at the cap | DEFERRED | localhost, bounded, typical small |
| 18 | 5 | NIT | server.js | found() twice on a cache miss | DEFERRED | at most once per 30s, bounded |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs deferred (non-blocking, for consideration)
- HEAD emits a body (shared sendJson helper, all GET|HEAD routes).
- remove/restore routes do not invalidate the scan cache (found()'s records dedup covers removed Kosmos agents).
- cssId collision on identical 60-char path tails (pre-existing, used by adoptRowsHtml).
- found-dedup keys on the literal path vs found()'s realpath'd dirs (benign duplicate offer on a symlinked-root + in-records combo; worthwhile consistency follow-up).
- The disk walk is synchronous on the event loop (bounded, cached, acceptable for a local single-user app).
- The preview payload can reach ~400KB at the 100-candidate cap (localhost, bounded, typical machine has a handful).
- found() runs twice on a scan cache miss (at most once per 30s).

### Strengths (across all iterations)
- The scan bounds are genuine walls, correctly layered: a curated root is stat-followed (a symlinked ~/work volume is not dropped) while every descended child and every CLAUDE.md is lstat-refused, closing the escape; depth/MAX_DIRS/MAX_CANDIDATES/READ_CAP all checked with correct boundary semantics; iterative stack (no recursion-to-death); seenDirs realpath keying collapses case-variant and symlink aliases; the sandbox refusal closes the exact hole the module family shipped six times.
- Test discipline is high: every absence assertion is backed by a positive control that can return the dangerous answer (the "sandbox is really being scanned" control, the sandbox-guard control that relies on the explicit-roots tests finding fixtures, the two connect() negative controls).
- The INTRODUCES re-check inside connect() is an engine-enforced invariant, not a trust of the caller.
- XSS is closed: esc() covers & < > ", all attributes are double-quoted, and preview content lands as textarea text so a </textarea> in a file cannot break out.
- The cache design (30s TTL, invalidation on connect/decline/undecline/disconnect, failed scans never cached, dismissed read fresh) matches its stated contract.
- The first-run frPaintFleet integration preserves every pre-#1938 ending, uses the generation guard, and shows a "Looking" state so the "Create your first agent" sentence never flashes at someone who has agents.
- The #1800 CSS guard is preserved (the new .fr-scanpreview is its own rule).
- No em dashes appear in any added product string.
</content>
