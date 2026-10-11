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
The own-status rule clears an earlier pipe for a line "<plain command> ...; var=<status>". Shapes that pass the pipe's
status on are refused by design: a compound closer (done, fi, esac, then, else, elif, do, wait, or a line starting
with } or ), since such a construct's status IS its last command's), a comment, a status read before the ";", a ";"
inside quotes, and a line continued from the pipe's line. Each is a must-flag fixture. What remains: a hand-built
shape that reads the pipe's status through some construct not in that list would now pass. The lint was always a
heuristic over lines, not a parser.

## Review 1 (opus, blind, on cee6c0863)
- FIXED (BLOCKER): the first own-status rule let real hazards through: "done; rc=", "fi; rc=", "}; rc=",
  "); rc=", a status read before the ";", a ";" inside quotes, a continued pipe line. Rule rebuilt as own() with
  each of those refused; each is a must-flag fixture, and each sub-rule has a mutant that turns its fixture BAD
  (two fixtures first stayed green under their mutant because the first-character rule caught them; sharpened).
- FIXED (WARNING): no adversarial must-flag fixtures; added (8).
- FIXED (WARNING): a comment line could clear the pipe; own() needs a plain command word first (fixture).
- FIXED (NIT): the weakest premise above names the real residual.
- Found while fixing: the new comment wrote the status variable within two lines of the hook's own pipe, so the
  hook refused itself; the comments now never write it. Whole-repo sweep: old 14 flagged lines (all false positives),
  new 0, under BSD awk and mawk, with a hazard/clean control in each.
