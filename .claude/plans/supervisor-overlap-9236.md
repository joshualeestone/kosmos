# supervisor-overlap-9236 (kosmos#9236)

**Problem.** On Windows a board restart could run the old and new supervisor's Claude side by side for about a second. Homer measured it on 0.8.29: in 2 of 15 restarts the old supervisor launched `claude --resume <old id>` 0.3 to 0.4 s before the new one started its Claude, and both lived 0.7 to 1 s. The old supervisor asks `mayStart()` (is my host alive) first, then runs `claude agents --json` (up to 15 s); the restart ends its host during that lookup, and the launch went ahead on the stale answer.

**Change.** `startOnce` asks `mayStart()` again after the lookup, right before the launch, with nothing slow in between. `send` refuses (a definite no, nothing written) once the task is ended, since the old supervisor can still hold the channel pipe for a moment while the new one starts. The Codex, Gemini and Grok supervisor (win32codexsup.js) refuses a send the same way; its start has no slow lookup, so the launch half does not apply to it.

**Rejected.** Making the board wait for the old supervisor to exit before starting the new: it slows every restart to cover a race that one check closes.

**Measured.** win32supervisor + win32codexsup tests 96/96; every test file naming either, plus windows-tests-1777: 1210 pass, 0 fail, 14 skipped. Each of the three new tests is red with its check removed (in place, then restored).

**Weakest premise.** The window between the second check and the spawn inside `launcher` (token mint, argv build) is not closed; it is milliseconds against the lookup's seconds. Only Homer can confirm the 2/15 drops to 0 on a real Windows box.
