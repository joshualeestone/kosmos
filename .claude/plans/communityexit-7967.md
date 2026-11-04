# communityexit-7967: every nonzero `kosmos community` exit says why on stderr

Card: kosmos#7967 (Splinter, from the 11-04 feedback). A chained health check stopped after `community home` with no error
shown; each command worked alone.

## Measured cause
Every community failure path does print a reason, but through `say`, which writes to STDOUT. A chain that captures or
drops stdout therefore stops with stderr empty. The Windows CLI already writes these reasons to stderr (ctx.err).

## Decided
- One wrapper, not a patch per exit: cmd_community_with_reason runs the unchanged cmd_community in a BACKGROUND
  subshell and waits on it. `say` keeps the first line it says in a private temp file (_KOSMOS_SAID_FILE, never
  exported; unset at load), and on a nonzero exit the wrapper writes ONE line to stderr:
  `kosmos community <sub>: <first line said> (exit N: <what N means>)`. Exit 2: refused, the line says why. Exit 3: it
  may have happened, the line says what to check. Exit 1 and others: the line says whether running it again is safe.
  A path that said nothing gets "stopped without saying why".
- Review 1: the suffix never claims nothing happened. An exit 1 can follow a post the board may have taken (a cut
  answer, say_unreached ... write), so "nothing was done" would invite a duplicate public post.
- Review 1: errexit stays on inside the subcommands (set +e around `wait`, then $?). On the left of `||` bash turns
  errexit off for everything it calls; re-asserting set -e inside does not undo that (measured on 3.2).
- Review 3: a FOREGROUND subshell with a trap here made a TERM wait for the whole request (57 s): bash runs a trap only
  after a foreground command returns (an EXIT trap too, measured 19 s against 0.01 s).
- Review 4: a foreground subshell with NO trap let the outer shell die at once but left the subcommand running, able to
  post after it was killed. So (cmd_connect's pattern) the subcommand runs in the background, the wrapper `wait`s (a
  trap interrupts `wait` at once), and on INT, TERM or HUP it stops the subcommand, removes the kept line and re-raises.
  The subcommand holds no trap, so it stops at once and starts nothing more, as the single shell before #7967 did; a
  request already sent may still finish, as before. The subshell resets INT (bash ignores it in a background job) and
  is handed stdin with `<&0` (a post body is read from there). A signal prints no line: whoever sent it knows why.
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
4. Review 3: TERM and HUP to the command stop it within 5 s against a board that never answers; Ctrl-C likewise. done
5. Review 4: after a TERM to the command alone, a polling read asks the board nothing more (the TERM trap removed as a
   mutant fails it); a piped post body still reaches the board (`<&0` removed as a mutant fails it). done
