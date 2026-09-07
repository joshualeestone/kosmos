---
pre_challenge: true
method: challenge-loop
branch: scan-tcc-hatch-2125b
diff_hash: a3b004778ec556a15fde5e5a8c57ae8c648ad08e0e678ca742ea906189551d45
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T08:43:44Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 blind challenge agents
**Converged:** Yes — iteration 5 returned zero BLOCKER/WARNING/CONVENTION findings (5 STRENGTHs + 1 NIT that was a re-find of a deferred item)
**Total findings:** 2 BLOCKERs, 9 WARNINGs, 0 CONVENTIONs, ~15 NITs
**Fixed:** 2 BLOCKERs + 9 WARNINGs + 12 NITs | **Deferred:** 3 NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 BLOCKERs, 4 WARNINGs, 3 NITs
- [BLOCKER] native-app/main.swift — symlinked-DIRECTORY descent (walk could be steered out of the TCC tree via a symlink in a user-writable folder) --> FIXED (lstatType guard, proven by tools/test-scan-hatch-symlink-2125b.sh)
- [BLOCKER] native-app/main.swift — symlinked-FILE read (out-of-tree bytes into a preview) --> FIXED (lstatType guard)
- [WARNING] engine/discover.js — merge ignored maxCandidates/MAX_IMPORTABLE row caps --> FIXED
- [WARNING] engine/discover.js — defaultTccScan bridge had no unit test --> FIXED (real-bridge test)
- [WARNING] native-app — Swift walk only source-grep tested, no behavioral CI --> FIXED (compiled shell test, wired into test:shell)
- [WARNING] engine/discover.js — result nonce echoed but not verified (freshness-only) --> FIXED (module-state tccPendingReq nonce match)
- [NIT] merge dedup keys literal vs realpath --> DEFERRED then resolved as a documented invariant (iter5)
- [NIT] hatch removed the claim before writing the result (redundant walk) --> FIXED (write-before-remove)
- [NIT] plan-doc depth/instr drift --> FIXED

#### Iteration 2
**New findings:** 2 WARNINGs, 4 NITs. **Duplicates confirmed resolved:** the iter1 fixes held.
- [WARNING] defaultTccScan/server.js — no nativePresent/timeout fallback -> perpetual scanning:true --> FIXED (nativePresent gate + 12s give-up bound; getImportScan caches the completed result)
- [WARNING] native-app — confused-deputy: hatch walked whatever roots the request named --> FIXED (allowlist clamp to the 3 TCC roots; AGENT_WORKFORCE_SCAN_ALLOW_ROOTS test seam)
- [NIT] lstat->open TOCTOU --> FIXED (O_RDONLY|O_NOFOLLOW|O_NONBLOCK)
- [NIT] scan-request written non-atomically --> FIXED (tmp+rename)
- [NIT] loose-file bounded count can diverge --> DEFERRED (cosmetic "there may be more" hint)
- [NIT] ScanBudgets maxDirs default drift (8000 vs 6000) --> FIXED (aligned)

#### Iteration 3
**New findings:** 2 WARNINGs, 3 NITs.
- [WARNING] engine/discover.js — TCC_UNAVAILABLE's bounded.tccUnavailable dropped by the merge (a hatch failure looked like a complete, cached, TCC-less list) --> FIXED (propagated through the merge to the returned bounded)
- [WARNING] tools/test-scan-hatch-symlink-2125b.sh — the confused-deputy REFUSAL arm was untested --> FIXED (negative arm: a non-allowlisted root yields zero rows)
- [NIT] hatch emitted rows past the engine's caps (bloated JSON) --> FIXED in iter3, then REVERTED in iter4 (see below — the cap under-reported)
- [NIT] AGENT_WORKFORCE_SCAN_ALLOW_ROOTS seam fully replaces the guard --> DEFERRED (matches the codebase's established test-seam pattern; app-env control already implies full compromise)
- [NIT] PENDING_MS vs GIVE_UP_MS relationship unclear --> FIXED (comment: PENDING_MS >= GIVE_UP_MS)

#### Iteration 4
**New findings:** 1 WARNING, 4 NITs.
- [WARNING] native-app/main.swift — the iter3 raw output caps counted RAW emitted heads, not DETECTED agents, so a folder with many non-agent .md files would drop real agents past the cap --> FIXED (REVERTED the caps; emission is bounded by the READ budgets, parity with the engine; the engine merge caps DETECTED rows)
- [NIT] boundedDirs mis-attribution from the row cap --> FIXED (resolved by the revert)
- [NIT] give-up branch untested --> FIXED (AGENT_WORKFORCE_TCC_GIVEUP_MS override + a test that proves a crashed hatch completes the scan)
- [NIT] store.ROOT throw returned null before tccPendingReq set -> scanning:true stranded --> FIXED (return TCC_UNAVAILABLE)
- [NIT] transient nativePresent=false during app first-launch caches "couldn't scan" ~30s --> DEFERRED (surfaced via tccUnavailable, self-heals, bounded to first-launch)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT.
**Converged** — the only finding was a re-find of iteration 1's deferred dedup-key NIT; resolved by pinning the no-overlap invariant in a code comment. Five STRENGTHs confirmed the never-hangs state machine, the give-up test soundness, the read-budget emission bounding, the symlink/confused-deputy guards, and the single-sourced detection.

### Final Ledger (BLOCKERs + WARNINGs)

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | BLOCKER | symlinked-dir descent escape | FIXED |
| 2 | 1 | BLOCKER | symlinked-file read escape | FIXED |
| 3 | 1 | WARNING | merge ignored row caps | FIXED |
| 4 | 1 | WARNING | defaultTccScan untested | FIXED |
| 5 | 1 | WARNING | Swift walk no behavioral CI | FIXED |
| 6 | 1 | WARNING | nonce not verified | FIXED |
| 7 | 2 | WARNING | perpetual scanning (no fallback) | FIXED |
| 8 | 2 | WARNING | confused-deputy roots | FIXED |
| 9 | 3 | WARNING | tccUnavailable dropped by merge | FIXED |
| 10 | 3 | WARNING | refusal arm untested | FIXED |
| 11 | 4 | WARNING | raw caps under-report agents | FIXED (reverted) |

### Deferred (with reasoning)
- Loose-file bounded.importable count divergence — cosmetic "there may be more" hint, not an agent drop.
- AGENT_WORKFORCE_SCAN_ALLOW_ROOTS fully replaces the allowlist — matches the codebase's test-seam pattern (AGENT_WORKFORCE_SCAN_ROOTS); control of the app's launch env already implies full compromise.
- Transient nativePresent=false during app first-launch caches "couldn't scan" for ~30s — surfaced via tccUnavailable, self-heals, bounded to first-launch.

### Strengths (across all iterations)
- The no-symlink-escape guard is proven BEHAVIORALLY (compiled binary vs symlinks into /etc, with positive + negative controls), not just by source grep.
- Detection single-sourced via folderRow/looseRow — the in-engine walk and the hatch merge cannot diverge on what counts as an agent.
- The non-blocking defaultTccScan state machine has no permanent-stuck state (nativePresent gate, give-up bound, nonce-matched consume-on-read, no-cache-of-partials).
- Confused-deputy allowlist + O_NOFOLLOW close the privileged-deputy attack surface.
