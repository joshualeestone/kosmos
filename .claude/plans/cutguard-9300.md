# cutguard-9300: a backed-off break-lock taker leaves no empty break dir (kosmos#9300)

## Finished looks like
When two writers both try to break a stale beside-runs lock and back off (each saw the other's token), the break dir
does not survive them, so the next writer's poll can break the stale lock at once, instead of after 60 s. A test fails
on the old code and passes on the new.

## Cause (reasoned from the code and the CI leftover, then reproduced deterministically)
_kosmos_beside_lock (tools/lib/cut-guard.sh): a taker makes "$d.break", writes its token, and breaks only if its token
is the dir's only entry (review 8 of #9139). If not, it removed only its own token and backed off. Two takers that saw
each other both did that, so the EMPTY dir stayed. Every later writer then failed `mkdir "$d.break"`, took the branch
that clears a break dir only once it is 60 s old, and could not break the stale lock until then.

CI 11-28 09:59 UTC (PR #9299, run 46132477969): tools/test-cut-guard.sh's twenty concurrent writers (its #9139 load
tests) can produce exactly that on a loaded runner, and the dead-holder, 400 s and pid-0 checks run within 60 s after,
so all three failed with beside-runs.log.lock.break left. Not reproduced by six plain local runs of the file.

## The change
One line on the back-off path: `rmdir "$d.break"`. rmdir removes only an empty dir, so while the other taker's token is
there it does nothing and that taker (now also running this line) removes it. If a third taker made a fresh dir after
it emptied, a late rmdir can remove that one before its token lands; that taker's write then fails and it neither
breaks nor leaks, and polls again.

## Test
tools/test-cut-guard.sh, after the pid-0 check: the ownership check is wrapped to answer "not only me" once (as when
another taker's token landed), with a pid-0 lock. The writer must break the lock on its next poll, write its line, and
leave no break dir. Measured: on the old code it fails, leaving beside-runs.log.lock and beside-runs.log.lock.break
(the CI leftover); with the fix 256 of 256 pass, three runs.

## Weakest premise
That the CI failure came from two takers colliding in the twenty-writer tests. It fits the leftover and the timing, and
the forced back-off reproduces the exact state, but the collision itself was not caught on CI.
