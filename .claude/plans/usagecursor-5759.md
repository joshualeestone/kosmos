# usagecursor-5759: Token Usage reads only what today's transcripts gained since the last open

Card: joshualeestone/kosmos#5759 (follow-up to #5363). Measured on the fleet Mac at 0.7.35: with every past day frozen,
`/api/usage?days=14` took 10 to 11 s, re-reading 155 of today's transcripts (392 MB) on every open.

## Change (engine/usage.js)
- `scanDayCursor(day)`: per transcript, in this board process, how far it was read (bytes), its first cwd, the launch
  folder its rows were counted under, and what its rows added for the day. The next call reads only the bytes after
  the cursor and sums the per-file results.
- `dailyUsageByModel` uses it when today is the only missing day; any past day missing keeps the full `scanUsage`.
- Exactness, the card's done condition (totals equal to a full rescan). The cursor throws `Rebuild` and reads every
  file from the start, in (root, sorted path) order, whenever an incremental read could disagree with a full read:
  - a file that vanished, could not be stat-ed or read, shrank below its cursor, or has another inode;
  - a message id already counted for a file that sorts AFTER the one now holding it (seenIds keeps the first copy);
  - a launch folder that changes after rows were counted (a first cwd written late; a subagent's parent changing);
  - a new UTC day or other config roots start a fresh cursor.
- A last line with no newline is taken only when it parses whole (as the full read's split parses it); a half
  line is left for the next call.
- A skipped (old) parent's first cwd is head-read once per version of the file, and at most once a pass.
- Calls are chained, so two requests never move one cursor at once.

## Tests (engine/usage-cursor-5759.test.js)
Every step asserts the cursor's answer deep-equals `scanUsage` on the same files, and whether it rebuilt and how
many bytes it read: appends, half and unterminated lines, duplicates in files sorting after and before the owner,
id-less rows, other days, a late first cwd, subagents (orphan, adopted, of a skipped parent), an unreadable skipped
parent with two subagents, shrink, replace, delete, a seeded 300-step random run, and `dailyUsageByModel` reading
nothing new on its second open. Each safeguard was removed in turn and a test went red (14 mutants; the size and inode checks each have a case only
they catch, with the mtime put back).

## Weakest premise
That appending is the only way a transcript grows. Caught: a shrink, a new inode, and any rewrite that changes the
last 64 bytes before the cursor (the seam, read back whenever the file grew or its mtime moved). Missed until the
next rebuild: a same-size rewrite that leaves those 64 bytes alone, or a rewrite with the mtime put back to the
nanosecond. A test pins that miss as the stated bound. Claude Code appends.

## Review round 1 fixes
- The seam: a file truncated and rewritten longer on the same inode was read from the middle of new content.
- Every listed file is opened on every pass, so one that became unreadable is dropped and counted, as a full read
  does; an empty unopenable new file counts; a skipped parent's saved head is trusted only while it still opens.
- The result is summed in (root, path) order, so its keys come in a full read's order (the tests compare key order).
- `bytesConsumed` (was bytesRead): a half line left for later is re-read, not consumed.
- Left as is (NIT, now in the code comment): a writer extending an already-whole unterminated line into something
  unparseable is not caught; none does.

## Not covered
- The done condition is measured on the RUNNING board after release (under 2 s late in the UTC day); not measured
  here. The card stays open for that.
- In memory only: the first open after a board restart, and every open with a past day missing, read in full.
- A resumed session whose new file sorts before the original rebuilds once each time it gains a copied message.

## Review round 2 fixes
- A transcript too big to decode (past Node's longest string, about 512 MB) threw out of the call and broke the page
  on every open; the full read counts it unreadable. The decode is inside the guarded read now, a new file over the
  full read's 2 GiB readFile limit is unreadable before any read, and a known file grown past the longest string is
  read again from the start, where the whole-file decode decides as the full read's does. `CURSOR_LIMITS` lets the
  tests lower those limits.
- Size, inode and mtime come from the OPENED file (fstat), so a file swapped between the stat and the open is not
  mixed in.
- A skipped parent's stat and open probe run at most once a pass, and a failed close is not an error.
- 16 mutants, each caught.

## Review round 3 (Opus)
No BLOCKER, WARNING or CONVENTION. The reviewer fuzzed 18 seeds of 300 steps (two roots, nested subagents, deletes,
mtimes set back, truncation, chmod) against the full read, all equal except the stated unterminated-line bound; and
measured the real ~/.claude read-only: first call 2.1 s, second 254 ms (15 KB new), totals equal to the full read,
memory kept about 0 MB. Fixed (comments only): the docblock's "every call costs 4 to 6 s" now names the opens that
still read in full; the three test exports say they are for tests only. Left as is (NITs): resetDayCursor is not
chained (tests call it between awaited calls); a known file over the longest string rebuilds every call, and a new one
that cannot decode is re-read every call (no worse than before); yesterday's cursor is held until the next cursor call.

## Review round 4 fixes
- The random test's generator (a multiply-mod in doubles) lost its low bits and produced only even ops, so cwd lines,
  new files and subagents never happened in it. It uses mulberry32 now and asserts every kind of step ran and a
  subagent was made; on its own it now catches the launch-change mutant.
- The "Round N:" labels in the code comments and test titles are gone (the round history is this file); each reason
  stays.
- The docblock's cost figure names its measurement (0.7.35, 2026-10-10, 10 to 11 s); the -1 sentinel is commented.

## Review round 5 (Opus)
No BLOCKER, WARNING or CONVENTION. The reviewer's own differential fuzzer (16 step kinds, CRLF, garbage lines, nested
subagents, multibyte text, unreadable and readable again) matched the full read on 24 seeds of 400 steps, outside the
stated unterminated-line bound. NITs left as is: that bound could be closed by remembering an open tail and rebuilding
if the next byte is not a newline (about three lines; not done, no writer does it); a new file just over the longest
string that ends in a half line is counted where the full read fails (unreachable in practice); the docblock's rebuild
list omits an mtime set back below the cut and a changed root index (both rebuild); a non-real date leaves the last
run stats as they were; the key-order check covers days and folders but not folderModels.
