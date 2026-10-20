# hookguard-6601: only an installed board wires this computer's shared Claude hooks (kosmos#6601)

## Goal
Found on the Windows box 10-19: a second board started from a worktree, on its own port and data folder, rewrote the
reporting hooks in the real user Claude settings.json to point at the worktree's engine. Every Claude session on the
computer reads that file, so a test board can silently repoint every live agent's reporting at throwaway code.

## Mechanism (read from origin/main)
- accounts.wireDefaultHooks (win32 only; setup.sh owns the Mac) writes trust.defaultAgentSettings(), the real
  ~/.claude/settings.json unless a sandbox seam is set, with reporthook.hookScriptPath(), which resolves beside the
  RUNNING engine (__dirname). Two callers: the board at start (server.js wireDefaultHooksTry) and each default-account
  agent launch (win32launch.preacceptClaudeFirstRun). A worktree board therefore points the shared hooks at itself.

## Call
wireDefaultHooks writes only when this board is an installed bundle: win32board.bundleRoot() non-null, the question
the board already asks before registering its logon task (null for a source checkout and for a build in the
updater's folder; a from-source board "legitimately has no login job"). Otherwise it skips with a reason, writes
nothing, and the board's start says why in one line on win32. `bundleRoot` is injectable like platform/script/node.

## Rejected
- Requiring test boards to set AGENT_WORKFORCE_CLAUDE_SETTINGS: forgetting it is the bug.
- Also requiring the bundle to be the one win32anchor's engine-path pointer names: an update may move the engine
  directory before the pointer is refreshed, and a check that skips wiring after an update is a worse bug than this
  one. Not measurable here (no Windows box).
- Gating on a non-default port or data folder: the harm is the script path, not the folder; an installed board on
  another folder writes the installed script, which is right.

## Weakest premise
That bundleRoot() is null for every way a test board is started. True for a source checkout or worktree (no
runtime/node.exe beside app/server.js). A second BUILT bundle extracted elsewhere and started as a test board would
still pass and still wire the shared settings with its own path. Recorded on the card as not covered.

## Mac (the card's open question)
Read, not measured on a Mac board: at start a Mac board does not write the shared settings (wireDefaultHooks skips
off win32; a test pins it). accounts.prepare (adding or reconnecting an account) wires THAT account's folder with the
running board's script, so a source board adding an account into the real home would point that account's hooks at
its own code. Filed as a follow-up, not built here.

## Tests
engine/accounts.wiredefaulthooks-5612.test.js: the existing 11 calls pass the sandbox as the bundle root (an installed
bundle); new: a non-installed board skips, says why, and leaves an existing settings file byte for byte (control:
the installed bundle wires first); with nothing injected, this source checkout skips and writes no file. A mutant
with the gate removed reds both new tests.

## Round 1 (opus): no blocker, 2 warnings, 3 nits
- WARNING: the status line writer (allowance.ensureStatusLine, via accounts.prepare and the usage-reading route) has the
  same flaw. Filed onto #6713's scope (out of this card's writer).
- WARNING: the comment read as complete coverage. FIXED: it names the second-built-bundle gap.
- NIT: the "nothing injected" test cannot tell a checkout from a bundle on a Mac (bundleRoot joins with path.win32).
  FIXED: its comment says so; the Windows runner (tools/windows-tests.js) does.
- NIT: win32launch's comment said the board wires them at start. FIXED: an installed board.
- NIT (unverified): the engine-path pointer has the same class of risk unless the test board set AGENT_WORKFORCE_DATA.
  Recorded on #6601 for whoever ran the 10-19 board.

## Round 2 (sonnet): no blocker, 2 warnings, nits
- WARNING: the launch-time wiring is gated too, so a source board's own agents are never wired (they report by
  scraping). Intended (the safe side, and the board's start says why); FIXED: said in the comment and here.
- WARNING: the win32board lookup sat outside the try, breaking "returned, never thrown". FIXED: inside a try; a failure
  returns a refusal with a fixed sentence.
- NITs not changed: two long lines; the test's 'worktree' substring check is redundant beside the byte comparison.

## Round 3 (opus): no blocker, 1 warning, nits
- WARNING: the new refusal path (the lookup throwing) had no test. FIXED: bundleRoot may be injected as a function;
  a test makes it throw and asserts { wired:false, skipped:false }, a fixed sentence without the error text, and no
  file written. Mutant (the catch rethrows) reds it.
- NIT: the launch-path comment said a source board's agents get no hooks; where the installed Kosmos already wired the
  shared file they run its hook. FIXED: the comment says exactly that.
- NITs not changed: win32launch is silent on a skip (the board's start says it once); an empty-string bundleRoot skips.
