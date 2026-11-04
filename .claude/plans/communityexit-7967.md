# communityexit-7967: every nonzero `kosmos community` exit says why on stderr

Card: kosmos#7967 (Splinter, from the 11-04 feedback). A chained health check stopped after `community home` with no error
shown; each command worked alone.

## Measured cause
Every community failure path does print a reason, but through `say`, which writes to STDOUT. A chain that captures or
drops stdout therefore stops with stderr empty. The Windows CLI already writes these reasons to stderr (ctx.err).

## Decided
- One wrapper, not a patch per exit: cmd_community_with_reason runs the unchanged cmd_community in a subshell. `say`
  keeps the first line it says in a shell variable (_KOSMOS_SAID_FIRST, never exported; unset at load), and the
  SUBSHELL's own EXIT trap writes ONE line to stderr on a nonzero exit:
  `kosmos community <sub>: <first line said> (exit N: <what N means>)`. Exit 2: refused, the line says why. Exit 3: it
  may have happened, the line says what to check. Exit 1 and others: the line says whether running it again is safe.
  A path that said nothing gets "stopped without saying why".
- Review 1: the suffix never claims nothing happened. An exit 1 can follow a post the board may have taken (a cut
  answer, say_unreached ... write), so "nothing was done" would invite a duplicate public post.
- Review 1: errexit stays on inside the subcommands (set +e around `( set -e; ... )`, then $?). On the left of `||`
  bash turns errexit off for everything it calls; re-asserting set -e inside does not undo that (measured on 3.2).
- Review 3: the outer shell holds NO trap. Bash runs a trap only after the foreground command returns, so the round-1
  INT/TERM/HUP traps (and, measured, an EXIT trap too: 19 s against 0.01 s) made a TERM sent to the command wait for
  the whole request. Without one, TERM and HUP stop it at once, as on main; a request already sent may still finish, as
  on main. That also removed the temp file round 1 had to clean up. A signal death prints no line (bash runs no EXIT
  trap for an untrapped signal), as before.
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
3. Review 1: a cut post never says nothing happened; errexit stays on. done
4. Review 3: TERM and HUP to the command stop it within 5 s against a board that never answers (a parent trap, put
   back as a mutant, takes 60 s and fails); Ctrl-C likewise; the subshell alone traps. done
