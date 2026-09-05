---
pre_challenge: true
method: challenge-loop
branch: promote-runbook-2195
diff_hash: 77aa449e5fa975e70e6afd443765b0867816f87e9ff09517ad8e5fce50dc954a
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T04:19:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 produced zero new BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 1 BLOCKER, 12 WARNINGs, several NITs
**Fixed:** all | **Deferred:** 0 | **Asked:** 0

This is a DOC change (docs/staging-channel.md step 5 = the interim manual promote-to-prod runbook,
split from #2195's deferred tool). Because it is a PROD deploy runbook, every iteration verified the
shell against the real tools (promote-channel.sh, deploy-site.sh, release.sh step 8, site-deploy.sh,
pkg-inputs.sh). The loop did real work: iteration 2 caught a #1669 BLOCKER.

### Per-Iteration Breakdown

#### Iteration 1
3 WARNINGs, 1 NIT. The runbook did not CHAIN site_deploy_export -> vercel; sourced pkg-inputs.sh but
skipped the .vercelignore guard both real paths run; sourced #!/bin/bash libs into zsh; HOST unset.
--> FIXED: chained, added the .vercelignore guard, ran under bash, set HOST.

#### Iteration 2
1 BLOCKER, 2 WARNINGs. BLOCKER: the honest-marker check tested only latest.json + the release marker
(both always shipped) and could NOT detect a dropped GITIGNORED artifact -- site_deploy_export
returns 0 on an incomplete dist/, so a "successful" export can ship a correct pointer over 404'ing
downloads (#1669). --> FIXED: added the per-artifact export check deploy-site.sh step 3 runs.
WARNINGs: the #1669 rationale mischaracterized the risk (a refusal rm -rf's the dir; the real risk is
a SUCCESSFUL export missing artifacts); commit+push was outside the guarded block so a failed push
could still deploy. --> FIXED: corrected the rationale; moved commit+push inside the set -e block.

#### Iteration 3
2 WARNINGs, NITs. A re-run with an already-committed pointer got stuck (git commit non-zero aborts
set -e); the "fetch the artifacts" note gave no command. --> FIXED: conditional commit; a fetch note
(later replaced in iter 4).

#### Iteration 4
3 WARNINGs. The iter-3 temp-dir cleanup was DEFEATED by set -e (a failed subshell aborts before
rc=$?); the fetch-recovery recipe referenced $S/$ART bound only inside the heredoc; it did not
sha-verify. --> FIXED: a single trap 'rm -rf "$EXPORT"' EXIT (clean on every exit) + a bare final
deploy; replaced the half-baked recipe with the correct operational answer (run the promote where
the staging cut ran / #2195 fetch-verifies).

#### Iteration 5
1 WARNING. The served-verify curls lacked cache-busting, so a stale edge could read the old version
right after the deploy and mislead the operator. --> FIXED: -H 'Cache-Control: no-cache' on the
verify curls, matching deploy-site.sh.

#### Iteration 6
2 WARNINGs. The post-deploy verify covered only the pointer + versioned tarball, not the full served
set (deploy-site.sh section 6 verifies all served -- "dead download buttons"); the "deploy-site.sh
refuses a pointer-move" mechanism only fires once committed (uncommitted it silently ships the old
pointer). --> FIXED: a full served-content verify block (every artifact by sha + /setup 200); a
committed-vs-uncommitted clarification. (A self-caught bash -n bug -- a bare V=<V> parses <V> as a
redirect -- was fixed to V=0.6.xx in the same round.)

#### Iteration 7
0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (5 STRENGTHs, 1 NIT). CONVERGED. The reviewer verified both
```sh blocks are runnable and prod-safe against the tools, both quotes verbatim, no #1669 path. The
NIT (an unused outer HOST=) was fixed.

### Final Ledger (actionable findings)

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | WARNING | export not chained to deploy | FIXED |
| 2 | 1 | WARNING | .vercelignore guard omitted | FIXED |
| 3 | 1 | WARNING | libs sourced into zsh | FIXED |
| 4 | 2 | BLOCKER | honest-marker did not guard the #1669 gitignored artifacts | FIXED |
| 5 | 2 | WARNING | #1669 rationale mischaracterized | FIXED |
| 6 | 2 | WARNING | commit+push not gating the deploy | FIXED |
| 7 | 3 | WARNING | re-run with committed pointer stuck | FIXED |
| 8 | 3 | WARNING | fetch note had no command | FIXED |
| 9 | 4 | WARNING | temp-dir cleanup defeated by set -e | FIXED |
| 10 | 4 | WARNING | fetch recipe vars out of scope | FIXED |
| 11 | 4 | WARNING | fetch recipe no sha-verify | FIXED |
| 12 | 5 | WARNING | verify not cache-busted | FIXED |
| 13 | 6 | WARNING | verify not full served set | FIXED |
| 14 | 6 | WARNING | deploy-site.sh refusal mechanism imprecise | FIXED |

### Strengths (across iterations)
- The core claim is accurate in both branches: deploy-site.sh cannot publish a promote (refuses once committed; ships the old pointer if uncommitted).
- The per-artifact loop is an exact mirror of deploy-site.sh's honest-marker set, closing the #1669 gap site_deploy_export leaves open.
- set -eu control flow is correct on every path (failed push aborts pre-deploy; the .vercelignore rc capture matches release.sh; the trap cleans up on every exit; the final subshell propagates failure).
- Shared-checkout-safe pathspec commit + explicit push refspec; both quotes verbatim; both ```sh blocks bash -n clean; no em dashes.

### NITs (non-blocking)
- The per-artifact loop is presence-only, not sha (documented as a reasoned limitation; #2195's tool fetch-verifies).
- ART extracted by sed (mirrors deploy-site.sh's own approach).
