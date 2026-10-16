# qhstale-6337: the stale-TMPDIR arm of test-queued-heavy-4977 cannot hang the shard (kosmos#6337)

## Why
On PR #6336's CI (run 38973121430) `suite (shell 2/2)` was killed at the file's 900 s cap: after the
`#5467: the arguments file ... is gone once read` line nothing printed for about 8 minutes. The next arm,
`#5467: a stale TMPDIR falls back to /tmp and the run still takes its turn`, ran `o=$(... $QH "stale-tmpdir" true)`.

## What was actually wrong
The arm was already bounded: `$QH` is the test's shim, which runs the wrapper under `perl -e 'alarm(...)'` for 240 s.
But a command substitution waits for EVERY process holding its pipe, so a child the wrapper left behind kept `$(...)`
open after the alarm killed the wrapper. Measured with a standalone reproduction (a wrapper that leaves a child on
stdout, under alarm 2): the `$(...)` form returned after 30 s, the file form after 2 s with rc 142. Why the turn did
not come on that CI run is not established; this change makes the arm unable to hang whatever the cause.

## Change
- `tools/test-queued-heavy-4977.sh`, the stale-TMPDIR arm: runs under its own `alarm 60` with output to a file
  (`$S/stale5467.out`), waits only for that process, reads the file, and on rc 142 appends
  "TIMED OUT: the stale-TMPDIR run did not take its turn within 60 s (kosmos#6337)" to what the failing `ok` prints.
  The assertion is unchanged.
- The pipe-status lint (#632) scans the whole file on any change and flagged two older lines: `reap()` (line 87) now
  strips spaces with `${var// /}` instead of `ps ... | tr -d ' '` (same result, no pipe beside its `$?` reads), and
  line 512's `r=$?` (reap's own status) is marked `# pipe-status-ok`.

## Verified
- The file run alone, twice (before and after the reap() change): 142 OK, 0 BAD, exit 0.

## Known limits
- Only this arm moves to a file capture. Other arms still use `o=$(...)` with the shim's alarm; they have not hung,
  and changing them all is a wider change than the card asks for.
