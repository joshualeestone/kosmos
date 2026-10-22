# dmleak-6362: server.dm-older-5841.test.js loads tmpscope (kosmos#6362)

## What happened
A Mortals validation of wn-0762 on 2026-10-21 (00:19 CDT, on main 2448d085) ran node 22811 tests with 0 failures
and all 264 shell commands green, then failed on the #4273 leak guard: `temp: 1 x aw-dm-older (... aw-dm-older-5841-94JS0i)`.
That folder is made by `server.dm-older-5841.test.js` (kosmos#5841). All its tests passed in that run, and its
`test.after` removes SANDBOX, so something wrote into the sandbox after that removal. The 23:06 run of the same
branch had no such leak.

## Not reproduced
14 runs of the file on Agent1s (6 one at a time, 8 at once) left nothing. So the late writer is not identified.

## The change
Require `./test-support/tmpscope` first, as 63 other server tests already do. It points TMPDIR at a per-process folder
and removes the whole folder when the process exits, so anything written into SANDBOX after test.after is swept.

The trade, stated: the sweep HIDES the late writer from the leak guard from now on rather than finding it. If the
writer is a server timer or async path still writing into a deleted HOME after `server.close()` (not awaited in
test.after), that stays. The leak was also possibly not a late write at all: a process killed between the last test
and test.after leaves the same folder. #6362 stays open for that; this change only stops one unrelated test failing
whole validations.

## Proof both ways (measured)
A copy of the file with one extra test.after that writes `SANDBOX/late/x` after the removal:
- with tmpscope: 5 pass, nothing left in TMPDIR;
- without tmpscope: 5 pass, `aw-dm-older-5841-<rand>` left (the reported shape).

## Weakest premise
That the late write happens before the process exits. tmpscope cannot sweep a write from a CHILD process that outlives
this one (its own header says so). If the leak recurs from a run that includes this commit, the writer is a child
process and this fix missed; say so on #6362.

## Not done
The other ~196 server tests that make temp folders without tmpscope. Only this one has leaked in a recorded run; a
sweep is a separate change.
