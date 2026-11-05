# kosmos#8014: the Windows report hook hands an agent its file-owner notices

**Posture:** production

## Goal
The win32 twin of #8011 (#7989 slice 3). On UserPromptSubmit, engine/kosmos-report-hook.js asks the board for the file-owner notices it kept for this agent and prints the hook's JSON, so Claude Code adds it as context for the turn. Same contract as install/kosmos-report-hook.sh.

## Done when
1. At UserPromptSubmit, after the working report, the hook POSTs `/api/file-notices/take?as=hook&from_pane=&ack=<ids>` (1 s cap, listener proved first) and prints only a `{"hookSpecificOutput":...` answer.
2. At most once per 300 s per agent, keyed `agent-<first 16 hex of sha256(agent token)>`; with no usable agent token there is no call; a mark that cannot be written means no call; the ids handed over are kept beside the mark and sent back next time.
3. No other event asks, and every failure is silent with exit 0.

## Design
- **The route directly, not the CLI**, as the hook already does for keep-copy: a node hook spawning node per prompt would add a process start to the turn. Same URL, ack rules and parse as `kosmos file-notices --hook --ack-file` in tools/windows/kosmos-cli.js.
- **Keyed by the token the hook would send** (`agentToken`, hex only). A malformed token is not sent, so it is not a key either: the call would go out unsigned.
- **No pane on native Windows**, so the Mac's pane fallback does not apply: no token, no call (the Mac makes no call with neither token nor pane).

## Found on the box: the hook died on every prompt with this change (exit 127)
Live against this box's board, the new hook died on every UserPromptSubmit on exit: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`, exit 127 (node 24.19.0). Main's hook exits 0.

Narrowed by experiment (scratch copies, then a 10-line standalone script):
- The second listener proof alone: exit 0. The notices fetch alone, no proof: 127. So the fetch, not the proof.
- A JSON body, no abort timer, `connection: close`: all still 127. The fetch to a dead port: 0. So it needs a real answer.
- Standalone: one request then `process.exit`: 0. `/api/report` then any second request (notices or `/api/status`) then `process.exit`: 127, either order. Two notices requests: 0.
- The same two requests with a natural exit (`process.exitCode`, no `process.exit`): 0, about 250 ms.

**Fix:** the entry sets `process.exitCode` and lets node end on its own, with an unref'd 2 s timer calling `process.exit` as the backstop. Measured afterwards on the live board: UserPromptSubmit 5/5 exit 0, plus PreToolUse Edit, SessionStart and Stop exit 0 (one Stop ran 2.2 s, so the backstop fired once, and exited 0).

**Weakest part, named:** I do not know why main's PreToolUse Edit (keep-copy then a report, also two requests) exits 0 while report-then-notices does not. The fix does not depend on knowing: it removes `process.exit` from the normal path, which every crashing case needed. A forced backstop exit after 2 s could in principle still hit it, as today's every-run `process.exit` could. (Round 1 added engine/kosmos-report-hook.exit-8014.test.js, a spawned hook against a fake board that answers the proof; it reproduces the crash with process.exit on this box. macOS does not crash, so there it checks only the exit code, the output and the timing.) One live SessionStart took 2.4 s; four more took about 270 ms, and main's hook also took 2.4 s once, so that was the board answering slowly, not the backstop.

## Tested
- engine/kosmos-report-hook.filenotices-8014.test.js, 8 tests mirroring report-hook-filenotices-7989.test.js plus the ack round trip and a malformed token. Control: 4 of 8 fail against origin/main's hook (the 4 that pass there are the no-call cases).
- All engine/kosmos-report-hook*.test.js (62), plus engine.reachable, fixture-discipline, no-name-refs, windows-tests-1777, win32-separator-guard and windows-coupling-audit: pass.

## Review rounds
- Round 1 (blind reviewer): 0 BLOCKER, 3 WARNING, 4 NIT. Fixed: W1 `done` lets go of stdin, so a stdin that never ended no longer waits for the 2 s backstop on top of the 5 s one (13 s worst case kept under the 15 s hook ceiling); comments corrected. W2 new engine/kosmos-report-hook.exit-8014.test.js spawns the real hook against a fake loopback board that answers the board proof: exit 0, the JSON whole, under 2 s; a never-closing stdin ends at about 5.1 s. Control: with the entry put back to process.exit, that test fails on this box with the same libuv assertion (exit 3221226505), so it reproduces the crash without a real board. W3 a listener that fails the proof gets no notices call (test added). NIT1 test message reworded; NIT4 comments. Not taken: NIT2 the two-sessions race on the mark (duplicate notices at worst, never lost; the Mac has it too); NIT3 a rare backstop exit could still hit the assertion, as every run's process.exit did before.
- Round 2 (blind reviewer): 0 BLOCKER, 1 WARNING, 3 NIT. Converged. Fixed: W1 keepCopy and toolFailed now cancel the answer's body (they never read it): with the natural exit, a body that never finished held an edit's hook 2 s and fell to the backstop process.exit. New spawn test with a board that stalls the keep-copy body: 153 ms with the fix; control without it fails at 2107 ms. NIT2 the never-closing-stdin bound widened to 6990 ms (the hang lands at 7000 or later). Not taken: NIT3 the 5 s test runs every suite (it is one file); NIT4 an unrecognised 200 leaves the ack file alone, as the CLI does (parity).
