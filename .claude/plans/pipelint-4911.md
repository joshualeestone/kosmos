# pipelint-4911: the pre-commit "$? after a pipe" lint refuses correct lines

## The defect (Mona Lisa, #4911, 2026-10-02)
Since fc3ebe3ac, a commit that stages `tools/test-light-side-4911.sh` is refused by the #632 lint on six
correct lines, so a merge of main into any older branch fails. Measured today: the lint still refuses that file,
and, across all 243 linted files, it flags 14 lines in 3 files. All 14 are false positives, of two shapes:
- `cmd || sed ...`: the pattern `\| *sed` matched the second `|` of `||`;
- `cmd; rc=$?` one or two lines after an unrelated pipe: that `$?` is `cmd`'s own status.

## The fix (.githooks/pre-commit), as it stands at convergence (review 17)
1. Remove escaped backslashes, then every escaped "\|", then every "||" from a copy of the line before looking
   for a pipe: none of them is a pipe.
2. An explicit opt-out: a line ending in the comment "# pipe-status-ok" (lowercase, last on the line, a real comment)
   clears a pipe seen on an EARLIER line, when ALL of: it reads the status in its code (not in a comment); it has no
   pipe into a listed filter of its own; and either a code line has run since the pipe (q) or a ";", "&&" or "||"
   comes before the status read on the line. The refusal message names the marker.
3. The 11 correct lines the lint still refused (cmd; rc=<status>, two lines after an unrelated pipe, in
   test-feedback-digest-daily.sh, test-light-side-4911.sh and test-test-leak-guard-4273.sh) carry the marker. Each
   was read and is its own command's status. Comment-only edits.

## Why not a heuristic (decided at review 9; the review sections below are the evidence)
Rounds 1 to 9 built an "own-status" rule that tried to tell "cmd; rc=" (its own status) from the hazard by reading
lines. Every round found a real filter-status read it let through (closers, continuations, quotes, functions,
wrappers, aliases, bash -c, quote-parity tricks), and the rule grew from 1 line to about 50. Loosening a guard with a
line-based shell parser keeps producing escapes, and an escape here reads a failing suite as green. Review 9 named
the trade; the marker removes the escape surface: the lint is as strict as before except for "||", an escaped "\|",
and lines an author marks in plain sight.

## Tests (tools/test-precommit-pipe-lint-4911.sh, in test:shell)
(Mutation results recorded in this plan were run BY HAND, one at a time; the test file runs only the fixtures.)
Runs the hook's own region under /bin/sh. Every hazard shape found in rounds 1 to 9 is a must-flag fixture (the old
lint flags each, and so does this one). Accepted: "|| sed", and marked own-status lines. Marker limits: an unmarked
line is refused; the marker does not excuse a same-line pipe; a marker on a line that reads no status excuses
nothing. Mutations: no "||" strip, no marker rule, marker excusing its own line, marker on any line: each BAD.
Whole-tree sweep: 0 flagged under BSD awk and mawk, with a hazard/clean control in each.

## Weakest premise
An author can put the marker on a real hazard. That is a deliberate, visible act a reviewer can question, unlike a
heuristic silently accepting it. What would change my mind: markers appearing on lines that are not their own
command's status.

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

## Review 9 (opus, blind, on 001dbc563)
- Two more real escapes (quote parity fooled by an escaped or cross-kind quote; a pipeline held in a string run by
  bash -c or an alias), and the holistic WARNING that the trade does not pay. DECIDED: removed the heuristic
  (own, opens, closes, cont, shut) and replaced it with the explicit marker above. Rejected: another heuristic round.

## Review 10 (sonnet, blind, on 6a80112ff), first review of the marker design: no BLOCKER
- FIXED (WARNING): the marker rule accepted a status read anywhere on the line, so a marked COMMENT that only mentions
  the status ("# see <status> # pipe-status-ok") excused the real read below it. The read must now be in the line's
  code, before any "#". Fixture; the mutant (any status on the line) turns it BAD.
- NO CHANGE (NIT): a marked line clears the pipe, so a further read on the next line or two is that marked line's own
  status, not the pipe's. Accurate as worded.
- The reviewer read all 11 marked lines with the lines above them: each is its own command's status.

## Review 11 (opus, blind, on bfd8dfe27): no BLOCKER
- FIXED (WARNING): no fixture pinned that the marker must END the line; dropping the anchor passed every test. Added
  a mid-line marker followed by code; the anchor mutant turns it BAD (the first version put a quote before the "#",
  so the comment-start rule caught it whatever the anchor did; sharpened).
- FIXED (NIT): an escaped "\|" directly before a real pipe ("a\|| tail") hid the real pipe; "\|" is removed first.
  Fixture; mutant BAD.
- FIXED (NIT): "$#" or "${#...}" before the status counted as a comment start, refusing a correctly marked line; they
  are ignored for that test. Fixture; mutant BAD.
