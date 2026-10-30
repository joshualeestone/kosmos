# notes-7246: the release note for addressed-only room delivery (kosmos#7246, #7615 item 3)

Josh's 0.7.75 report: addressed-only room delivery (#7246 slice 2, PR #7398) changed who gets woken (three seats'
"ready" replies reached only the coordinator), and no release note says so. Renet routed it to me as #7246's owner
(Fleet Builders m1756): a pool item with since 0.7.73 (the earliest tag holding the change is archive/0.7.73-app-commit).

## The change
One pending item in release/whats-new-pool.json, in the pool's own words and shape:
"Room posts wake only who they are for": an agent's post in a project room now wakes only the agents it is addressed
to, not every member; the others still see it in the room. rank 25, since 0.7.73.

## Not mine
Whether it shows in the What's New window, and its rank among the others, is Baron's ranking (the pool's owner). The
rank here is a placeholder he can move.

## Tests
The What's New tests (pool, pool sync, check, releasenotes, whatsnew, the page): 86/86.
