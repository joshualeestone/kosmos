---
pre_challenge: true
method: challenge-loop
branch: talk-scroll-1926
diff_hash: 00d5f2f5501da0ce07064a544bfad8782768aab633eaee7d03831e2387f3de95
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T23:32:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (plus initial + final validation)
**Converged:** Yes -- iteration 2, a full blind pass over the hardened branch, returned
zero actionable findings.
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs (all non-actionable)
**Fixed:** 2 (iteration-1 NITs applied as hardening) | **Deferred:** 0 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 0 (baseline validation)
Full suite: node --test 3810 pass / 0 fail. One red: the #1720 browser-check gate (web/
touched, no docs/browser-checks/ update). Addressed with a `Browser-check:` trailer (the
scroll-anchor behaviour is deterministically covered by the node test; a live check would
need a ~60s relative-timestamp tick or a staged mid-scroll message the gate host cannot
reliably produce, and render-room-scroll.js already covers the sibling room surface).

#### Iteration 1 (fresh blind pass)
0 BLOCKERs/WARNINGs/CONVENTIONs; 2 NITs, both APPLIED as a real hardening:
- restoreThreadAnchor now falls back to the pixel offset when the anchored message is
  hidden by the search filter (offsetHeight 0) instead of restoring to `0 - delta` and
  jumping toward the top; threadAnchor skips hidden rows when picking the anchor. Added a
  test modelling a display:none anchor.
- a one-line note that an id-less message whose `at` collides degrades to a one-row
  drift, no worse than the pixel offset.
Multiple STRENGTHs confirming the anchor math, control flow, escaping, and no dmRow-pin
regressions.

#### Iteration 2 (fresh blind pass, hardened branch)
"No issues found" (0 actionable); 3 non-actionable NITs, none changed:
- threadAnchor's hidden-row guard is defensive/redundant in a real DOM (display:none
  reports offsetTop 0, already excluded). Harmless.
- midOf (id || at) is not invariant if an optimistic just-sent row later gains a store
  id: one poll of pixel drift for that message, never a jump. Documented degradation.
- empty-mid collision is unlikely (`at` is effectively always present) and the comment
  frames the one-row drift.
Reviewer traced the hidden-anchor test with the guard removed (scrollTop would be 10,
failing the assertion) -- confirming it is load-bearing. **Converged.**

### Final validation
Full suite green on HEAD 63df0515: node --test 3811 pass / 0 fail / 0 skip; yarn
test:shell all arms pass; #1720 browser-check gate overridden (trailer); no contention.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 0 | BLOCKER (synthetic) | browser-check-gate | web/ change lacked a browser-check assertion | FIXED | Browser-check: trailer (node test is the deterministic coverage) |
| 2 | 1 | NIT | web/index.html | filter-hidden anchor could jump to ~0 | FIXED | offsetHeight-0 guard -> pixel fallback + test |
| 3 | 1 | NIT | web/index.html | at-collision degradation implicit | FIXED | one-line comment |

### Outstanding questions (ASKED)
None.

### NITs (non-actionable, iteration 2)
- threadAnchor hidden-row guard redundant-but-defensive in real DOM.
- midOf not invariant across an optimistic-send row gaining an id (one poll of pixel drift).
- empty-mid collision unlikely; comment already frames it.

### Strengths (across iterations)
- Anchor math correct (delta captured before write, restored after; negative delta ok).
- Control flow correct (floor pin first; note arm returns before restore; anchor only
  when scrolled back).
- Tests execute the REAL extracted functions with two-sided controls that return the
  dangerous answer (pixel drift; hidden-anchor jump-to-top without the guard).
- data-mid consumed only by the anchor helpers; no spurious rewrites, no pin regressions.

### Scope / follow-ups (from the plan)
- Element-anchor restore, not a full DOM reconciliation: fixes the reported jump and
  Splinter's control with a localized change; a keyed reconcile (killing any residual
  image-reload flash) is the follow-up if an image-heavy history scrolled past still
  flashes. For the reported TEXT conversation there are no images above and the restore
  is exact.
- Scoped to the talk thread (#d-dmthread); the project room (#pj-post, setLive) likely
  shares the class -- flagged for a follow-up, not widened here.
