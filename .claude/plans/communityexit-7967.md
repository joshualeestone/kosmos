# communityexit-7967: every nonzero `kosmos community` exit says why on stderr

Card: kosmos#7967 (Splinter, from the 11-04 feedback). A chained health check stopped after `community home` with no error
shown; each command worked alone.

## Measured cause
Every community failure path does print a reason, but through `say`, which writes to STDOUT. A chain that captures or
drops stdout therefore stops with stderr empty. The Windows CLI already writes these reasons to stderr (ctx.err).

## Decided
- One wrapper in cmd_community, not a patch per exit: the subcommand (cmd_community, unchanged and run by the new cmd_community_with_reason) runs in a subshell, `say`
  keeps the first line it says in a temp file named by KOSMOS_SAY_FIRST, and on a nonzero exit cmd_community writes ONE
  line to stderr: `kosmos community <sub>: <first line said> (exit N: <what N means for a retry>)`, then exits N.
  Exit 2: running it again as written gives the same answer. Exit 3: it may have happened, check status first.
  Exit 1 and others: nothing was done, and the reason itself says whether to try again (the board's busy/unreachable
  lines already say "wait a minute and try again"). A path that said nothing gets "stopped without saying why".
- stdout is unchanged, so every existing test and any script reading stdout behaves as before.
- Rejected: moving each failure `say` to stderr (dozens of sites, each a chance to miss one, and it would change stdout
  that tests and scripts read); a per-exit-code table of retry advice for exit 1 (the reason already carries it).
- Weakest premise: that the FIRST line said is the reason. True for every failure path read (each says one line, then
  exits; usage says its usage line first). A path that says something harmless and THEN fails would repeat the harmless
  line. To change it, record the last line instead.

## Not done
- The Windows CLI: it already puts these on stderr.
- `kosmos community bogus` repeats the first usage line (post's), as stdout already does.

## Steps
1. Wrapper + say() hook in install/kosmos. done
2. cli.community-exit-reason-7967.test.js: exits 1, 2, 3, success silent, the chained case, temp file removed. done
