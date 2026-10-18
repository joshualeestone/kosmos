---
pre_challenge: true
method: challenge-loop
branch: pkgsig-6474
diff_hash: fac3fd77e8d2b4e5a019920f201c39973783ebe2fc8f618017516822c5a4955a
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T12:00:54Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 blind reviews, alternating sonnet and opus
**Converged:** Yes (iteration 5, sonnet: NITs only)
**Total findings:** 0 BLOCKERs, 9 WARNINGs, about 14 NITs
**Fixed:** all WARNINGs (one by decision: a .pkg never takes a Mac backwards) | **Asked (awaiting user):** 0

Stacked on setupsig-6468 (#6475); the hash is against origin/main, the gate's base.
Validation: tools/test-pkg-checksum-1670.sh all checks pass (ARMS 5a-5k + controls), test-postinstall-inline-quoting (both inline blocks parse), test-resolve-install-user, test-install-page-readable-3268. Mutants: hand-off disabled (5b red), retry removed (5d, 5g), node probe removed (5e), version check removed (5f), double run (5a, 5d), pattern-only gate (5e, 5i, 5j), empty-version guard removed (5h), regex always true (5k).
Not run: a real .pkg install (needs a built, notarized pkg).

## Final ledger
### Iteration 1 (sonnet): 0 BLOCKERs, 1 should-fix
- [WARNING] the hand-off had no retry, regressing the 2026-09-15 half-publish hardening (FIXED: a 97 is retried on the same bounded _rmax/_rsleep budget; any other status is the answer)
- [NIT] a broken installed node blocked the repair path (FIXED: a node -e 0 health probe in the gate falls back to the checksum path)
- [NIT] the refusal said "kosmos update:" to a .pkg user (FIXED on the base branch: messages say Kosmos)
### Iteration 2 (opus): 0 BLOCKERs, 5 should-fix
- [WARNING] a rollback, or a Mac newer than the site offers, retried a deterministic "older than installed" refusal
  (DECIDED: a .pkg does not take a Mac backwards, which is what keeps a site from downgrading it to an old signed
  release; it now stops at once with a .pkg sentence that says nothing needed doing)
- [WARNING] an unreadable installed package.json blocked the repair path (FIXED: the gate also needs a readable
  version; arm 5f)
- [WARNING] every refusal was 97, so a real mismatch was retried (FIXED: run-setup returns 96 for a failed download
  on the base branch; only 96 is retried; 97 ends with one sentence; arms 5d, 5g, and 5b asserts no retry)
- [WARNING] run-setup's command line is now relied on by shipped .pkgs (FIXED on the base branch: marked frozen; the
  .pkg arms call it in that exact shape)
- [WARNING] retry and health probe untested, 5a weak (FIXED: 5d retry recovers, 5g persistent 96, 5e broken node,
  5f unreadable version; 5a asserts the hand-off ran). Writing them exposed that 5b had been refused on a BAD
  SIGNATURE (the edited manifest was never re-signed), not on the installer mismatch it claims: it now re-signs with
  the pinned throwaway key and asserts the exact mismatch sentence.
- [NIT] curl timeout added; greedy version sed and the outer "did not complete" line (ACCEPTED)
- Mutants: retry removed (5d, 5g red), node probe removed (5e red), version check removed (5f red).
### Iteration 3 (sonnet): 0 BLOCKERs, 1 should-fix
- [WARNING] an unreadable latest.json gave an empty version, which run-setup refused (97): a network blip ended the install with a misleading sentence (FIXED: an empty version is a 96, retried; arm 5h; a mutant dropping it turns 5h red)
- [NIT] 5b no-retry assertion also passed with no hand-off (FIXED: exactly one call); checksum gate still first (DOCUMENTED as deliberate); loose version grep (ACCEPTED: falls back safely)
### Iteration 4 (opus): 0 BLOCKERs, 2 should-fix
- [WARNING] the health gate was looser than the verifier: a half-written package.json passed a pattern, and a truncated verifier that names run-setup ended with neither an installer run nor a stated refusal (FIXED: the installed node parses package.json and runs node --check on the verifier; arms 5i, 5j; a mutant restoring a pattern gate turns 5e, 5i, 5j red)
- [WARNING] tests could not see a double installer run, nor the .pkg refusal sentence (FIXED: the fixture installer counts runs; 5a and 5d require exactly one; 5b requires exit 97 and the sentence; a double-run mutant turns 5a and 5d red)
- [NIT] pointer curl now capped (-m 60) (FIXED); a CDN briefly serving a new /setup with an old pointer is a hard 97 (ACCEPTED, weakest premise: the deploy swaps atomically; the checksum gate before it retries mixed pairs); KOSMOS_SETUP_URL to /setup-staging is held to the prod pointer (ACCEPTED: harness-only)
### Iteration 5 (sonnet): no BLOCKER or WARNING findings (converged)
- [NIT] the version regex had no arm (FIXED: 5k, valid JSON with 1.2 keeps the checksum path; a mutant always passing the regex turns 5k red); grep -q run-setup is weak (ACCEPTED: node --check and the hand-off itself catch a verifier without it); the quoting test is syntax-only (ACCEPTED: ARMS 5 execute the string)

Rebased 08:18 onto main after #6475 merged (clean, 7 commits). Revalidated: test-pkg-checksum-1670 (all), postinstall inline quoting, resolve-install-user, install-page-readable-3268, pkg-input-guard, pkg-arch-gate-1562 pass; install.installing-page, server.connect, install.setup-sig-6468 90/90. Rehashed against origin/main.
