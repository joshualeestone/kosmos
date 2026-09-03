---
pre_challenge: true
method: challenge-loop
branch: deploy-site-2014
diff_hash: 233508c644055f17be04bd228ba22eb71e1fc1b0a01e1c334500a187487fe445
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T15:58:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (converged at 6 with zero new findings)
**Converged:** Yes
**Total findings:** 1 BLOCKER, 8 WARNINGs, 1 CONVENTION, several NITs
**Fixed:** almost all | **Deferred:** 2 (the plan-file CONVENTION was resolved by adding the plan; one WARNING deferred with reasoning)

This is a shell deploy tool (`tools/deploy-site.sh`) that also carried Baron's prior domain
review + bless before this loop; the challenge-loop then found a real `--publish`-only BLOCKER
that Baron's static read, the DRY-RUN, and three iterations all missed.

### Per-Iteration Breakdown

#### Iteration 0 (baseline)
- CONVENTION: no in-repo plan file --> RESOLVED (added `.claude/plans/deploy-site-2014-20260903T1004.md`; the design lives on the #2014 card + Baron's review).

#### Iteration 1
- [WARNING] committed-vs-live latest.json: dist/latest.json is TRACKED, so git archive ships the COMMITTED pointer while the fetch keyed off LIVE; a stale checkout would serve a pointer to a version whose tarball was never fetched. --> FIXED (committed-vs-live guard; hardened to a whole-file compare in iter 2).
- [WARNING] dry-run mutates the shared checkout's dist/. --> ADDRESSED (only gitignored, sha-verified artifacts; refined in iter 2 to stop touching tracked files entirely).
- NITs: win-zip/manifest clarity, post-deploy failure guard. --> FIXED.

#### Iteration 2
- [WARNING] TOCTOU: the commit was not pinned; the guard read HEAD and the export was passed HEAD at a different moment (the lib takes a commit arg precisely to defend the shared-checkout race). --> FIXED (pin H once, use for both).
- [WARNING] the tracked win-zip + manifest were fetched into the shared checkout, overwriting tracked files with unverified bytes a later `git commit -a` could sweep up. --> FIXED (stop fetching tracked artifacts; git archive ships them).
- [WARNING] the pointer guard compared only the artifact name, not the whole latest.json (sha256/manifest drift under an unchanged name would ship). --> FIXED (whole-file compare).
- NITs: dry-run temp cleanup, tolerant artifact sed, honest .vercelignore message, bash-dependency note. --> FIXED.

#### Iteration 3
- [WARNING] the live latest.json (and artifact) fetches lacked Cache-Control: no-cache, unlike verify-served.sh + pkg-inputs; a stale CDN copy could drive a false refuse or a stale artifact name. --> FIXED (no-cache on every $HOST fetch).
- NITs: CJ under set -e loses the friendly refuse; honest-marker check now covers the .sha256 sidecars. --> FIXED.

#### Iteration 4 (the BLOCKER)
- [BLOCKER] the post-deploy verification called tools/verify-served.sh, which keys every version expectation to agent-workforce's package.json (0.6.26), routinely AHEAD of the site's released version (0.6.25 at review time). On --publish, after a perfectly correct site-copy deploy, it would 404 on kosmos-<newer>-arm64.tar.gz and fail the latest.json version grep, printing "SERVED verification FAILED ... #1669 shape" and exiting 1 -- on essentially every intended standalone use. Never caught earlier because verify-served is --publish-only and the DRY-RUN does not run it. --> FIXED: replaced with an own served-vs-deployed sha verification keyed to the site's own version ($ART), distinguishing a drop (404) from wrong bytes, plus a latest.json name-check and 200-checks for the tracked win zip + /setup.
- [WARNING] the .vercelignore guard probes only the pkg triple, not the tarballs. --> DEFERRED: inherited parity with the release path (the .vercelignore is a committed controlled file; the same gap would break the release path too), not a regression this script introduces.

#### Iteration 5
- [WARNING] the post-deploy served verification did not served-check the .sha256 sidecars (the installer verifies each tarball against its sidecar). --> FIXED (served_matches now loops over each artifact AND its sidecar; honest-marker check also covers Kosmos.pkg.sha256).
- [NIT] the site_deploy_export failure branch leaked its temp dir. --> FIXED.

#### Iteration 6
- **No new correctness or safety defect found. The script is sound.** The reviewer traced the script, site_deploy_export, verify-served.sh, and pkg_upload_filter_excludes, tried to break each guard and each set -eu masking site, and could not. One NIT (Kosmos.pkg.inputs not sha-verified) was examined and dismissed as not-a-defect (its presence is guaranteed by the library's whole-triple invariant tied to the checked Kosmos.pkg). **CONVERGED.**

### Final validation (6j)
- sh -n clean.
- DRY-RUN passes end to end on the current live version (0.6.26): fetch + committed-vs-live guard + export + honest-marker (incl. sidecars) + .vercelignore guard all pass.
- Full JS suite: ALL PASS (33 arms), 0 failures.

### Outstanding questions (ASKED)
None.

### Deferred (with reasoning)
- [WARNING] iter 4: the .vercelignore guard probes only the pkg triple -- inherited parity with the release path; the .vercelignore is a committed controlled file; fixing it belongs to the shared guard / release path, not this script specifically.

### Strengths (across iterations)
- The honest-marker discipline is genuinely sound: the marker is never fabricated; every gitignored installer artifact + sidecar is independently re-checked in the export, so the marker cannot become a rubber stamp -- closing the #1669 "carried: no pkg ... and PROCEEDS" hole.
- The fetch-from-live-then-verify-served design makes the post-deploy check a byte-identical comparison keyed to the site's own version, avoiding both the #1669 drop and the verify-served.sh version-skew false-fail.
- The commit is pinned once for both the pointer guard and the export, closing the shared-checkout TOCTOU; the whole-file committed-vs-live compare cannot false-refuse on a trailing newline; only gitignored artifacts are fetched, so `git status` stays clean.
