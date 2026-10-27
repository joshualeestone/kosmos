---
pre_challenge: true
method: challenge-loop
branch: cmdwords-leftovers-7299-7320
diff_hash: 14dc27330b68d9f46d0291e3c53b6293db439516ef04da65d7b49d6079bdc968
validation: tools.windows-tests-schtasks-7247.test.js + tools.command-words-7262.test.js + engine/windows-tests-1777.test.js under the schtasks preload on the Windows box 67/67 (1 skip: #7262's Windows tool-guard skip, removed by #7318); all 87 engine/*win32*.test.js under the guard 1588 tests 0 fail 0 refusals; full suite via CI
subdir_audit: passed
timestamp: 2026-10-27T10:09:47Z
iterations: 5
converged: true
---

# Pre-PR review proof: cmdwords-leftovers-7299-7320

**Iterations:** 5
**Converged:** Yes. The last round found no BLOCKER and no WARNING; its NITs are recorded below.
**Per-round record:** .claude/plans/cmdwords-leftovers-7299-7320.md

## Rounds

#### Iteration 1
- Round 1: no BLOCKER (about 160 fixed calls and 200k fuzz vs main and f9dd5a35d4: every f9dd-true/HEAD-false row is an
  option's value, not a program; no new false refusal; nothing slow or throwing). 2 WARNINGs, 3 NITs. FIXED: eval drops
  a double-quoted argument's escapes before reading it (eval "echo a\'; schtasks; ..."); the unescaped spelling is also
  walked as the command word, so b\ash -c, $'eval', e\nv and c^md /c are read as launchers; unescaping only in a line a
  shell reads (not a spawn argument), and cmd's caret only outside quotes; $'...' decodes \xHH, \NNN, \uHHHH. NIT
  ACCEPTED: eval nested past DEPTH 6. Reviewer NIT corrected by a live probe: cmd /c "ec^ho" hi printed hi (the /c
  quote stripping exposes the caret), so cmd /c "sch^tasks" IS refused, and the test says so. Negative control: the new
  test fails against round 0. 64/64 (1 skip, #7318's); 87 win32 files 0 fail 0 refusals.

#### Iteration 2
- Round 2: no BLOCKER (every HEAD miss the base also misses; linear to 16,000 escaped words; no throw). 2 WARNINGs, 3
  NITs. FIXED: an escaped word whose plain spelling is a launcher or prefix (SPECIAL) and whose escaped one is not now
  simply becomes the command word in the same loop, so a flat chain (n\ice x8) costs no depth (eval chains still nest,
  as eval really re-parses, and stop at DEPTH like plain eval); $'...' decodes \U and a NUL ends the word; the POSIX
  unescape is one left-to-right pass as bash reads it ($'sch\tasks', \$'sch'tasks no longer read as schtasks; A\=1 x
  checked from a file: no longer an assignment). ACCEPTED: carets in a PowerShell line read as cmd's (refusal of the
  guarded word only); g\h.exe in an exec line also read as gh.exe (same). Negative control: the new test fails against
  round 1. 65/65 (1 skip, #7318's); 87 win32 files 0 fail 0 refusals.

#### Iteration 3
- Round 3 (after rebasing onto main 2fbb0884c1): 1 BLOCKER (cost), 1 WARNING, 1 NIT; detection clean (two 200k fuzzes
  vs main: every main-true/HEAD-false row checked runs nothing; 20/20 stable runs of both test files). BLOCKER FIXED:
  nested env -S with a value that has several readings branched eight ways a level (the reviewer's input: 25.5 s at
  1000 trailing words on round 2, 160 s in the test at 4000); each line reading and each -S split is now done once per
  call unless it recurs shallower (once(), a memo on out): 26 ms at 4000, and detection on the reviewer's script
  matches main row for row. The new timing test fails on round 2's reader (160 s). WARNING FIXED: $"..." is a double
  quote (bash ran $"echo" HIT). NIT FIXED: C escapes in $'...' are control characters. 66/66 (1 skip).

#### Iteration 4
- Round 4: no BLOCKER (strict), 1 WARNING, 2 NITs; cost linear on everything built (worst 135 ms); 2x200k fuzz vs
  HEAD~1 and main. WARNING FIXED: splitInto's memo key joined the following words' raw text, so one argument x" "schtasks
  and two words "x" "schtasks" collided and the first seen hid the second, which really runs schtasks (HEAD~1 caught
  it); the key is now the words' structure (raw, quoted, inner, redirect). Test added; it fails on round 3. NITs
  ACCEPTED: $" schtasks " reads as schtasks (cosmetic refusal, as " schtasks " already did); bash -c bash\ -c\ schtasks
  is missed by main and here alike (named in the PR's known limits). 67/67 (1 skip); win32 sweep below.

#### Iteration 5
- Round 5: no BLOCKER, no WARNING, 1 NIT (the splitInto key encodes `after` even when every string is skipped; bounded
  by the depth cap, measured fine; left). Both memo keys proven collision-free by reading every caller; memo vs no memo
  over 3x200k flat fuzz, 3x200k nested fuzz (about 155k memo skips a run) and the 1719-string test corpus: 0
  differences in the full word list. vs main: 0 schtasks calls missed over 400k fuzz. Cost linear on 12 adversarial
  shapes (worst 310 ms at 4000 commands). 10/10 runs of both test files. Converged.

### Final Ledger
- [NIT] splitInto's memo key encodes the following words even when every string is then skipped (bounded by the depth cap; measured fine) --> ACCEPTED
- [NIT] $" schtasks " reads as schtasks (cosmetic refusal of the guarded word, as " schtasks " already did) --> ACCEPTED
- [NIT] bash -c bash\ -c\ schtasks is missed, by main as well (not a regression) --> ACCEPTED, named in the PR's known limits
- [NIT] carets in a PowerShell line are read as cmd's (refusal of the guarded word only) --> ACCEPTED
- [NIT] eval nested past DEPTH 6 is not read (the same cap as every shell layer) --> ACCEPTED
