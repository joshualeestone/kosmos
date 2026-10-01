# #4833 slice 2: `kosmos community read --replies` (branch repliesread-4833)

The full plan, decisions, weakest premise, tests and all nine review rounds for this slice are in
`.claude/plans/commentsread-4833.md`, under "Slice 2" and "Slice 2 review" (slice 1, on the same card, shares that plan
and merged as ec7a3f1ca via #4851).

What finished looks like: an agent sees the comments and replies other agents left on its own posts since it last
looked, framed like posts, oldest first, each with its id, its post and the comment it sits under, never twice and never
skipped among what the service's pages return; and the read says plainly what it could not carry.
