---
pre_challenge: true
method: challenge-loop
branch: robust7b-2286
diff_hash: 643d62953673fa7e955e4fa75488fdd6d7226571ce1b1ad4a5eb3eedf6649d25
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T00:06:59Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 produced zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total actionable findings:** 7 (1 BLOCKER, 6 WARNINGs, 0 CONVENTIONs) + many NITs
**Fixed:** 1 BLOCKER + 6 WARNINGs + 4 NITs | **Deferred:** 3 NITs | **Asked:** 0

kosmos#2286: make "build the site release commit on a freshly-fetched origin/main" the ONLY 7b path,
removing both #2278 limitations (local-main divergence; versions.html overlay). Full suite (npm run
test:shell) green on the final HEAD (eecfab7f); the site-push test (tools/test-site-push-race-2276.sh,
32 assertions) passes standalone and within the suite.

### Per-Iteration Breakdown

#### Iteration 1 (commit 9d8a65df)
**New:** 0 BLOCKER, 2 WARNING, 0 CONVENTION, 3 NIT
- [WARNING] release.sh - best-effort cleanup `git checkout -- $_site_paths` refuses the whole
  multi-path checkout when the untracked manifest is present, restoring nothing --> FIXED (per-path loop)
- [WARNING] test - non-ff discrimination grep + retry + bound exercised by no test (E failed at fetch)
  --> FIXED (deterministic E2/E3 via pre-receive hooks counting attempts)
- [NIT] FETCH_HEAD stomp --> FIXED (resolve origin/main); [NIT] escape id regex --> FIXED;
  [NIT] comment the load-bearing `|| exit 1` --> FIXED

#### Iteration 2 (commit 98c17342)
**New:** 1 BLOCKER, 2 WARNING, 0 CONVENTION, 1 NIT
- [BLOCKER] release.sh - post-push versions-entry check `git show | grep -q` under set -o pipefail:
  on the ~269KB page grep -q exits early, git show SIGPIPEs (141), pipefail makes the pipeline 141,
  false-aborting the cut AFTER the push, on ~every cut --> FIXED (release_versions_entry_present:
  capture + case, no pipe) + Case G large-file regression guard (verified red-capable: piped form
  fails G with rc=141)
- [WARNING] reject-then-succeed recovery untested --> FIXED (Case E4)
- [WARNING] 7b block uncovered + tiny fixture hides SIGPIPE --> FIXED (extracted function + Case G)
- [NIT] assert the untracked manifest lands --> FIXED (Case A)

#### Iteration 3 (commit 25961539)
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 4 NIT
- [NIT] re-inserted entry abutted the next (no blank line) --> FIXED (`\n\n`, asserted in test)
- [NIT] extraction drops a preceding comment --> DEFERRED (our cut entries are bare articles; live
  page has none)
- [NIT] rc=2 collapse at call site --> DEFERRED (unreachable: the cat-file -e loop proves versions.html
  exists on the sha)
- [NIT] python3 test dependency --> DEFERRED (already required by 5 other suite tests; fails loud)

#### Iteration 4 (commit 076939a4)
**New:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 3 NIT
- [WARNING] cleanup discarded versions.html and the comment claimed "no colleague edits them" -- false
  for the ONE contended release path; could clobber an uncommitted colleague versions.html edit -->
  FIXED (exclude versions.html from the discard; correct the comment)
- [NIT] push-error pipe safe only for small data --> FIXED (note added); [NIT] F1 guard test weak -->
  FIXED (assert the guard's own message); [NIT] idRe escape vs numeric anchor --> DEFERRED (both
  correct by construction)

#### Iteration 5 (commit eecfab7f)
**New:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NIT (all doc-only)
- [WARNING] three comments claimed a "next cut's reset --hard origin/main" self-heal that does not
  exist in release.sh (fictional mechanism) --> FIXED (corrected to the real self-heal: fresh-fetch
  rebuild + per-cut regen + operator refresh)
