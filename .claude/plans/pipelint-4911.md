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
(The mutation results recorded in this plan were run BY HAND, one at a time; the test file itself runs only the
fixtures. They are not standing coverage.)
The hazard, the same-line hazard and `grep -c || echo 0` are still caught; pipefail is still accepted; `|| sed` and
`cmd; rc=$?` are accepted; the real test-light-side-4911.sh is accepted. Mutations: dropping either rule, or letting
the own-status rule clear a same-line pipe, each turns a check BAD. Whole-repo comparison: old 14 flagged lines, new
0, and each of the 14 was read (every one is `cmd; rc=$?` or `|| sed`).

## Weakest premise
The own-status rule clears an earlier pipe for a line "<plain command> ...; var=<status>". It is refused (the pipe
stays live) for: a compound closer on the status line (done fi esac then else elif do wait, or a line starting with }
or )); a builtin that always succeeds (local declare typeset readonly export set unset shift true alias builtin
command eval exec time); a status read, or a pipe of its own, before the ";"; a ";" inside quotes; a comment; a line
continued from the pipe's (trailing backslash or trailing lone pipe, CRLF or not); and a status line whose previous
non-blank line ends a function (starts with } or ), or defines one on one line). Each is a must-flag fixture with a
red mutant.

**Also refused (review 5):** a pipe line ending in "||" or "&&" (the next line is its fallback or chain); a closer as
its own word anywhere on the pipe line; echo, printf, source and "." as status owners; assignment-only lines in every
common form (arithmetic, arrays, +=, element, mixed quotes); a ";" after a "#".

**A second residual, stated:** a "cmd; rc=<status>" line inside an unquoted heredoc body is read as owning its status,
though the body is text whose status expands at the heredoc's command. Contrived; not handled.

**Rebuilt at review 6:** own() now requires everything before the ";" to be ONE simple command (no other ";", "&&"
or "||"), and checks the command word after any VAR=x prefixes, against keywords, always-zero builtins, wrappers
(sudo env nice nohup xargs timeout stdbuf caffeinate) and source. A line that closes more ( or { than it opens ends
a body.

**A third residual, stated:** the first-character rule refuses a status line whose command word is quoted or a
variable ("$BIN" --x; rc=...), and one that starts with "[" or "~". Those are false positives (the safe direction);
none occurs in the tree today (sweep: 0).

**The residual, stated:** a function defined elsewhere in the file whose last command is a pipe, called as
"fn; rc=<status>" with some unrelated line between its end and the call. The lint reads lines, not a parse, so it
cannot know what fn returns. The old lint caught that only when the call sat within two lines of the pipe, which the
function-end rule above still does. Quote parity counts each quote kind separately, so a stray quote inside the other
kind refuses a correct line: a false positive, the safe direction for a guard.

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

## Review 2 (sonnet, blind, on a620478a2): no BLOCKER
- FIXED (WARNING): a function whose last line is the pipe, then "fn; rc=<status>", was accepted (the old lint caught
  it within two lines). The pipe now stays live after a lone "}" line. That refuses some correct code (a function
  ending in a pipe, then an unrelated command and a status read within two lines); acceptable for a guard. Fixture;
  mutation red.
- FIXED (NIT): CRLF files lost the continuation rule; each line's CR is dropped first. Fixture; mutation red.
- NO CHANGE (NIT): pipefail is never unset by "set +o pipefail" (predates this change; scope is #632's).
- NO CHANGE (NIT): the test runs one awk per run; BSD awk and mawk were both run by hand on every fixture and the
  whole-repo sweep (identical). CI's awk is whatever its runner has.

## Review 3 (opus, blind, on ee21de0a7)
- FIXED (BLOCKER): a pipeline continued by a trailing lone "|" was not a continuation; it is now. Fixture; mutation red.
- FIXED (WARNING): the function-end rule fired only on a lone "}"; now any previous non-blank line starting with } or
  ), or a one-line function definition. Three fixtures; reverting to the lone-brace rule turns all three BAD.
- FIXED (WARNING): a builtin that always succeeds ("local rc; rc=") owned the status; refused by list. Fixture; mutation red.
- FIXED (WARNING): a pipe of its own before the ";" (any filter, e.g. jq) was cleared; refused. Fixture; mutation red.
- FIXED (NITs): the residuals named above (functions defined elsewhere; quote-parity false positives); fixtures added.

## Review 4 (sonnet, blind, on 55f1454cf): no BLOCKER
- FIXED (WARNING): a trailing-pipe pipeline continued across a blank or comment line lost its continuation; blank and
  comment-only lines now leave cont and shut as they were. Two fixtures; mutation red.
- FIXED (WARNING): a function closed on the pipe's own line ("... | tail -1; }" or "; )") did not set the function
  end. Two fixtures; mutation red.
- FIXED (NIT): an assignments-only line ("x=1; rc=") owns no status (constant 0). An assignment FROM or BEFORE a
  command still does (the original false positives); a fixture holds that, and a mutant ignoring the command
  substitution turns it BAD.

## Review 5 (opus, blind, on 9b0f30dd3)
- FIXED (BLOCKER): a pipe line ending in "||" or "&&" continues onto its fallback or chain, whose status read is the
  filter's; the "||" strip had hidden it. Both are continuations now. Two fixtures; mutation red on both (the "||"
  fixture first used echo, which the echo rule also caught; sharpened to a plain command).
