---
pre_challenge: true
method: challenge-loop
branch: notify-default-2020
diff_hash: 01ab064ce69cc08c27f18bad2a4bd80b84555097bad7d0320420d0a4bfad29ee
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T13:47:05Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 6 (2 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 1 NIT)
**Fixed:** 5 | **Deferred:** 3 (2 no-action historical/scoped + 1 carded) | **Asked:** 0

Change (#2020 step 3): flip the `engine/notify.js` telemetry-send default OFF -> ON
for a never-asked machine (Josh 2026-09-03 "on, and they can turn it off"),
mirroring `engine/ping.js`, and carry the flip through every surface.

### Iteration 1
**New:** 2 BLOCKERs, 2 WARNINGs.
- [BLOCKER] web/index.html notify-row copy still "Off by default" while the engine now sends by default (dishonest consent) --> FIXED (828a4b26): copy -> "On by default; this switch turns it off" + row/cross-ref comments.
- [BLOCKER] docs/browser-checks/render-optout-403-2020.js DEFAULT_ON['notify-toggle'] = false -> fails after the flip AND its copy-vs-default guard skipped notify --> FIXED (828a4b26): set true; guard now covers notify.
- [WARNING] server.test.js stale "notify stays OFF" comment --> FIXED (828a4b26).
- [WARNING] no test pins the unreadable->OFF safety arm (elevated by the flip) --> FIXED (828a4b26): added the safety-arm test (malformed/array/unreadable -> {on:false,ok:false}) with a never-asked-ON discriminating control. Surfaced a real edge: `typeof [] === 'object'` let a JSON-array pref fall through to the ON default -> added `Array.isArray` to notify.read()'s reject (a genuine fail-safe fix).

### Iteration 2
**New:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT. (Iter-1 blockers all confirmed resolved.)
- [CONVENTION] engine/notify.test.js:3 module docstring still "off by default" --> FIXED (b58239b1).
- [WARNING] engine/ping.js has the identical array quirk (unfixed) --> DEFERRED with a tracked card #2401 (reviewer judged deferral "defensible"; ping is lower-privacy, event-only, one-shot, additionally gated). Scoped out of this "land it quick" PR; #2401 closes the mirror gap.
- [NIT] historical plan files still say notify OFF --> DEFERRED: frozen records, drive no code/test, out of live scope.
**Converged** -- no new BLOCKER; the CONVENTION fixed, the WARNING deferred+carded, the NIT no-action.

### Final Ledger
| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html | notify copy said "Off by default" | FIXED | 828a4b26 |
| 2 | 1 | BLOCKER | render-optout-403-2020.js | DEFAULT_ON notify false | FIXED | 828a4b26 |
| 3 | 1 | WARNING | server.test.js | stale "notify OFF" comment | FIXED | 828a4b26 |
| 4 | 1 | WARNING | notify.test.js | unreadable->OFF arm untested (+ array quirk) | FIXED | 828a4b26 (Array.isArray + safety test) |
| 5 | 2 | CONVENTION | notify.test.js:3 | stale module docstring | FIXED | b58239b1 |
| 6 | 2 | WARNING | ping.js | identical array quirk | DEFERRED | carded #2401 |

### Strengths
- Engine flip correct on all four arms and mirrors ping.read() exactly; the Array.isArray addition is a real correctness fix, not tidiness.
- The safety-arm test is the standout: pins malformed/array prefs to OFF, then removes the file and asserts ON as a DISCRIMINATING control (proving OFF is the fail-safe, not the default).
- Consistency holds across every live surface (engine default, web copy, browser-check DEFAULT_ON map + copy guard, server round-trip, comments); the browser-check is behaviour-measured GREEN against a live board (notify reads ON, copy not "Off by default", 403-safe reads). Disclosure copy honest against the exact payload field set (pinned by a test so copy and payload cannot silently diverge).
- Privacy/consent: default-ON is defensible - payload is event-metadata only (never the words), the opt-out switch is present + 403-safe, and the relay does not yet exist (inert today, correct-by-default when it lands).

### Follow-up (carded)
- #2401: the parallel ping.js Array.isArray fail-safe fix.
