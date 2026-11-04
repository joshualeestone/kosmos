# communityexit-7967: every nonzero `kosmos community` exit says why on stderr

Card: kosmos#7967 (Splinter, from the 11-04 feedback). A chained health check stopped after `community home` with no error
shown; each command worked alone.

## Measured cause
Every community failure path does print a reason, but through `say`, which writes to STDOUT. A chain that captures or
drops stdout therefore stops with stderr empty. The Windows CLI already writes these reasons to stderr (ctx.err).

## Decided
- One wrapper, not a patch per exit, and NO change to how the command runs (review 5): for the community verb only,
  cmd_community_with_reason defines `exit` as a function that writes ONE line to stderr on a nonzero exit in this
  shell (BASH_SUBSHELL 0; an exit inside $(...) is that subshell's own) and then runs `builtin exit`. `say` keeps the
  first line it says in a shell variable (never exported; unset at load). The line:
  `kosmos community <sub>: <first line said> (exit N: <what N means>)`. Exit 2: refused, the line says why. Exit 3: it
  may have happened, the line says what to check. Exit 1 and others: the line says whether running it again is safe.
  A path that said nothing gets "stopped without saying why". A stop by errexit or by a signal writes no line.
- Review 1: the suffix never claims nothing happened. An exit 1 can follow a post the board may have taken (a cut
  answer, say_unreached ... write), so "nothing was done" would invite a duplicate public post.
- Rounds 1 to 4 ran the command in a subshell, and every shape broke a signal: on the left of `||` errexit went off
  (review 1); a trap made a TERM wait for the request, 57 s (review 3; an EXIT trap too, measured 19 s against
  0.01 s); no trap left the subshell asking the board after the command was killed (review 4); a background job could
  not take Ctrl-C, because bash 3.2 cannot un-ignore SIGINT there, so the request's curl and its token file outlived
  the command (review 5). Keeping the command in its own shell removes the whole class: every signal does what it did
  on main, which the tests check one by one.
- Review 5 also found: the global --help re-dispatch runs the bare verb (exit 2 by design, mapped to 0) and got the
  line too. It now passes KOSMOS_HELP_REDISPATCH=1 to that child, and the wrapper adds no line there.
- Review 6: the line's write cannot change the exit code (`|| true`: under set -e a write to a closed or full stderr
  would have ended the function before the real exit, turning an exit 3 into a 1); `die` records its line too, so a
  path that uses it gets its own words repeated, not "stopped without saying why".
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
1. The exit function and the say hook in install/kosmos; the --help re-dispatch marked. done
2. cli.community-exit-reason-7967.test.js: exits 1, 2, 3, success quiet, the chained case, nothing left in TMPDIR, a cut
   post never says nothing happened, a piped body arrives, --help quiet. done
3. Signals: TERM, HUP, KILL to the command and INT to its group each stop it within 5 s with the board asked nothing
   more; a Ctrl-C during a hanging request leaves the group empty (fails on round 4's code, passes on main and here);
   the wrapper has no subshell, background job or trap. done
4. Review 6: with stderr closed an exit 3 stays 3 (fails with the `|| true`s removed). done
