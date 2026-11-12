# win-tokenguard-5664: the token-only guard on Windows, step A (kosmos#5664)

**Posture:** production

## Decision this builds
Splinter's go on the card (2026-11-11 13:30 CST): step A, under four conditions.
1. The Windows wording says exactly what Linux says (file tools only, the shell is not sandboxed). No stronger claim.
2. The guard writes the resolved real path, never only a junction's own path; a test proves it.
3. Windows-runner tests cover the measured cases: case-blind matching, a junction, an 8.3 name, `( )` in a path, and
   `[ ]` still refused.
4. The #4752 owner told that native twins match nothing (done on #4752).

Measured on Windows (the card): Claude Code 2.1.319's `//c/...` Read and Edit rules hold, case-blind, through junctions
and 8.3 names when the rule names the real path; a rule on a link's own path covers nothing; native `//C:\...` rules
match nothing; `( ) { } !` are literal, `[ ]` is a character class.

## What lifting the refusal alone would have done (found by probing the branch on the box)
1. **Every Windows path read as uncarriable** in the import scan: `IMPORT_RULE_SYNTAX` (which includes `\`) was tested
   on the native path, so any instruction-file import (e.g. ~/.claude/CLAUDE.md's) made the guard not whole.
2. **The PATH part read as covered**: `launchPathDirs` returned nothing on win32 with no reason, so the guard would
   have said whole while nothing the agent's next start runs from was covered. Linux covers that part.
3. **A junction's own path only**: with the data folder reached through a junction, the token rule named the junction
   path (measured to protect nothing), not the real folder.

## Change
- `guardTokenOnlyFolderNow`: the Windows refusal (review 24) is removed; its comment now records the measurement and
  what is not measured (shares, mapped drives, non-NTFS volumes, later Claude Code versions).
- `launchPathDirs` on win32: names the part it does not cover ("on Windows Kosmos does not cover the folders on this
  PATH yet"), so the guard is written and says it is not whole (fixes 2).
- Import check: on win32 the backslash is tested as the separator it is (fixes 1). Mac and Linux unchanged.
- `withRealTwins` (new, win32 only): every Read/Edit rule whose literal part (before its first `*`) resolves elsewhere
  gets the same rule on the real path beside it; a real path the rules cannot carry is named (not whole), never written
  (fixes 3). Case-only differences add nothing (Claude Code is case-blind on Windows).
- Tests: `engine/tokenguard.win32-5664.test.js` (auto-selected for the Windows job by its name): pure arms on any host;
  filesystem arms on Windows (written in the //c/ form with no native form and no sandbox block; junction to real path;
  8.3 to long path; `( )` and `[ ]` refused with nothing written; an import covered). The two tests that pinned the old
  refusal (`engine/boardkeychain-4491` review 24, `engine/launchpath-5516` Windows line) now pin the new behaviour.

- Review round 1 (BLOCKER, fixed): a board start keeps only a LAUNCH's PATH part (review 13), and no Windows launch
  records one (only bin/agent-supervisor.sh runs the launch refresh), so the Windows PATH sentence sent as pathReason
  was dropped and the page recorded the guard as complete. On Windows it now travels as otherReason, the part every
  run measures. A test reads the recorded line after a board start. Also: withRealTwins names (never writes) a twin as
  wide as a drive root or a folder holding the home or the agent's own folder, and one whose real place cannot be
  worked out (fails closed).

## What it means for a person
- An existing token-only Claude agent on Windows gets its guard written at the next refresh: the board token gets Read
  and Edit denies for its file tools (today it gets none). Its page still says protection is not complete, now with the
  true reason (the PATH part), not "not shown to hold".
- Creating a NEW token-only agent on Windows is still refused (create requires a whole guard, and the PATH part is not
  covered). Same as today; that changes with step B (the PATH part).

## Decided, not missed
- `( ) { } !` stay refused on Windows as on Linux, though measured literal there: condition 1 is "say what Linux says",
  and loosening RULE_SYNTAX per platform is its own change. Weakest point: a folder like `Program Files (x86)` keeps
  making the guard not whole on Windows when step B covers PATH. Would change my mind: step B needing it.
- `engine/agentevents.js` still treats Windows as never guarded (it reads nothing there): fail-closed, still correct.
- Native twins are not added to the guard's rules (they never were; withNativeTwins is the guide's).
- The page does not name the unsandboxed shell (the agent's PowerShell or Bash can still read the token); that is what
  Linux says too (condition 1: no stronger claim, and no different wording). For step B this matters more: once the
  PATH part is covered, the Windows page would read "complete" while the shell can read the token, as on Linux. To be
  raised on the card for step B.

## Not covered
- The PATH part (step B, #5516 later part): System32 past the scan cap, app execution aliases (the card).
- Shares, mapped drives, non-NTFS volumes, other Claude Code versions (not measured).
- Whether `[` can be escaped in a rule.

## Done when
- On the Windows box: engine/tokenguard.win32-5664 10/10; the guard written for a real folder in a sandbox (probe in
  work\t5664); guard-related test files no worse than origin/main by name and by reason.
- Policy tests green (windows-tests-1777, coupling audit, engine.reachable, separator guard, fixture-discipline,
  no-name-refs).
- Mac/Linux CI green; the Windows CI job runs the new file.
