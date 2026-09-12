---
pre_challenge: true
method: challenge-loop
branch: win32-swap-atomic
diff_hash: 9342a9f1fd8716378686ac17c66768b9f5580c4d596d454b623f5a9a6acd8d11
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T22:30:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, then sonnet).
**Converged:** Yes. Round 2 found NO NEW FINDINGS.
**Fixed:** every round-1 finding (1 convention, 2 test gaps, 2 nits).
**Asked (awaiting user):** 0.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/win32-swap-atomic-pre-challenge.md'`, computed with node over git's
own output. It was taken at `dd24172e` (70,573 bytes), after rebasing onto origin/main
`cb5aa831`. That rebase was clean, and main had changed only `package.json`'s version
since the review base `f5078386`. The pre-challenge-gate hook is not installed on this
Windows box, so the recipe is written out here.

Before review round 1, the coordinator asked for both boot-shim writes to be atomic
too, since a torn shim stops the board or every agent at logon just as a torn pointer
does. That went in as `7fec22d9`, and round 1 reviewed it.

**Validation of record** (this box, the anchored `node.exe` v24.19.0, via PowerShell):

| Files | Result |
|---|---|
| The plan's 10 files: `engine/win32swap`, `win32anchor`, `win32anchor.world-1704`, `win32board`, `win32board.world-2628`, `platform-gate-wiring`, `win32-separator-guard`, plus root `engine.reachable`, `one-derivation`, `fixture-discipline` | **117/117** at `dd24172e` |
| `engine/win32swap.test.js` alone, 3 runs (reviewer, round 2) | 25/25 each; the held-handle timings were stable |

No suite failed, so there was nothing to compare by name against main.

**Control runs** (all on a `git archive` copy, never the worktree): 12 of 12 mutations
went red.

| Mutation | Went red |
|---|---|
| The pointer write back to plain `writeFileSync` | 5, including held-past-budget |
| No fsync | 1 |
| The temp not removed on failure | 3, including held-past-budget |
| A plain rename with no retry | 3 (both held arms, the EPERM stub) |
| The short-write loop removed | the short-write arm |
| `'w'` instead of `'wx'` | the `wx` arm |
| Each boot shim back to a plain write (×2) | 2 each |
| The temp outside the target's folder | 5 |
| A fixed temp name | 1 |
| The type guard removed | the type-guard arm |
| A plain-write fallback after the rename gives up | 3, including held-past-budget |

### Iteration 1 (opus)
- **[CONVENTION + TEST-GAP]** The plan said Node's `FILE_SHARE_DELETE` means a reader
  holding `engine-path` cannot block the replace. The reviewer measured that as FALSE
  on Windows 11 26100: a rename over a file fails with EPERM while ANY handle is open on
  it.
  - A hold of 300 ms succeeds after ~332 ms, riding the retry.
  - A hold of 2.5 s throws after ~1 s, with the old bytes whole and no temp left.
  - Under tight-loop readers, plain `writeFileSync` never failed, but each reader saw
    hundreds of empty (torn) reads.

  **Kept as a deliberate trade:** fail closed with the old file whole, no fallback, and
  the retry budget unchanged. The plan and the `writeFileAtomic` comment now state the
  measured behaviour. Two Windows-only arms have a child process hold the target, one
  released within the budget and one held past it; the child is killed in a `finally`,
  with a 30 s self-exit backstop.
- **[TEST-GAP]** The short-write loop and the `'wx'` flag each survived their
  revert. Both now have arms: a half-write stub, and an `openSync` flag assertion.
- **[NIT]** A `Uint8Array` was written as the text `"104,105"`. It now throws a
  TypeError before any file is touched.
- **[NIT]** A read-only or directory target spends the ~1 s retry before failing. That
  gets a plan line only; neither happens in the anchor.
- **Verified clean:** the move is verbatim, apart from `NODE_NAME` becoming
  `path.basename(nodeAt)`; no fd leak; unique temp names; no caller outside
  win32anchor/win32board; the build script ships the new module; the tests are
  sandboxed.

### Iteration 2 (sonnet): NO NEW FINDINGS
- All 4 round-1 items were re-verified in the code at HEAD, not from the report.
- The type guard runs before the temp name or any `fs` call.
- The held-handle arms have no leak path. On timing, `pauseSync` is a real
  `Atomics.wait`, so load only widens the margin.
- No orphaned holder processes were left after 3 runs.
- A fresh pass over the whole branch found nothing new.
