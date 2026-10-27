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
- Round 1: no BLOCKER (about 160 fixed calls and 200k fuzz vs main and f9dd5a35d4: every f9dd-true/HEAD-false row is an
  option's value, not a program; no new false refusal; nothing slow or throwing). 2 WARNINGs, 3 NITs. FIXED: eval drops
  a double-quoted argument's escapes before reading it (eval "echo a\'; schtasks; ..."); the unescaped spelling is also
  walked as the command word, so b\ash -c, $'eval', e\nv and c^md /c are read as launchers; unescaping only in a line a
  shell reads (not a spawn argument), and cmd's caret only outside quotes; $'...' decodes \xHH, \NNN, \uHHHH. NIT
  ACCEPTED: eval nested past DEPTH 6. Reviewer NIT corrected by a live probe: cmd /c "ec^ho" hi printed hi (the /c
  quote stripping exposes the caret), so cmd /c "sch^tasks" IS refused, and the test says so. Negative control: the new
  test fails against round 0. 64/64 (1 skip, #7318's); 87 win32 files 0 fail 0 refusals.
- Round 2: no BLOCKER (every HEAD miss the base also misses; linear to 16,000 escaped words; no throw). 2 WARNINGs, 3
  NITs. FIXED: an escaped word whose plain spelling is a launcher or prefix (SPECIAL) and whose escaped one is not now
  simply becomes the command word in the same loop, so a flat chain (n\ice x8) costs no depth (eval chains still nest,
  as eval really re-parses, and stop at DEPTH like plain eval); $'...' decodes \U and a NUL ends the word; the POSIX
  unescape is one left-to-right pass as bash reads it ($'sch\tasks', \$'sch'tasks no longer read as schtasks; A\=1 x
  checked from a file: no longer an assignment). ACCEPTED: carets in a PowerShell line read as cmd's (refusal of the
  guarded word only); g\h.exe in an exec line also read as gh.exe (same). Negative control: the new test fails against
  round 1. 65/65 (1 skip, #7318's); 87 win32 files 0 fail 0 refusals.
- Round 3 (after rebasing onto main 2fbb0884c1): 1 BLOCKER (cost), 1 WARNING, 1 NIT; detection clean (two 200k fuzzes
  vs main: every main-true/HEAD-false row checked runs nothing; 20/20 stable runs of both test files). BLOCKER FIXED:
  nested env -S with a value that has several readings branched eight ways a level (the reviewer's input: 25.5 s at
  1000 trailing words on round 2, 160 s in the test at 4000); each line reading and each -S split is now done once per
  call unless it recurs shallower (once(), a memo on out): 26 ms at 4000, and detection on the reviewer's script
  matches main row for row. The new timing test fails on round 2's reader (160 s). WARNING FIXED: $"..." is a double
  quote (bash ran $"echo" HIT). NIT FIXED: C escapes in $'...' are control characters. 66/66 (1 skip).
- Round 4: no BLOCKER (strict), 1 WARNING, 2 NITs; cost linear on everything built (worst 135 ms); 2x200k fuzz vs
  HEAD~1 and main. WARNING FIXED: splitInto's memo key joined the following words' raw text, so one argument x" "schtasks
  and two words "x" "schtasks" collided and the first seen hid the second, which really runs schtasks (HEAD~1 caught
  it); the key is now the words' structure (raw, quoted, inner, redirect). Test added; it fails on round 3. NITs
  ACCEPTED: $" schtasks " reads as schtasks (cosmetic refusal, as " schtasks " already did); bash -c bash\ -c\ schtasks
  is missed by main and here alike (named in the PR's known limits). 67/67 (1 skip); win32 sweep below.
- Round 5: no BLOCKER, no WARNING, 1 NIT (the splitInto key encodes `after` even when every string is skipped; bounded
  by the depth cap, measured fine; left). Both memo keys proven collision-free by reading every caller; memo vs no memo
  over 3x200k flat fuzz, 3x200k nested fuzz (about 155k memo skips a run) and the 1719-string test corpus: 0
  differences in the full word list. vs main: 0 schtasks calls missed over 400k fuzz. Cost linear on 12 adversarial
  shapes (worst 310 ms at 4000 commands). 10/10 runs of both test files. Converged.
