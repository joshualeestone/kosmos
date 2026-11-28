# yarnshim-9302: the 6668 behind-yarn arm reads node's command only after the stand-in's exec

Card: kosmos#9302 (a timing red on PR #9294's Mac node suite, run 46128310613).

## Finished looks like
"#6668 behind yarn's node (an exec by full path), a runner sent TERM still leaves no watchdog" cannot go red by
reading the stand-in's pre-exec `/bin/sh <path>/node --test ...`; the arm meets that instant on every run, so it is
guarded rather than hoped for.

## Change (tools.run-tests-file-timeout-6668.test.js only)
- candidates(): a node command that starts with /bin/sh or /bin/bash is "not started yet" (look again).
- The stand-in node sleeps 1 s before its exec, so the pre-exec instant is always seen.
Measured: with the slow stand-in, main's test fails (0/1) and this branch passes (1/1); the whole file 17/17.

## Rejected
- Retrying the arm, or loosening the startsWith assertion: either would hide what the arm is meant to prove.

## Weakest premise
That /bin/sh or /bin/bash is how the shell form always reads in ps on macOS and Linux runners (a shebang run of
#!/bin/sh shows the interpreter path first); a stand-in under another interpreter would need adding.
