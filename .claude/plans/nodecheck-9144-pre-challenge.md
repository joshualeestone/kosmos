---
pre_challenge: true
method: challenge-loop
branch: nodecheck-9144
diff_hash: f3ff2b6f6761fc41759d6c4e4accc3edca126a94fe5d2c4c9e0cb16fc0058bd6
validation: passed (this Mac, tools/run-tests.sh alone, KOSMOS_SUITE_MAX=1) at f633305be9, ended 18:43 CST: 31,536 node tests 0 failed, all four shell shards status 0. On the Windows box (Homer, 17:40): Kosmos.exe rebuilt and signed from 59856a8a99 (verify-launcher OK, signature Valid), and tools.win-launcher-runtime-9144 plus tools.win-launcher-native passed 43/43 with none skipped, so the RepairRuntime probe ran. Unmeasured: a normal Start-menu launch of the rebuilt exe (it would touch the live install); it runs at the next Windows cut's V2.
subdir_audit: passed
timestamp: 2026-11-27T00:44:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, sonnet, opus), the last over the whole branch.
**Converged:** Yes. Round 3 called it ready for the Windows proof once its two important points were fixed. They were, and the proof passed.

### Iteration 1 (opus)
- [IMPORTANT] the repair targeted this folder's runtime, but the file that crashed on the box was the logon task's ANCHORED copy (<LOCALAPPDATA>\Kosmos\runtime\node.exe), which ensureAnchored never replaces at the same size --> FIXED (both checked; the anchored copy is repaired from this folder's)
- [IMPORTANT] a runtime Windows will not start was called damaged and renamed --> FIXED (damaged means it ran and ended non-zero)
- [IMPORTANT] slow-board false alarms after a hand-off --> FIXED (only a FAILED anchored check is said)
- [IMPORTANT] No ended the launch --> FIXED (fail open)
- [IMPORTANT, test] the probe's creation-time key was defeated by NTFS tunnelling --> FIXED (file ID)
- [NIT] crash dialog, two launches at once, a missing runtime unsaid, sha mismatch advice --> FIXED

### Iteration 2 (sonnet)
- [IMPORTANT] a repair could downgrade the anchored runtime --> FIXED (same size only, SameRuntimeVersion)
- [IMPORTANT] a repair could race an update --> FIXED (UpdateUnderWayHere)
- [IMPORTANT, test] the file-ID struct layout was off --> FIXED (Pack 4)
- [NIT] console fail open, rename retry, stale copy sweep, notice wording --> FIXED

### Iteration 3 (opus)
- [IMPORTANT] File.Copy keeps the source's last-write time, so the sweep could delete another launch's copy --> FIXED (stamped)
- [IMPORTANT] AnchoredRuntimePath could throw out of a healthy launch --> FIXED (try)
- [NIT] update asked again after a Yes; a failed repair goes on; console hint for the anchored copy --> FIXED
- [NIT, accepted] the C# 5 test guard is narrow (the compile on the box is the real guard); the after-hand-off launcher lingers up to 90 s
