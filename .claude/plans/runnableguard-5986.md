# runnableguard-5986: the installer runnable guard's -f excuse has to reach the -x

Card: #5986. Filed from two blind reviews of #5913.

## Finished looks like
tools/test-installer-runnable-guard.sh flags every shape the card names: an -f behind ||, an -f only in a
comment, an -f the -x can run without (a || or a ! earlier in the same command), and the forms the old scan
never read (test -x, -a, extra spaces). Each new rule has a control that the OLD rule passes. The real installer
(install/kosmos, install/setup.sh, install/kosmos-report-hook.sh) still scans clean, measured.

## Rule
- [ -x P ] needs [ -f P ] before it on the same line, joined by && with only other bracket tests on P between.
  From where the command starts (; { ( ` or then/do/else/if/elif/while/until) up to the -f: no || and no !
  negating a command. Negated form mirrors it: [ ! -f P ] || ... [ ! -x P ], no && and no ! before.
- Quoted text is blanked before joiners are read. Comments are cut first (on the blanked line).
- Any other -x inside [ ] or test outside a comment is flagged as a form the scan cannot judge.

## Rejected
- Waiting for #5913 (which rewrites this file with a by-name list for folder tests): reversible either way, and
  the overlap is the one excuse line. Whoever lands second resolves it.
- Parsing shell properly: out of proportion for a guard over three files; the rule is fail-closed instead.

## Weakest premise
That a line scan judges shell well enough. Known limits, all in the fail-closed direction except the last:
the || rule is stricter than shell precedence; an unquoted $( ) before the guard ends the segment early,
which can excuse a line only when an || sits before that $( ) and the guard is its direct right operand
(A || $(c) [ -f P ] is not shell anyone writes); a guard split across a heredoc or a here-string is not followed. None of these
shapes is in the installer today.

## Verify
bash tools/test-installer-runnable-guard.sh under macOS awk and mawk; CI test-linux-setup (Ubuntu awk).
