---
pre_challenge: true
method: challenge-loop
branch: runner-install-979
diff_hash: 06d7c0570f91e41a0b771f0fbb1922347efb7c8aad4e0564a302e1523f0118a2
subdir_audit: passed
timestamp: 2026-08-26T16:07:11Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs; 4 polish NITs, 2 taken post-convergence, 2 deferred with reasoning)
**Total findings:** 34 (2 BLOCKERs, 11 WARNINGs, 1 CONVENTION, 20 NITs)
**Fixed:** 30 | **Deferred:** 4

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 4 NITs
- [BLOCKER] install('constructor') passed the guard via the prototype chain, reachable from the URL route; its job would sweep a real install's staging --> FIXED (null-proto MANIFEST + Object.hasOwn; tested at module and route)
- [WARNING] no download timeout; a wedged connection parked the job forever behind the idempotent join --> FIXED (60s socket-silence timer)
- [WARNING] whole-.tmp sweep would delete a sibling provider's in-flight bytes --> FIXED (provider-prefix scope; age gate added in iteration 3)
- [WARNING] plan verification drift (promised route tests and socket fixture absent) --> FIXED (server.runners.test.js added on the connect-harness pattern; the download-seam decision amended honestly)
- [CONVENTION] em dash in the plan --> FIXED
- [NIT] job shape omitted `proved`; 114MB readFileSync hash spike; truncation named as tampering; env override silently fell through when missing --> ALL FIXED (documented, streamed hash, distinct truncation message, authoritative override)

#### Iteration 2
**New findings:** 0 BLOCKERs, 4 WARNINGs, 6 NITs
- [WARNING] present-shortcut before job-join minted a synthetic installed during the proving window --> FIXED (join first; tested at the exact window)
- [WARNING] generic install vs openai-only resolver would silently forever-redownload the next provider --> FIXED (loud refusal when manifest and resolver disagree; tested via the manifest seam)
- [WARNING] env override naming a missing path made an unwinnable install loop --> FIXED (refusal with the fix in the message; tested)
- [WARNING] truncation branch untested though claimed --> FIXED (tested with mismatched counts)
- [NITs] fd leak on failed download; duplicated refusal sentence; stale resolver doc; wrong seam name in comment; unswept test sandbox; count drift --> ALL FIXED (single-sourced MISSING_RUNNER_SENTENCE export among them)

#### Iteration 3
**New findings:** 0 BLOCKERs, 3 WARNINGs, 5 NITs
- [WARNING] pinned version reported as if installed --> FIXED (field renamed pinnedVersion; documented as a manifest fact; no auto-reinstall on bump, stated)
- [WARNING] cross-process races on the shared managed root --> FIXED (per-pid staging, age-gated sweeps, whole-tree pkg swap; residual swap-vs-swap window documented as accepted)
- [WARNING] mutable MANIFEST trust anchors --> FIXED (frozen, asserted frozen by test; opts.manifest seam for fixtures)
- [NITs] request socket teardown in bail; relative symlink target; stale failed job beside present:true retired; spin-loop test guard; const placement; HEAD on GET route --> ALL FIXED

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 5 NITs
- [WARNING] stranded per-pid pkg trees never swept (~300MB each) --> FIXED (age-gated destDir sweep + pkgNewLive removed on every failure path; header claim updated)
- [WARNING] tar failure left the partial tree --> FIXED (same pkgNewLive mechanism)
- [NITs] over-delivery named accurately; null (not 0-of-0) synthetic counts; tar timeboxed; UI-coupling comments corrected; HEAD-header duplication DEFERRED (matches this file's own sibling HEAD handlers; a shared-header refactor is out of scope)
- Also: a comment containing the star-slash sequence broke the parse; caught by tests, reworded

#### Iteration 5
**New findings:** 1 BLOCKER, 2 WARNINGs, 4 NITs
- [BLOCKER] iteration 4's sweep readdir'd runners/<provider> before anything created it: FIRST install on a fresh machine (the exact #979 scenario) died ENOENT, masked by test-order coupling --> FIXED (mkdir before sweep) + a dedicated pristine-root test
- [WARNING] fresh-root path untested --> FIXED (the pristine-root test)
- [WARNING] synthetic installed answer claimed the pinned version for a possibly-legacy binary --> FIXED (no version field; tested)
- [NITs] POST body drained; one-chmod posture explained; swap comment states the re-install instant honestly; deliberate validation-order change documented

#### Iteration 6
**New findings:** 0 BLOCKERs, 2 WARNINGs, 4 NITs
- [WARNING] no architecture guard (Intel Mac: 114MB down, fail at prove with a symptom) --> FIXED (arch in manifest, refusal names the cause; tested via arch seam)
- [WARNING] real download() branches unexercised --> FIXED (injectable transport; redirect, non-200, redirect-storm tested with real Readable streams; download exported)
- [NITs] masking guard generalized onto the resolver's overridden flag; just-installed Confirm returns the truthful proved job (resetForTests added, house pattern); plan field-name drift fixed; stale open-ruling header updated. Pre-check refusals not recorded in jobs DEFERRED (POST body is the refusal channel; recording hostile names would grow state per probe)

#### Iteration 7
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged.**
- TAKEN: add-route gate also refuses during a live job's proving window; redirect-storm wording names the cause
- DEFERRED: stall-timer branch unit test (review-verified three-line path vs a timer-driven slow test); the POST-vs-poll refusal channel note (already documented)

### Final Ledger (themes)

| # | Iter | Category | Theme | Status |
|---|---|---|---|---|
| 1 | 1 | BLOCKER | prototype-chain provider from URL | FIXED |
| 2 | 5 | BLOCKER | fresh-machine ENOENT in the iteration-4 sweep | FIXED |
| 3-13 | 1-6 | WARNING | trust chain, state machine, concurrency, honesty of reported facts | 10 FIXED, 1 reshaped as tested coverage |
| 14 | 1 | CONVENTION | plan em dash | FIXED |
| 15-34 | 1-7 | NIT | messages, comments, hygiene, test isolation | 16 FIXED, 4 DEFERRED with reasoning |

### Deferred (all with reasoning recorded in the plan)
- HEAD-header duplication (matches the file's own sibling handlers)
- Pre-check refusals not recorded into the jobs map (POST is the refusal channel; hostile-name state growth)
- Stall-timer unit test (review-verified; timer test buys a slow suite)
- Two boards racing the final pkg swap (lockfile deferred until that configuration is real; window minimized by whole-tree swap)

### Strengths (recurring across all 7 reviews)
- The supply-chain posture called sound end to end by every reviewer: pinned frozen manifest, vendor-published sha512 streamed and verified before unpack, refused bytes never unpacked, arch guard before bytes move, prove before installed, symlink torn down on a failed prove.
- The consolidation onto ONE resolver removes the dual-hardcoded-default root cause of the original dead end; grep-verified single remaining legacy literal.
- Test quality: pristine-root fresh-machine test, proving-window race pinned at the exact moment presence lies, injectable-transport download tests, real-tar fixtures of the real vendored layout, every root sandboxed before require.
- The plan's live-proof record (real 114,152,335-byte download, verified checksum, real binary answering codex-cli 0.149.1 through the symlink) with honest amendments where the original plan text drifted.
