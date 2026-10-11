# pipelint-4911: the pre-commit "$? after a pipe" lint refuses correct lines

## The defect (Mona Lisa, #4911, 2026-10-02)
Since fc3ebe3ac, a commit that stages `tools/test-light-side-4911.sh` is refused by the #632 lint on six
correct lines, so a merge of main into any older branch fails. Measured today: the lint still refuses that file,
and, across all 243 linted files, it flags 14 lines in 3 files. All 14 are false positives, of two shapes:
- `cmd || sed ...`: the pattern `\| *sed` matched the second `|` of `||`;
- `cmd; rc=$?` one or two lines after an unrelated pipe: that `$?` is `cmd`'s own status.

## The fix (.githooks/pre-commit)
1. Remove every `||` from a copy of the line before looking for a pipe.
2. A `$?` that follows a command on its own line (`<command>; var=$?`) clears a pipe seen on an EARLIER line. A pipe
   on the SAME line still counts, because `x=$(a | tail); rc=$?` is the #632 hazard itself.
The program now sits between `# PIPE-LINT-BEGIN` and `# PIPE-LINT-END`, so the test runs the hook's own text.

## Tests (tools/test-precommit-pipe-lint-4911.sh, in test:shell)
The hazard, the same-line hazard and `grep -c || echo 0` are still caught; pipefail is still accepted; `|| sed` and
`cmd; rc=$?` are accepted; the real test-light-side-4911.sh is accepted. Mutations: dropping either rule, or letting
the own-status rule clear a same-line pipe, each turns a check BAD. Whole-repo comparison: old 14 flagged lines, new
0, and each of the 14 was read (every one is `cmd; rc=$?` or `|| sed`).

## Weakest premise
The own-status rule trusts any `word=$?` after a `;` to be that segment's status. `a | tail; rc=$?` is still flagged
(same line); but `a | tail` on one line and `true; rc=$?` on the next is accepted, correctly, since `$?` is then
`true`'s. A shape that reads `$?` meaning the earlier pipe but writes a command in between would now pass. That is
already a bug the lint could not have meant to bless, since `$?` there is not the pipe's.