- FIXED (WARNING): a closer with a trailing comment or redirect, or a subshell body closed without ";", did not end a
  function. The closer is matched as its own word anywhere on the line. Three fixtures; mutation red.
- FIXED (WARNING): echo and printf (and source, ".") owned the status. Listed. Fixtures; mutation red.
- FIXED (NITs): assignment-only forms (arithmetic, arrays, +=, element, mixed quotes) and a ";" after "#". Fixtures;
  mutation red. Heredoc bodies named as a residual. The function-end comment now says what the code matches.
- Whole-repo sweep after all of it: 0 flagged under BSD awk and mawk (hazard/clean control in each).

## Review 6 (sonnet, blind, on 534dbf16b): no BLOCKER
- FIXED (WARNING): own() looked at the line's FIRST word, but the status is the LAST command's: "a; echo done;",
  "if ...; fi;", "FOO=1 true;", "sudo true;" all read 0 and passed. Rebuilt: one simple command only, and the command
  word after VAR=x prefixes, with wrappers listed. Fixtures; the multi-command and wrapper mutants each turn one BAD.
- FIXED (WARNING): "tail -1)" with no space before the closer did not end a body; a line that closes more ( or { than
  it opens now does. Fixture; mutation red.
- FIXED (NITs): trap, hash, ulimit, shopt and similar listed; "x=1 ; y=2;" refused as more than one command; an
  escaped-space assignment is refused (its remainder has no command word). Fixtures.
- Found while fixing: the first rebuild re-flagged an original false positive ("out=$(PATH=... cmd); rc=") because a
  $() value was not stripped as part of the assignment; added, with an in-window must-accept fixture whose mutant goes
  BAD (the first must-accept fixture sat outside the two-line window, so its mutant stayed green). An "escaped
  character" value form had no effect on any verdict, so it was removed rather than kept untested.
- Named residual: a quoted or variable command word refuses correct code (none in the tree).

## Review 7 (opus, blind, on 460647f05): no BLOCKER
- FIXED (WARNING): a continuation with a trailing comment ("| # keep a copy", "&& # then", "|| # else") or "|&"
  escaped; the ends are now read both raw and with a trailing comment removed. Three fixtures; each mutant BAD.
- FIXED (WARNING): a quote or "(" left open on the previous line (a multi-line quoted filter argument closing on
  the status line) escaped; opens(), the mirror of closes(), treats such a line as continued. Fixture; mutant BAD
  (the fixture first passed under the mutant because its continued line's word ended in "/", which the new basename
  step empties; sharpened so only opens() can catch it).
- FIXED (NITs): the command word is compared by basename (/usr/bin/true); coproc and disown listed; the builtin-list
  comment no longer claims they all succeed; the "comment between" fixture no longer has the status variable on the
  comment line; this plan says the mutations were run by hand.
- Sweep: 0 flagged under BSD awk and mawk; controls hold.

## Review 8 (sonnet, blind, on a2d302940): no BLOCKER; about 55 shapes probed, no filter-status escape found
- FIXED (WARNING): an assignment-only line counted a literal "$(" in single quotes, or a "$(...)" inside a "${...}"
  default, as a command that ran; both read a constant 0. Single-quoted spans and ${...} are removed before that
  test. Two fixtures; each mutant BAD.
- FIXED (NITs): jobs bg fg break continue return exit pwd type history false listed (fixture for return; mutant BAD);
  the test now runs the hook's region under /bin/sh, the hook's own interpreter.
- NO CHANGE (NIT): an apostrophe in a comment or a double-quoted string makes opens() keep a pipe live, refusing a
  correct line (the old lint refused it too; the safe direction; the tree sweep is 0). Covered by the quote-parity
  residual above.
