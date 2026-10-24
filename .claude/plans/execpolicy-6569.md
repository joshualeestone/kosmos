# execpolicy-6569: every PowerShell script Kosmos starts passes an explicit per-process policy (kosmos#6569)

## Finished means
Every Kosmos launch of a PowerShell script passes `-ExecutionPolicy Bypass` for that one process, and a test fails if
a new launch site omits it.

## The change
One new test, `tools.ps-execpolicy-6569.test.js`: a census over runtime JS, C#, PowerShell and shell sources. Every
line that names a script (`-File` in any case or abbreviation, or a `.ps1`) must carry `-ExecutionPolicy Bypass`
outside a trailing comment, or be REVIEWED by exact line with the reason. A string-aware tokenizer strips JS and C#
comments; PowerShell and shell drop whole comment lines only. Controls plant each missing-policy shape and require it
to be flagged.

## Decided, and why
- A guard only: the survey found every runtime launch site already passes the policy, so no product code changes.
- A census rather than a launch pattern (review 2): launch patterns missed arguments built earlier, the executable in a
  variable, and launches split across lines.
- Weakest premise: the tokenizer's two named uncovered regex shapes (in its docblock). acorn found it blanks no code
  in the tree today.

## Order and rollback
Independent. Rollback: revert (test only).
