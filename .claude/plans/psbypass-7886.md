# psbypass-7886: Claude agents on Windows can run the helper scripts they are told to run (kosmos#7886 item 9)

## Done looks like
On Windows, a Claude agent Kosmos launches gets the process-scope `PSExecutionPolicyPreference=Bypass` that the
PowerShell runners (codex, gemini, grok, antigravity) already get, so a `.ps1` helper it starts from Git Bash
(`powershell -File <script>.ps1`) runs on a fresh machine instead of failing with "running scripts is disabled".

## The report (paraphrased on the card)
"Windows: helper scripts an agent is told to run fail on a fresh machine without -ExecutionPolicy Bypass, with an
alarming policy error." It names neither the script nor the runner.

## Call made (night shift, decided)
- Set the variable for claude children too (engine/win32launch.js childEnv), and treat "no runner named" as claude,
  as the rest of that file does (`s.runner || 'claude'`), so an agent recorded before runners existed is covered.
- Why claude: the four PowerShell runners already have it; Claude Code's own PowerShell tool passes its own policy
  flag (the #3380 test's words); the remaining gap is a script started from Claude's Git Bash, which passes no flag
  and inherits the environment. The variable is read only by PowerShell, so Git Bash itself is unchanged.
- Rejected: editing every instruction that names a `.ps1` to add `-ExecutionPolicy Bypass` (the report names no
  script, and a new instruction would reopen it); setting a machine or user policy (a lasting change to the person's
  computer, beyond Kosmos's own processes).
- Weakest premise: that the reported failure came through a Claude agent. If it came from a script the PERSON ran in
  their own terminal, this does not reach it. Not measured on Windows (no Windows machine here).

## Tests
- engine/win32launch.test.js, win32-kosmos-shell-5358.test.js, win32keyed.test.js: the three tests that pinned
  "claude unchanged" now pin claude (and no runner) getting Bypass, one key whatever spelling it inherited.
- Control (re-measured at iteration 3): main's win32launch.js swapped in fails exactly those 3 (79 pass); the branch
  passes 124 with 4 skipped (the Windows-only arms, which the Windows CI runner runs).

## Review rounds

#### Iteration 1
- [WARNING] tools.ps-execpolicy-6569.test.js's header still said a claude agent is deliberately left without it -->
  FIXED: says claude (and no runner) get it since #7886 item 9, and that Group Policy still outranks it.
- [WARNING] the premise (a `powershell -File` started from Git Bash honours the variable) was reasoned only -->
  FIXED: engine/win32-kosmos-shell-5358.test.js's Restricted-policy arm (Windows CI only) now starts a helper .ps1
  from Git Bash with a claude agent's env: refused without the variable (control), runs with it. Measured by the PR's
  Windows CI run; skipped on this Mac.
- [NIT] the sign-in child (no runner) gets it too --> noted in the win32launch.js comment (it runs no scripts).
- [NIT] mixed policyRunner / runner comparisons --> FIXED: one list, on policyRunner.
- [NIT] the 5358 test header named only the PowerShell runners --> FIXED.

#### Iteration 2
- [WARNING] the Windows arm ran powershell.exe by a backslash path inside `bash -c`; bash runs a command name as a
  path only when it holds a `/`, so it could read "command not found" --> FIXED: KZ_PS uses forward slashes. (Either
  way it could only go red, never false green: the control fails first.)
- [NIT] the Claude Code PowerShell arm's flag is now redundant with the variable --> FIXED: the comment says so.
- [NIT] scope: every program a claude agent starts inherits Bypass (scripts with the mark of the web included) -->
  stated in the PR description; the same posture the four PowerShell runners already have.

#### Iteration 3
- [WARNING] a runner outside the list (muse) gets nothing, silently --> FIXED: the comment names muse as Mac-only today
  and says to add it here and to the pinning tests if it ever runs on Windows with PowerShell.
- [WARNING] the code comment did not say that scripts carrying the mark of the web now run --> FIXED: said, on purpose.
- [NIT] "runs no scripts" about the sign-in child was reasoned --> FIXED: "is not expected to".
- [NIT] the control count predated iteration 1 --> RE-MEASURED: still exactly the 3 tests.

#### Iteration 4 (final whole-branch read)
No BLOCKERs or WARNINGs; every FIXED claim above checked true in the code. Converged.
- [NIT] the 6569 header says "measured on the Windows CI runner" before that run exists --> to check after the PR's
  Windows CI run: its log must show the arm RAN, not skipped.
- [NIT] the mark-of-the-web paragraph belongs in the PR body --> it is there.
- [NIT] the Claude Code PowerShell arm's flag is redundant with the variable --> left; its comment says so.
