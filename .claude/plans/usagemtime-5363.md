# #5363: Token Usage reads only the transcripts written since its window began

## The defect
Every open of Token Usage read and parsed every transcript ever written: today is never frozen, so `scanUsage` ran on
each open. On the fleet Mac that took 6.9 minutes (card, measured 2026-10-05). The cost grew with all of history, not
with today's work.

## The change (engine/usage.js `scanUsage`)
- **Skip by mtime:** a transcript whose mtime is earlier than one hour before the window's first day is not read.
  - A row is appended when it is written, so such a file holds no row in the window.
  - Both a row's timestamp and a file's mtime are absolute times, so the margin only covers clock drift.
- **The trap (the card names it):** a subagent transcript takes its launch folder from its top-level session's file.
  - A skipped top-level session is remembered.
  - When one of its subagents IS read, the parent's first cwd is read then (`firstCwd`): line by line, stopping at the
    first, with the same rule as the full read.
  - Head-reading every skipped session up front was 14,196 file opens.
- **Dedup (`seenIds`) is unaffected:** a skipped file holds no row in the window.

## Measured on the fleet Mac (2026-10-05, real data, nice 10)
Setup:
- the real config roots, 7 of them;
- the live usage cache COPIED into a sandbox data folder under ~/.cache. A data folder under temp makes configRoots
  refuse the real roots, which made my first two numbers meaningless.

| Stage | Files | Time |
|---|---|---|
| Before (the card) | all 85,008 | 411,762 ms |
| One-day margin, eager head reads | 3,143 read (4.4 GB) and 14,196 head reads | 19,484 ms |
| Now: one-hour margin, lazy head reads | | 4,313 ms and 4,115 ms |

Today's totals were present in the last run (617,948 output tokens over 11 folders). The rest of the time is reading
today's own files: the byte-offset cursor the docblock already names as separate work.

## Decided
- **The margin is one hour, not a day.** Rejected the day: it doubled the read (yesterday's files) for a time-zone risk
  that does not exist (both times are absolute).
- **Lazy head read, not eager.**
- **Rejected:** a per-file byte cursor in this card. It is the named longer fix, with its own invalidation questions.

**Weakest premise:** that a file's mtime is never earlier than its newest row. A file restored from a backup or
copied with its mtime preserved (cp -p) would break it, and its in-window rows would be missed.

**Check still to do:** an equivalence run of today's totals and per-folder split, new code against a full read of all
history (7 minutes of disk). Deferred to after the 03:00 cut, so it does not load the box during it.

## Tests: engine/usage-mtime-5363.test.js
- an old file (2 h before) holding an in-window row is not read; a file inside the margin (30 min) is; an unbounded
  scan reads both (control);
- **the trap:** a subagent written today, under a parent last written 2 days before, is keyed to the parent's launch
  folder;
- a skipped parent with no cwd leaves the subagent its own;
- dedup across a resumed copy still holds.

Controls go red with:
- the head read removed;
- the skip removed;
- the lazy read returning nothing.

engine/usage.test.js still passes (29/29 across both files).

## Review round 1 (opus)
- [W] TAKEN AS A MERGE GATE: the equivalence check (today's totals and per-folder split, this code against a full
  read of all history on the fleet Mac) runs after the 03:00 cut, and is recorded here BEFORE merge. Every test so
  far uses fixtures, and this changes the per-agent attribution behind a dollar figure.
- [W] RECORDED (weakest premise, second route): a row's timestamp is the writer's clock and the mtime is the
  filesystem's. On a network volume whose server clock runs more than an hour behind, a file written today could
  show an mtime before the cut, and its rows would be missed silently. All 7 config roots on the fleet Mac are local
  home folders. Not changed: a per-volume margin is extra machinery for a case not present here.
- [N] FIXED: firstCwd and windowCutMs moved above scanUsage's JSDoc, which now names the cut; the subagent check is
  computed once; the test header says an hour.
- [N] FIXED: a test with two subagents and a depth-2 subagent under one skipped parent (all keyed to the parent; the
  head read is cached).
- FOLLOW-UP FILED: #5367 (the other providers' scans still read full history; same check, per provider).