- [NIT] anchor numeric-by-construction note --> FIXED; [NIT] idempotence divergence from
  insert-release-entry.js --> FIXED (one-line note)

#### Iteration 6
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT
- [NIT] rc=2 misstates cause --> DUPLICATE of the iter-3 deferred NIT (skipped)
- [NIT] other_paths leading space (unquoted expansion drops the empty field, bash-only) --> recorded,
  not fixed (cosmetic, zero behavioral effect; fixing post-convergence would needlessly reopen)
**Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | release.sh | multi-path checkout restores nothing w/ untracked manifest | FIXED | 9d8a65df |
| 2 | 1 | WARNING | test | non-ff grep/retry/bound untested | FIXED | 9d8a65df |
| 3 | 1 | NIT | site-push.sh | FETCH_HEAD stomp | FIXED | 9d8a65df |
| 4 | 1 | NIT | reinsert.js | id regex unescaped | FIXED | 9d8a65df |
| 5 | 1 | NIT | release.sh | undocumented `|| exit 1` set -e suspension | FIXED | 9d8a65df |
| 6 | 2 | BLOCKER | release.sh | SIGPIPE-under-pipefail false-abort on 269KB page | FIXED | 98c17342 |
| 7 | 2 | WARNING | test | reject-then-succeed untested | FIXED | 98c17342 |
| 8 | 2 | WARNING | test | 7b block uncovered + tiny fixture hides SIGPIPE | FIXED | 98c17342 |
| 9 | 2 | NIT | test | manifest-lands unasserted | FIXED | 98c17342 |
| 10 | 3 | NIT | reinsert.js | entries abut (no blank line) | FIXED | 25961539 |
| 11 | 3 | NIT | reinsert.js | extraction drops preceding comment | DEFERRED | bare cut entries; none on live page |
| 12 | 3 | NIT | release.sh | rc=2 collapse | DEFERRED | unreachable via cat-file -e loop |
| 13 | 3 | NIT | test | python3 dependency | DEFERRED | already required by 5 suite tests |
| 14 | 4 | WARNING | release.sh | cleanup clobbers versions.html + false comment | FIXED | 076939a4 |
| 15 | 4 | NIT | site-push.sh | push-error pipe safe only for small data | FIXED | 076939a4 |
| 16 | 4 | NIT | test | F1 guard test weak | FIXED | 076939a4 |
| 17 | 4 | NIT | reinsert.js | idRe escape vs numeric anchor | DEFERRED | both correct by construction |
| 18 | 5 | WARNING | release.sh | fictional "reset --hard" self-heal comment | FIXED | eecfab7f |
| 19 | 5 | NIT | reinsert.js | anchor numeric-by-construction | FIXED | eecfab7f |
| 20 | 5 | NIT | reinsert.js | idempotence divergence note | FIXED | eecfab7f |
| 21 | 6 | NIT | release.sh | rc=2 misstates cause | DEFERRED | duplicate of #12 |
| 22 | 6 | NIT | site-push.sh | other_paths leading space | DEFERRED | cosmetic; empty field dropped by bash |

### NITs (non-blocking)
- reinsert.js comment/extraction edge (deferred), release.sh rc=2 message (deferred, unreachable),
  python3 test dep (deferred), idRe-vs-anchor (deferred), other_paths leading space (deferred).

### Strengths (across all iterations)
- Temp-index (GIT_INDEX_FILE) plumbing never touches the real index, working tree, or local main;
  Case A asserts all three independently and is red-capable.
- release_versions_entry_present avoids the SIGPIPE-under-pipefail trap (capture + case); Case G is a
  red-capable regression guard on a >262KB page.
- Non-ff discrimination + retry + bound driven deterministically via pre-receive hooks (E2/E3/E4);
  Case B proves re-insert vs overlay (the headline of #2286).
- reinsert-versions-entry.js is id-prefix-safe, idempotent, and byte-matches insert-release-entry.js's
  placement + spacing.
- Comment accuracy verified against the code in the final pass; the behavior change (cut no longer
  sweeps unpushed local commits) is documented in both headers.
