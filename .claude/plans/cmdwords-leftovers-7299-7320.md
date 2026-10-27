# cmdwords-leftovers-7299-7320

**Posture:** production

Addresses #7299 (the schtasks matcher's round-8 leftovers from #7270, built on branch schtasks-leftovers-7299 against
the old tools/lib/schtasks-call.cjs, 4 review rounds there) and #7320 (#7262's round-7 leftovers), ported together onto
tools/lib/command-words.cjs, which #7316 (#7262) moved the reader into. Stacked on #7316 (f9dd5a35d4, final).

## Done when
1. All #7299 tests (carried over in tools.windows-tests-schtasks-7247.test.js) pass on the shared reader.
2. Each #7320 shape has a row in tools.command-words-7262.test.js's SHAPES (both guards agree): bash -c -- / -c -x,
   eval, coproc, sudo -R, echo \>&P. The escape spellings ($'gh', g\h, cmd's ^) have their own test (their P cannot be
   a Windows path inside an escape).
3. The "$( recursion is capped; the two header lines say what the code does.

## Ported from #7299
- PREFIX_VALUE per word with combined short switches (only that program's flag letters before the valued one) and GNU
  long-option prefixes (longOpt). #7299 NIT 3 (one shared set) was already fixed by #7316 round 5; dropped.
- command -v, the prefix loop and timeout skip redirect words; timeout -[fpv]*[sk] and --sig/--kill prefixes.
- env: -- ends options; every word holding = is an assignment (a-b=1); -iu/-iC/-iP/-iS; -S's STRING read every way the
  shell may have left it (readings/unshell), split by env's own rules (envSplit: quotes, \_, \c, #, ${VAR}) and read as
  env's arguments, and also read as a shell line (splitInto). -P kept from #7316.

## #7320
- POSIX -c: the script is the first operand after the options (-- ends them).
- eval: its arguments joined and read as a command line; coproc a prefix word.
- sudo -R DIR / --chroot take a value.
- A word's unescaped spelling is returned too: POSIX $'..' and backslashes, cmd's ^.
- commands(): an escape resets prev, so echo \>&gh cuts at &; the "$( recursion is capped at DEPTH.
- Header: "began in schtasks-call.cjs (#7270), and #7262 moved it"; the callWords line names nohup/time/nice/timeout.

## Verification
- tools.windows-tests-schtasks-7247.test.js + tools.command-words-7262.test.js + engine/windows-tests-1777.test.js under
  the schtasks preload: 64 tests, 63 pass, 1 skip (#7262's Windows tool-guard skip, which #7318 removes), 0 fail.
- Negative control: against #7316's command-words.cjs, 8 tests fail (6 #7299, the SHAPES table, the #7320 test).
- 87 engine/*win32*.test.js under the guard: 1588 tests, 0 fail, 0 refusals.

## Weakest part
Extra spellings and readings only add words, so they can only add refusals of calls that contain the guarded name;
that is the accepted side. The unescaped spelling of a Windows path in a POSIX reading (C:\x -> C:x) is a meaningless
extra word, harmless for the same reason.

## Review rounds
