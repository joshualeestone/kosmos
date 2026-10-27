# schtasks-7299: the schtasks matcher's round-8 leftovers from #7270

Card: kosmos#7299 (follow-up filed when #7300 merged at the 8-round review cap; no BLOCKER).

## Finished looks like

tools/lib/schtasks-call.cjs reads a redirect among command's, nice/exec/time's and timeout's switches as the outer
shell's (not a switch), each prefix keyword takes only its own valued switches, env's -- ends its options, and the
argv `>x` behaviour of valueAt is stated in its comment. Tests in tools.windows-tests-schtasks-7247.test.js fail on
main for each behaviour change.

## Steps

1. command/builtin -v loop: skip redirect words (command >nul -v schtasks is a lookup).
2. nice/exec/time/... loop: skip a redirect first; the valued switches are keyed to the keyword (nice -n/--adjustment,
   exec -a, time -f/-o/--format/--output).
3. timeout loop: skip a redirect first.
4. env: -- ends the options.
5. valueAt's comment names the argv `>x` case (PowerShell rejects the value; left as is).
6. Test: three cases measured wrong on main, with controls.

## Decided

- The card called the command -v case a false refusal. Measured, the timeout redirect case was worse: on main
  `timeout >-k 5 schtasks` let a real schtasks call through (the file -k read as timeout's -k, so "schtasks" became the
  duration). It is now caught, and the test asserts it.
- NITs 3 and 4 change no answer for any form a real shell would run (every differing form is an invalid option), so
  they are stated in code, not asserted by a test.
- Weakest premise: that the prefix keyword list's other members (then, else, do, while, until, {, !) take no valued
  switches; they get none now, which is the stricter read.
