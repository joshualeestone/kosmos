# gnulint-6808: a lint for GNU-only forms in product shell code

Card: joshualeestone/kosmos#6808. With #6791 (PR #6795) most of test:shell runs on Linux only in PR CI, so a GNU-only
form in product shell code passes its test on Linux and is first run on a Mac at the release cut.

## Finished looks like
A test in test:shell that flags the common GNU-only forms in non-test shell files, red on planted examples, green on
the tree, and that allows the GNU-first-with-BSD-fallback idiom. It reads files only, so it means the same on Linux
and on a Mac.

## Changes
- New `tools/test-gnu-only-forms-6808.sh`: the scanner and its tests (long spellings included). Forms: `sed -i` with the script after it,
  `date -d`, `stat -c`, `base64 -w`, `timeout N`, `grep -P`, `find -printf`. Each but the last two has a BSD
  counterpart; a hit is the idiom (allowed) when its counterpart is on the same line joined by `||`, or on the line
  directly beside it. `# gnu-ok: <why>` on a line excuses it. Comment lines are not read. 23 planted forms flagged,
  14 allowed shapes kept, the tree's two-line idioms allowed, a counterpart 2 or 5 lines away not; then every tracked
  product shell file (117 today, floor 100).
- `package.json` test:shell runs it (with its `bash -n`), at the end.

## Decisions
- **The lint, not a scheduled macOS run.** The card offered both. A lint fails in the PR that adds the form, names the
  line, and costs no runner; a scheduled run finds it after merge and needs someone to read it.
- **A counterpart on the same `||` chain or the next line, not "errors silenced".** All 5 GNU forms on the tree today sit beside their BSD form
  (same line or the next). Accepting any `2>/dev/null` would excuse `sed -i 's/x/y/' f 2>/dev/null`, which fails
  silently on a Mac, the worst case.
- **Not flagged:** `readlink -f` (macOS has it since 12.3; Kosmos's floor is 13.5, `MACOS_FLOOR_*` in
  install/setup.sh), `xargs -r`, `sort -V` (macOS has them).
- **Test files are out of scope** (as the card says): many are Linux-only on purpose, and a GNU form in one goes red on
  the macOS full suite at the cut.

## Review rounds (2026-10-21)
- **Round 1 (SHOULDs, all on regex reach):** a 3-line window excused an unrelated command (a BSD stat for another file),
  and a line with `sed -i ''` excused a GNU `sed -i` joined by `&&`. Now: same line only when joined by `||` (timeout:
  `&&`, its guard idiom), else the line directly beside. Also caught now: long spellings, flags with digits before the
  one that matters (`grep -m1 -oP`), `date -d@N`, `stat -Lc`, `timeout "$T"`, a command after a quote, a path or a
  brace (`bash -c "sed -i ..."`, `/usr/bin/sed`); `sed -Ei ''` allowed; `#! /bin/sh` shebangs listed.
  Documented, not built: backslash-continued commands, and the other GNU-only tools (header, "A FLOOR, NOT A PROOF").

- **Round 2 (one SHOULD):** any `||` on the line excused a hit, so `sed -i '' a && sed -i 's/p/q/' b || true` passed.
  Now the line is split at `;` and `&&`, and each piece holding a GNU form needs its counterpart and a `||` in that
  piece. Two must-flag cases added. Header: a form inside any quoted string is flagged (B counts a quote).

- **Round 3 (one SHOULD, a regression of round 2):** splitting at every `;` broke a quoted sed script
  (`sed -i '' 's/a/b/;s/c/d/' f || sed -i ...` was flagged). Now an awk walker splits at `;` and `&&` outside quotes
  only. Two allow cases added (a quoted `;` in sed and in a date format).

- **Round 4 (one SHOULD):** an escaped quote (`\"`, `\'`) opened a quote that never closed and merged the rest of the
  line into one piece, which could only excuse. A backslash outside single quotes now takes the next character with
  it. Two must-flag cases added; mutant (the backslash rule removed) turns both red.

## Weakest premise
- That these seven forms are "the common ones". The list is from the card plus the coreutils options macOS lacks. A
  form not on it (GNU `cp --reflink`, `ls --time-style`, long options generally) still slips through; the lint is a
  floor, not a proof.
- Not run on GNU grep. The patterns use only ERE and POSIX classes, so GNU and BSD grep read them alike, but this was run
  on macOS only. It will run on Linux once #6795 moves test:shell there.

## What would change my mind
- A false positive on real product code that the counterpart window cannot express: then a per-file `gnu-ok` header
  for Linux-only files rather than widening the window.
