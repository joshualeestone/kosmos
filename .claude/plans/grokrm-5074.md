# grokrm-5074: the Grok win32 test's cleanup outlasts a just-run exe

Card: joshualeestone/kosmos#5074 (sibling of #5010, which fixed the same race in the shims test only).

## Problem
Main Windows run 37051936123: "win32: Grok unpacks ... and is vouched for" passed every assertion, then its last line
`clear('grok')` threw EPERM (syscall rm). The test's grok.exe is a copy of node.exe the prove step has just run;
Windows can hold a just-run, just-written exe briefly (image lock or a scan of a new exe).

## Decision (revised after review round 1)
Move #5010's tested `removeTree` (retry EPERM/EBUSY/ENOTEMPTY/EACCES, pauses 250 ms x attempt, 8 tries, then a named
throw; says on stderr when it needed a retry) from tools.windows-kosmos-shims-570.test.js into
test-support/remove-tree.js, its five cross-platform tests into test-support.remove-tree.test.js, and use it for every
removal in engine/runners.win32-gemini-grok.test.js and engine/runners.win32-codex.test.js.

Why not rmSync's maxRetries (my first build): review round 1 read Node's RmSync source and found that on win32 this
hold surfaces as permission_denied, which only joined the retry set in Node 26.8 (before that the retry also slept
0 ms for retryDelay 100). CI floats on node-version '26' (26.10.0 in run 37051936123), so it works today and silently
stops working on any older 26.x. Reported from the reviewer's source reading; I did not re-measure it. A retry we own
does not depend on it, and it is already tested on every platform.

Why codex too: its "win32 A" test runs the unpacked codex.exe, kills it, waits 500 ms, then removes the tree with a
bare rmSync: the strongest hold case of the set. Same class, same file family, same fix.

Rejected: catching and ignoring cleanup errors (hides a real leak).

Codex "win32 A" (review round 5): when an assertion in its body already failed, a cleanup that gives up is written
to stderr and the assertion stays the red; with no body failure the cleanup error still fails the test. It is the
strongest hold in the set and runs only on Windows CI, so losing the real assertion would make a red hard to read.
The grok test's test.after does the reverse on purpose (its cwd-leak assertion runs in a finally after the cleanup):
both outcomes are red, and the leak is the one nothing else would show.

Weakest premise: the hold clears within removeTree's budget (about 7 s). An antivirus scan could take longer; the
throw then names the folder, so the red reads as cleanup.

Not changed: engine/win32apply.test.js and engine/win32anchor.test.js use maxRetries inside a try/catch that swallows
errors, so on older Node they were silent no-ops rather than reds. Left as they are (no red seen).

## Other bare removals in the win32 test family (review round 2, read, not changed)
- engine/win32board.reanchor.test.js:34/117/137: its node.exe is a text file that never runs; spawnSync runs
  process.execPath, outside the removed folder. No hold.
- engine/win32apply.test.js:1061/1085: removing c.root / c.work IS the scenario (a folder gone), not cleanup after an
  exe ran there. No hold.
- win32apply:45, win32board.world-2628:45, win32anchor:72: maxRetries inside a swallowing try/catch; a hold there
  leaks a folder, never reds a run. Left.

## Product side (checked, no change)
engine/runners.js already retries rename/rm on win32 for EPERM/EBUSY/EACCES (renameRetrying / rmRetrying, ~1084-1110)
and its other removals fall back to a later sweep. So a person removing Grok right after install is covered.

## Verification
- removeTree's own tests (test-support.remove-tree.test.js) run everywhere: run them when no suite is live.
- The grok and codex tests are win32-only (skipped on macOS/Linux), so local runs cannot exercise them. The PR's Windows CI shows no
  regression; the race is intermittent (1 red in 13 main runs), so closing needs several clean Windows runs.

## Review (challenge loop, blind, alternating Opus/Sonnet)
Converged at iteration 7 (Opus): no BLOCKER/WARNING/CONVENTION. Fixed along the way: maxRetries replaced by the
shared removeTree (1: Node-version dependence); codex added (1); the moved tests listed for the Windows job (3);
the grok after-hook leak check in a finally (4); win32 A keeps its assertion as the red (5); comments and plan
brought in line with both (6). Deferred with reasons: the other bare removals in the win32 family (2, listed above).
NIT left: removeTree's stderr prefix changed from "#5010:" to "test cleanup of" (nothing reads it).

## Status
- Full validation queued detached 18:36 (val-grokrm-5074.log). removeTree's five tests have not been run by me yet:
  that validation runs them on macOS; the PR's Windows job runs them there.

