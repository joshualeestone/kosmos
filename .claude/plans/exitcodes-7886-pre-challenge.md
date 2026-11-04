---
pre_challenge: true
method: challenge-loop
branch: exitcodes-7886
diff_hash: 5bd30403452540f1fc33a08f9da382b07ad71e815a726158e5135a2464088391
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T00:39:24Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 raised no new BLOCKER, WARNING or CONVENTION)
**Total findings:** 4 actionable (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs), 14 NITs
**Fixed:** 4 WARNINGs, plus 7 NITs acted on | **Deferred:** 0 | **Asked (awaiting user):** 0

Initial validation (6.0) was not run before iteration 1; the full validation ran once, at convergence (6j), on the
converged head c7ee66240a: validation-log PASSED, hash 5bd304034525 (matches the diff_hash above), 26874 node tests,
0 failed, 0 cancelled; shell shards all green; subdir audit exit 0. Targeted suites ran after every iteration.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] install/kosmos:5473 - the help read as the full list of exit statuses, but `kosmos status` exits 4 and 5 and `open` 5 --> FIXED (a6d74dd985): "Most commands ... A few use other numbers too."
- [WARNING] engine/messages.js:3082 - "you have not seen N posts" claims to know what the agent read --> FIXED (a6d74dd985): "N earlier posts ... were not sent to you"
- [NIT] install/kosmos:5470 - "22 Mac sites" unmeasured --> FIXED (count dropped)
- [NIT] install/kosmos:5476 - no blank line before the --help caveat --> FIXED
- [NIT] install/kosmos:5473 - exit 2 also covers preparation failures --> FIXED by "Most commands"
- [NIT] cli.exit-status-help-7886.test.js:49 - no Windows arm for the exit 3 control --> FIXED: a Windows arm runs the real handler against a stub board; red when maybe() returns 0

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the sentence placed in the shared list was iteration 1's fix)
- [WARNING] install/kosmos:5434 - the sentence sat in kosmos_command_list, which the unknown-command error also prints; Windows prints it on help only --> FIXED (23910cfd92): its own function, called on the help path; a test pins both CLIs alike, red when the error path prints it
- [NIT] cli.exit-status-help-7886.test.js:49 - the Mac control reads source, not a run
- [NIT] cli.exit-status-help-7886.test.js:35 - whitespace collapsed before comparing (intended)
- [NIT] engine/messages.js:3080 - pluralisation comment

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] install/kosmos:5475 - `kosmos update` exits 3 on three plain refusals --> FIXED (c7ee66240a): the Mac help adds "kosmos update also ends with 3 when it refuses to run" (Windows has no update verb); pinned by test
- [NIT] tools/windows/kosmos-cli.js:3258 - the two helps place the sentence differently
- [NIT] install/kosmos:5469 - an extra blank line on the unknown-command path --> FIXED: that path is byte-identical to main (measured)
- [NIT] engine/messages.js:3082 - "from this hour" is a rolling window --> FIXED: "in the last hour"
- [NIT] cli.exit-status-help-7886.test.js:52 - the Mac control depends on indentation (fails loud, not false)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] tools/windows/kosmos-cli.js:3258 - no blank line around the Windows sentence
- [NIT] cli.exit-status-help-7886.test.js:44 - the Mac control reads source
- [NIT] install/kosmos:5479 - Mac-only update line can drift from Windows

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/kosmos:5473 | BRANCH | Help read as the full list of exit codes | FIXED | a6d74dd985 |
| 2 | 1 | WARNING | engine/messages.js:3082 | BRANCH | "you have not seen" is unknowable | FIXED | a6d74dd985 |
| 3 | 2 | WARNING | install/kosmos:5434 | SELF | Sentence printed on the unknown-command error too | FIXED | 23910cfd92 |
| 4 | 3 | WARNING | install/kosmos:5475 | BRANCH | update exits 3 on a plain refusal | FIXED | c7ee66240a |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] cli.exit-status-help-7886.test.js - the Mac exit 3 control reads the source rather than running the branch (iterations 2, 3, 4); kept, as it fails loudly on a reformat and the Windows arm runs for real
- [NIT] tools/windows/kosmos-cli.js:3258 - help layout differs slightly between the CLIs (iterations 3, 4)
- [NIT] engine/messages.js:3080 - pluralisation comment (iteration 2)
- [NIT] install/kosmos:5479 - a Mac-only line in shared help can drift (iteration 4)

### Strengths (across all iterations)
- Both CLIs' help is held to one shared sentence, word for word (iterations 1-4)
- Every fix carries a mutant that turns its test red: maybe() returning 0, the error path printing the sentence, the old catch-up wording (4 reds)
- Keeping exit 3 matches the convention both CLIs already use for "do not send it again" (iterations 1, 3)
- The catch-up wording is true of both kinds it counts, unaddressed and quiet posts (iterations 2, 4)
