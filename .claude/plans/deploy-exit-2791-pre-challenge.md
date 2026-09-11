---
pre_challenge: true
method: challenge-loop
branch: deploy-exit-2791
diff_hash: 333a8f7f34f6a3f8c45b09b7289bde0691d97b03c41619de25aaef950ba05b5b
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T15:37:26Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (iteration 4 is a post-merge re-review after resolving a package.json conflict)
**Converged:** Yes
**Total findings:** 2 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, 8 NITs
**Fixed:** 1 WARNING (+ 1 NIT: shebang) | **Deferred:** 1 WARNING | **Asked (awaiting user):** 0

Reviewer models rotated across iterations (kosmos#2032): Opus, Sonnet, Opus, Sonnet. The rotation
earned its keep this run: the WARNING that drove the only code change was raised by the Sonnet pass
and had been classed only a NIT by the Opus pass before it, then the fix was re-reviewed blind by
Opus at iteration 3 and produced no new actionable findings.

Post-merge note: after the loop converged at iteration 3, the PR (kosmos#2797) was CONFLICTING
because main's package.json test:shell chain had gained new tests since the branch point. origin/main
was merged in and the package.json conflict resolved (main's full chain kept, my one test re-inserted
after the winderive test; verified by a 141 -> 142 multiset diff that dropped nothing). The merged
tree was re-validated (full suite, green) and iteration 4 is a fresh blind re-review of the net diff
against the new base. The reviewed CODE (deploy-site.sh exit 0, the test file) is byte-identical to
what iterations 1-3 converged on; only the base moved.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (nothing had committed yet; ITER_COMMITS empty)
- [NIT] tools/test-deploy-site-exit0-2791.sh - source-level pin, not a runtime rc==0 assertion (proxy)
- [NIT] tools/test-deploy-site-exit0-2791.sh - arm 2 (set -e present) had no negative control
- [NIT] tools/test-deploy-site-exit0-2791.sh - last-line check strict on exact `exit 0` spelling
- [STRENGTH] exit 0 sits after every guard; all real-failure paths exit 1 first; no EXIT trap
- [STRENGTH] the A-CONTROL arm genuinely proves the last-line check can fail (non-vacuous)
- [STRENGTH] test wired into test:shell in the right position with &&
- [STRENGTH] plan names its own weakest premise honestly

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (finding cites BRANCH code; ITER_COMMITS still empty at review time)
**Duplicates of prior findings:** the "source-pin vs runtime" NIT from iter 1 was re-raised here at
WARNING severity - treated as the new WARNING, not a duplicate, because the higher severity plus the
concrete "the sibling harness already stubs curl/vercel end-to-end" evidence made it actionable.
- [WARNING] tools/test-deploy-site-exit0-2791.sh - the test only pinned the source text; it never
  ran deploy-site.sh and asserted a real rc==0 on a successful publish, though the sibling
  test-deploy-site-promote.sh already establishes a stub-curl/stub-vercel end-to-end harness and
  CLAUDE.md prefers end-to-end tests --> FIXED (commit a2259540): added PART B, a runtime arm that
  drives a --publish to completion on a consistent site (committed latest.json == live) and asserts
  the real process rc==0 AND the "published and verified" success line, plus a B2 refuse-path control
  (committed != live must exit non-zero, anchored on the exact refuse message) proving B1 non-vacuous.
  Verified the arm can fail: perturbing the trailing `exit 0` to `exit 7` reddened B1 (observed rc=7
  after the full success path ran), then restored from HEAD.
- [NIT] tools/test-deploy-site-exit0-2791.sh:1 - shebang was `#!/bin/sh` while siblings use bash -->
  FIXED (same commit): the runtime arm needs bash (`<<<`), so the file was converted to
  `#!/usr/bin/env bash`, resolving the inconsistency.
- [NIT] tools/test-deploy-site-exit0-2791.sh - the test script itself ends on an implicit-exit echo
  (consistency note only; test:shell checks the &&-chain exit code) --> not changed (non-issue)
- [STRENGTH] root-cause analysis in the plan is rigorous (traced POSIX if...fi semantics, checked git
  calls for guarded suppression, confirmed no in-repo DEPLOY_EXIT consumer)
- [STRENGTH] placement of exit 0 masks no failure; consistent with the dry-run path's explicit exit 0
- [STRENGTH] plan complete per repo convention (decision, rejected alternatives, weakest premise)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (the NITs cite the iter-2 fix but are acknowledged non-issues, not
defects to fix; nothing was acted on as SELF)
**Converged** - no new actionable findings on the fixed code.
- [NIT] tools/test-deploy-site-exit0-2791.sh - B1 does not discriminate the fixed script from pre-fix
  (the path returned 0 implicitly before), so A1 remains the fix's regression guard (by design, and
  stated in the test comments)
- [NIT] tools/test-deploy-site-exit0-2791.sh - `read -r S L <<<"$(...)"` word-splits on whitespace;
  safe under a space-free TMPDIR (same pattern as the sibling promote test)
- [NIT] tools/test-deploy-site-exit0-2791.sh:44 - A2 verifies the `set -e` token is present, not that
  it is in effect at end of script (harmless; real `set -eu` at line 66)
- [STRENGTH] the core fix is correct, minimal, masks no failure; set -eu never disabled, no set +e
- [STRENGTH] no regression for callers reading exit status; script is executed, never sourced
- [STRENGTH] the B2 control is non-vacuous (requires rc!=0 AND the exact refuse message at line 248)
- [STRENGTH] layered test design with honest self-assessment; A is correctly the load-bearing arm

#### Iteration 4 (post-merge re-review, new base)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (the WARNING cites an inherited stub pattern, not this loop's output)
**Converged** - the one WARNING was deferred (see below); no unresolved NEW findings remain.
- [WARNING] tools/test-deploy-site-exit0-2791.sh:39-47 - the stub curl's `-w` branch prints the
  literal `200`/`404` rather than honoring the requested `-w '%{http_code} %{content_type}'` format,
  so served_verify_asset_ok's content-type check passes on the token `200` (non-empty, not
  text/html) rather than on a simulated real content-type --> DEFERRED. Reasoning: (1) it does not
  affect this test's assertions - B1 requires the whole --publish success path to pass (proven to
  redden when the trailing exit is broken) and B2 refuses at deploy-site.sh:248, BEFORE any
  content-type check; (2) it is inherited verbatim from the sibling tools/test-deploy-site-promote.sh,
  which uses the identical stub and passes CI, so it is not a defect this branch introduces; (3) a
  faithful content-type stub belongs in a shared-harness improvement across both deploy-site test
  files, not bolted onto this exit-code card. What would change the call: if served_verify_asset_ok's
  content-type check were tightened such that the literal `200` token began to FAIL it, both this
  test and the promote test would need the stub made faithful together.
