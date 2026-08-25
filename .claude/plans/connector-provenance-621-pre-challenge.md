---
pre_challenge: true
method: challenge-loop
branch: connector-provenance-621
diff_hash: 742de887fca022a5400a79481a97e008a7034e29ac38599a2de8e89e6132a9b5
subdir_audit: passed
timestamp: 2026-08-25T04:24:17Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (round 3: nothing at BLOCKER or WARNING level)
**Total findings:** 17 (0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 11 NITs)
**Fixed:** 11 | **Deferred:** 6

Validation: `yarn test` 2000 passed, 0 failed, every shell suite 0 failures including connector-provenance (23:21, after 0.5.24 served); `tools/test-connector-provenance.sh` 16 passed, 0 failures; real-build controls (621-realbuild-control2.log): the real build logs the sidecar's sha and commit beside the signed sha; a copy whose .sha256 names other bytes refuses before staging with no tarball; a copy without sidecars refuses and says to bring them.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] tools/build-kosmos-bundle.sh - the logged sha was the signed copy's beside "per its sidecar", readable as a mismatch --> FIXED (182c84e: signed and input shas both logged, labelled)
- [WARNING] tools/build-kosmos-bundle.sh - a window between verifying the input and copying it --> FIXED (182c84e: the staged copy is hashed against the sidecar before signing)
- [WARNING] tools/test-connector-provenance.sh - fixtures never used the relay's bare-hex shape --> FIXED (182c84e)
- [WARNING] tools/lib/connector-provenance.sh - the remedy misdirected anyone who copied the binary --> FIXED (182c84e: copy the sidecars too)
- [NIT] a malformed .sha256 refused as a mismatch --> FIXED (182c84e: refused as malformed)
- [NIT] a NOTE in a green run --> DEFERRED (the build is what refuses)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 5 NITs
**Duplicates of prior findings (confirmed resolved):** 4
- [WARNING] tools/build-kosmos-bundle.sh - two separate reads of the sidecars could straddle a relay rebuild and log the old commit beside the new sha (the #621 shape, reintroduced by round 1's fix) --> FIXED (03ff81a: one direct check call, both values from it)
- [CONVENTION] branch behind main --> FIXED (rebased)
- [NIT] header said the globals are set but the accessors run in subshells --> FIXED (03ff81a: the header names the surface)
- [NIT] CRLF tolerance unproven --> FIXED (03ff81a: a CRLF fixture; a mutation dropping tr -d fails it)
- [NIT] the log line did not say which number the sidecar names --> FIXED (03ff81a: "(its .sha256)")
- [NIT] a misplaced comment; four shasum passes per build --> FIXED / DEFERRED (0.07 s each)

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
- [NIT] the direct-call convention had no control in the suite --> FIXED (9bc2f04)
- [NIT] a missing binary had no case --> FIXED (9bc2f04)
- [NIT] the entry reset of the globals untested; ${1:?} is a hard exit; a shasum read failure reads as a mismatch; two header paragraphs overlap --> DEFERRED (none reachable from the build, which defaults the path and refuses earlier)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | build-kosmos-bundle.sh | Signed sha read as a mismatch | FIXED | 182c84e |
| 2 | 1 | WARNING | build-kosmos-bundle.sh | Check-then-copy window | FIXED | 182c84e |
| 3 | 1 | WARNING | test-connector-provenance.sh | Bare-hex shape untested | FIXED | 182c84e |
| 4 | 1 | WARNING | connector-provenance.sh | Copy remedy misdirects | FIXED | 182c84e |
| 5 | 2 | WARNING | build-kosmos-bundle.sh | Two reads straddle a rebuild | FIXED | 03ff81a |
| 6 | 2 | CONVENTION | branch | Behind main | FIXED | rebase |

### NITs (non-blocking, across all iterations)
- Listed under each iteration; five fixed, six deferred with the reason.

### Strengths (across all iterations)
- The 64-hex and 40-hex patterns counted programmatically; 63, 65 and 39 refuse (iteration 3)
- Every guard mutated on a copied lib turned a line red, except the CRLF one, which then got its fixture (iterations 2 and 3)
- The race the round-2 fix targets reasoned closed from the relay build's write order (iteration 3)
