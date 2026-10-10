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