- [STRENGTH] the package.json merge kept all of main's test:shell entries and added exactly my one
  test (verified by a 141 -> 142 multiset diff), inserted in a sensible position
- [STRENGTH] the explicit exit 0 masks no failure (re-confirmed against set -eu at line 66 and every
  guard's explicit exit 1 before the success line)
- [STRENGTH] A1's last-line pin re-derived and A-CONTROL re-confirmed non-vacuous

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | WARNING | tools/test-deploy-site-exit0-2791.sh | BRANCH | Test pinned only source text, no runtime rc==0 on a successful publish | FIXED | a2259540 (runtime PART B arm + refuse control) |
| 2 | 2 | NIT | tools/test-deploy-site-exit0-2791.sh:1 | BRANCH | Shebang #!/bin/sh vs siblings' bash | FIXED | a2259540 (converted to bash) |
| 3 | 4 | WARNING | tools/test-deploy-site-exit0-2791.sh:39-47 | BRANCH | Stub curl -w prints literal 200/404, not a real content-type (inherited from promote test) | DEFERRED | Does not affect B1/B2 assertions; inherited from sibling; faithful stub is a shared-harness change |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] test - source-level pin is a proxy for runtime behavior (iter 1); addressed by the iter-2 runtime arm
- [NIT] test - arm 2 has no negative control (iter 1); low value, presence grep against a real set -eu
- [NIT] test - last-line check strict on exact `exit 0` spelling (iter 1); acceptable as a strict pin
- [NIT] test - the test script itself ends on an implicit-exit echo (iter 2); non-issue
- [NIT] test - B1 does not discriminate fixed vs pre-fix; A1 is the regression guard by design (iter 3)
- [NIT] test - `read -r S L <<<` word-splits under a space-containing TMPDIR (iter 3); practically safe
- [NIT] test:44 - A2 checks the set -e token is present, not that it is in effect (iter 3); harmless

### Strengths (across all iterations)
- The explicit `exit 0` sits after every guard and masks no failure; set -eu never disabled; no EXIT trap
- No regression for exit-status callers; the script is executed, never sourced
- The B2 runtime control is anchored on the exact refuse message, so a refuse-for-the-wrong-reason fails loudly
- Layered test design (source pins prove the immune-to-trailing-command property the runtime arm cannot)
- Rigorous plan with an honest weakest-premise disclosure
