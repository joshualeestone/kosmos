# communityexit-7967: every nonzero `kosmos community` exit says why on stderr

Card: kosmos#7967 (Splinter, from the 11-04 feedback). A chained health check stopped after `community home` with no error
shown; each command worked alone.

## Measured cause
Every community failure path does print a reason, but through `say`, which writes to STDOUT. A chain that captures or
drops stdout therefore stops with stderr empty. The Windows CLI already writes these reasons to stderr (ctx.err).

## Decided
- One wrapper, not a patch per exit: cmd_community_with_reason runs the unchanged cmd_community in a subshell, `say`
  keeps the first line it says in a temp file named by KOSMOS_SAY_FIRST (not exported), and on a nonzero exit the
  wrapper writes ONE line to stderr: `kosmos community <sub>: <first line said> (exit N: <what N means>)`, then exits N.
  Exit 2: refused as written. Exit 3: it may have happened, the line says what to check. Exit 1 and others: the line
  says whether running it again is safe. A path that said nothing gets "stopped without saying why".
- Review 1: the suffix never claims nothing happened. An exit 1 can follow a post the board may have taken (a cut
  answer, say_unreached ... write), so "nothing was done" would invite a duplicate public post.
- Review 1: errexit stays on inside the subcommands (set +e around `( set -e; ... )`, then $?). On the left of `||`
  bash turns errexit off for everything it calls; re-asserting set -e inside does not undo that (measured on 3.2).
- Review 1: an INT, TERM or HUP removes the temp file, says it was stopped, and re-raises the signal.
- stdout is unchanged, so every existing test and any script reading stdout behaves as before.
- Rejected: moving each failure `say` to stderr (dozens of sites, each a chance to miss one, and it would change stdout
  that tests and scripts read); a per-exit-code table of retry advice for exit 1 (the reason already carries it).
- Weakest premise: that the FIRST line said is the reason (the exit-code meanings are now only what each code always
  means). True for every failure path read (each says one line, then
  exits; usage says its usage line first). A path that says something harmless and THEN fails would repeat the harmless
  line. To change it, record the last line instead.

## Not done
- The Windows CLI: it already puts these on stderr.
- `kosmos community bogus` repeats the first usage line (post's), as stdout already does.

## Steps
1. Wrapper + say() hook in install/kosmos. done
2. cli.community-exit-reason-7967.test.js: exits 1, 2, 3, success silent, the chained case, temp file removed. done
3. Review 1: a cut post never says nothing happened; an interrupt cleans up; errexit stays on (each has a mutant that
   fails exactly its test). done
