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
- Control: main's win32launch.js swapped in fails exactly those 3; the branch passes 126 run (122 pass, 4 skipped).

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