- FIXED (NIT): a marker glued to code ("rc=<status>#pipe-status-ok") is not a comment; the marker now needs a "#" at
  the line start or after a space. Fixture; mutant BAD.
- The reviewer confirmed the 11 marked lines are exactly main's 11 remaining refusals and each is its own command's
  status (run, bcguard, leak_tmp_check, leak_launchd_check, kosmos_light_side_intruder, kosmos_wait_until_clear).

## Review 12 (sonnet, blind, on 407755ac7): no BLOCKER
- FIXED (WARNING): my review-11 "\|" strip regressed "a\\| tail" (an escaped backslash, then a REAL pipe), which main
  catches. Escaped backslashes are now removed first, then "\|", then "||". Fixture; the mutant without the
  backslash step turns it BAD.
- FIXED (NIT): no must-accept fixture for a lone escaped pipe (sed 's/a\| head /x/'); added. The "no escaped-pipe
  strip" mutant and a "narrowed to the adjacent case" mutant each turn it BAD.
- FIXED (NIT): the marker on a continued line of the pipe is the stated residual; it is now a PINNED accept fixture,
  so a change to it is deliberate.
- NO CHANGE (NIT): a "#" inside a string before the status refuses a correctly marked line (the safe direction).

## Review 13 (opus, blind, on eec4ec298): no BLOCKER
- FIXED (WARNING): on the line straight after the pipe, a marked line that reads the status before running any
  command ("[ <status> -eq 0 ] || exit 1  # pipe-status-ok") can only read the filter's, so the marker cannot be true;
  it now counts there only after a ";", "&&" or "||". (Two lines down a bare read legitimately reads the line between,
  so the rule does not apply there.) None of the 11 marked lines is affected (all are "...; rc=<status>"; sweep 0).
  Fixture; mutant BAD.
- FIXED (WARNING): the bare "$#" half of the comment-start exception had no fixture; added; the narrowed mutant BAD.
- FIXED (NIT): a marked line in a CRLF file is a PINNED accept fixture.
- The reviewer ran origin and new side by side on many look-alikes (escaped pipes in quotes, uppercase or quoted
  markers, markers on other lines): none escapes without a correctly placed marker.

## Review 14 (sonnet, blind, on 84b841420): no BLOCKER; a 600-case old/new differential fuzz found no unmarked escape
- FIXED (WARNING): "a command ran before the read" was approximated as "not the line straight after the pipe", so a
  blank or comment line between them defeated it. Now q counts CODE lines since the pipe (blank and comment lines do
  not count). Fixtures for both sides; the mutants (no q term; comments counted as commands) each turn one BAD.
- FIXED (WARNING): the && and || separators and the code-only read check had no fixture that failed when narrowed or
  removed (an earlier rule masked the comment fixture). Added; each mutant BAD.
- NO CHANGE (NIT): a ";" inside a quoted string on the marked line counts as a separator; reachable only with a marker
  present, where a command did run.

## Review 15 (opus, blind, on 3ba077c36): no BLOCKER; 26 of 28 clause mutants already failed a fixture
- FIXED (WARNING): the q reset on a new pipe had no fixture; a two-pipe fixture now fails without it.
- FIXED (WARNING): blank lines being excluded from q had no fixture (only a comment line); a blank-line sibling now
  fails when blanks are counted.
- FIXED (NIT): the "cannot be true" comment now says it is best-effort (a quoted ";" or an assignment still passes
  with a marker; the marker is the author's word).
- FIXED (NIT): the test now lints all three marked files, not one; removing one marker makes it fail (checked).
- The reviewer confirmed: old vs new over all 244 files differ on exactly 14 lines (3 "||" lines, 11 marked); with
  the markers stripped from copies, the new lint flags exactly those 11 again.

## Review 16 (sonnet, blind, on a80150a0e): no BLOCKER
- FIXED (WARNING): "a pipe on the same line still counts" held only for pipes the main regex recognises (whitespace
  after the filter). A marked "z | sort; rc=" or "y=$(z | sort); rc=" was excused. The marker rule now refuses a line
  with a pipe into a known filter followed by any non-word character. Two fixtures; the mutant turns both BAD.
- FIXED (NIT): this plan's fix list now names the escaped-pipe change; the refusal message says the marker is
  lowercase and last on the line.

## Review 17 (opus, blind, on 4aa7e590d): NITs only. CONVERGED.
- No BLOCKER, WARNING or CONVENTION. Main's lint, wrapped in the markers, passes all 52 must-flag fixtures (each
  shape was caught before this change) and fails exactly on the intended accepts. 18 of 21 clause mutants fail a
  fixture; the 3 survivors cannot fire today.
- NITs fixed after convergence, prose only (no code): a comment names the three unreachable clauses as guards; "a
  pipe into one of the listed filters on the same line"; the block comment above the loop names "||", "\|" and the
  marker; this plan's fix list and summary brought up to date.
