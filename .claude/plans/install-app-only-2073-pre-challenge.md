---
pre_challenge: true
method: challenge-loop
branch: install-app-only-2073
diff_hash: e1ed936700a1ca54cefa2ea292154b4d933251a79c05a5249e42044890ae022c
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T22:03:48Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes — iteration 6 surfaced zero BLOCKER/WARNING/CONVENTION/NIT findings and
explicitly confirmed the change genuinely converged.
**Total findings:** 21 (0 BLOCKERs, 8 WARNINGs, 4 CONVENTIONs, 9 NITs)
**Fixed:** 19 | **Deferred:** 2 | **Asked:** 0

Validation: `bash tools/run-tests.sh` (JS suite + shell gate) green against final HEAD. Install
harness `tools/test-install.sh` run against this setup.sh with the built bundle: all 3 #2073
app-launch checks PASS (fresh install launches the app not a browser; install-page path launches
the app; app-open message printed). The harness's 2 other failures are stale-symlinked-dist
artifacts (a `--kosmos-app-port-selftest` "#910-aware build" check that self-diagnoses "rebuild
dist/", and an added-files check that is bundle-content-determined and identical on origin/main) —
not caused by this change. Real fresh-install verification (Gatekeeper + enforcing cookie) is
Josh's live dogfood test on his clean machine.

### Per-Iteration Breakdown

#### Iteration 1 — 0 BLOCKER, 2 WARNING, 1 CONVENTION, 2 NIT
- [WARNING] setup.sh gate-header comment described the old browser repair (false) + a narrow #2028
  stale-bundle self-heal edge --> FIXED (comment corrected, edge accepted+documented)
- [WARNING] a residual "open Kosmos from your browser" instruction --> FIXED (reworded)
- [CONVENTION] the open-once plist comment still claimed it carries the board token --> FIXED
- [NIT] test success-line anchor relied on capital-O vs lowercase (brittle) --> FIXED (semicolon clause)
- [NIT] installing.html "taken" branch links the browser board --> DEFERRED (a browser page cannot
  `open` an app; documented in plan)

#### Iteration 2 — 0 BLOCKER, 2 WARNING, 0 CONVENTION, 2 NIT
- [WARNING] a RUNNING app's `open` is an AppKit reopen that doesn't re-navigate/seed → gate re-fires
  per update --> FIXED (documented+accepted; the "launches once then stops" overstatement corrected)
- [WARNING] make_app-failed fresh install: `_board_url` named a non-existent app --> FIXED (guard)
- [NIT] stale positional line-ref comment; [NIT] dead `_minted_nonce` var --> both FIXED

#### Iteration 3 — 0 BLOCKER, 3 WARNING, 0 CONVENTION, 2 NIT
- [WARNING] the guard `[ -d "$APP_DIR/Kosmos.app" ]` tested existence not ownership — followed a
  symlink onto a FOREIGN Kosmos.app --> FIXED (swapped for `bundle_is_ours`; harness re-verified)
- [WARNING] stale gate/open-block browser comments; [WARNING] boardauth.js "?token= doesn't seed"
  comment now false --> both FIXED (viaBootNonce documented vestigial-for-seeding)
- [NIT] installing.html test comment; [NIT] `kosmos open` still opens a browser --> FIXED / DEFERRED
  (the latter an intentional advanced escape hatch, out of scope, demoted in setup.sh)

#### Iteration 4 — 0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NIT (all comment accuracy; behavior confirmed correct)
- setup.sh seed-comment block still described the mint/?boot flow; 2 installing.html comments --> all FIXED

#### Iteration 5 — 0 BLOCKER, 2 WARNING, 2 CONVENTION (all comment/plan accuracy; behavior confirmed correct)
- setup.sh:49 header + :4000 closing stated the post-install state as "browser open" (current-tense
  errors); terminology drift at the seam; plan under-stated the guard as `[ -d ]` --> all FIXED via a
  comprehensive CLASS SWEEP of setup.sh browser comments (accurate historical anecdotes left as-is)

#### Iteration 6 — CONVERGED
- Zero findings. Reviewer independently confirmed: the bundle_is_ours gate, the seed-on-?token=,
  the installing.html no-redirect, and the tests are all correct; every browser comment in the diff
  is accurate-now or clearly historical; the accepted edges are honestly labeled. "This PR is
  genuinely converged."

### Outstanding questions (ASKED)
None.

### Deferred (with reasoning)
- installing.html "taken" branch's manual browser-board link, and `install/kosmos`'s `cmd_open`
  browser open — both out of scope for the installer's AUTOMATIC-open ruling; a browser page cannot
  launch a native app, and `kosmos open` is the intentional advanced escape hatch (demoted in
  setup.sh's success banner). Flagged in the plan.
- The two accepted enforcing-update self-heal edges (running-app AppKit reopen; #2028 stale bundle):
  low impact (a window-to-front per update, self-heals on relaunch), honestly documented in-code;
  the real fix for the reopen case is a native-app Swift change (re-navigate on reopen), flagged as
  a follow-up.

### Strengths (across iterations)
- Security improves, not just holds: the durable board token never reaches `open`/plist argv (the
  app reads it in-process), eliminating the cross-account `ps` exposure the whole #1979 nonce dance
  existed to mitigate.
- `bundle_is_ours` gate refuses symlink/foreign bundles and requires our KOSMOS_HOME anchor; clean
  variable teardown (no `set -euo pipefail` danglers); seed-on-?token= correctly enforcing-only
  gated (no false seed on sandbox); tests non-vacuous with real contrasts.
