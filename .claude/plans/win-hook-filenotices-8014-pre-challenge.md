---
pre_challenge: true
method: challenge-loop
branch: win-hook-filenotices-8014
diff_hash: e60cefbbce48e9b6904ee8efec5a78a01465523817b0ba1b042dd6ef649077d4
validation: passed
subdir_audit: passed
timestamp: 2026-11-05T07:31:39Z
iterations: 2
converged: true
---

# Pre-PR review proof: win-hook-filenotices-8014

**Iterations:** 2
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/win-hook-filenotices-8014.md

## Rounds

#### Iteration 1
- Round 1 (blind reviewer): 0 BLOCKER, 3 WARNING, 4 NIT. Fixed: W1 `done` lets go of stdin, so a stdin that never ended no longer waits for the 2 s backstop on top of the 5 s one (13 s worst case kept under the 15 s hook ceiling); comments corrected. W2 new engine/kosmos-report-hook.exit-8014.test.js spawns the real hook against a fake loopback board that answers the board proof: exit 0, the JSON whole, under 2 s; a never-closing stdin ends at about 5.1 s. Control: with the entry put back to process.exit, that test fails on this box with the same libuv assertion (exit 3221226505), so it reproduces the crash without a real board. W3 a listener that fails the proof gets no notices call (test added). NIT1 test message reworded; NIT4 comments. Not taken: NIT2 the two-sessions race on the mark (duplicate notices at worst, never lost; the Mac has it too); NIT3 a rare backstop exit could still hit the assertion, as every run's process.exit did before.

#### Iteration 2
- Round 2 (blind reviewer): 0 BLOCKER, 1 WARNING, 3 NIT. Converged. Fixed: W1 keepCopy and toolFailed now cancel the answer's body (they never read it): with the natural exit, a body that never finished held an edit's hook 2 s and fell to the backstop process.exit. New spawn test with a board that stalls the keep-copy body: 153 ms with the fix; control without it fails at 2107 ms. NIT2 the never-closing-stdin bound widened to 6990 ms (the hang lands at 7000 or later). Not taken: NIT3 the 5 s test runs every suite (it is one file); NIT4 an unrecognised 200 leaves the ack file alone, as the CLI does (parity).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 0 | BLOCKER | engine/kosmos-report-hook.js | SELF | the new hook died on every prompt on exit (libuv UV_HANDLE_CLOSING, exit 127), found live on the box | FIXED | natural exit, process.exit only as a 2 s backstop |
| 2 | 1 | WARNING | engine/kosmos-report-hook.js | BRANCH | a never-closing stdin waited 2 s more than before | FIXED | stdin released in done |
| 3 | 1 | WARNING | engine/kosmos-report-hook.js | BRANCH | the exit change had no test | FIXED | spawn test against a fake board; reproduces the crash with process.exit |
| 4 | 1 | WARNING | engine/kosmos-report-hook.filenotices-8014.test.js | BRANCH | a failed proof before the notices call untested | FIXED | test added |
| 5 | 2 | WARNING | engine/kosmos-report-hook.js | BRANCH | unread keep-copy/toolfail bodies held the run to the backstop | FIXED | bodies cancelled; stalled-body spawn test with control |
| 6 | 1 | NIT | engine/kosmos-report-hook.js | BRANCH | two sessions of one agent can race on the mark | DEFERRED | duplicates at worst, never lost; Mac has it too |
| 7 | 1 | NIT | engine/kosmos-report-hook.js | BRANCH | a rare backstop process.exit could still hit the assertion | DEFERRED | as every run's process.exit did before |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Fixed: test message wording, stale entry comments, the timing bound.
- Deferred: the mark race, the backstop exit, the 5 s test's run time, an unrecognised 200 leaving the ack file (parity with the CLI).

### Validation
- On the Windows box: all engine/kosmos-report-hook*.test.js plus engine.reachable, fixture-discipline, no-name-refs, windows-tests-1777, win32-separator-guard, windows-coupling-audit: 133/133.
- Live against this box's board: UserPromptSubmit, Stop, SessionStart and an Edit's PreToolUse exit 0.
