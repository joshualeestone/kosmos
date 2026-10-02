---
pre_challenge: true
method: challenge-loop
branch: postcadence-4947
diff_hash: 847b9ff8f758e11a44f03276d8ae2821c33fa0296f4dcfc44d0912effb342836
subdir_audit: passed
timestamp: 2026-10-02T02:54:01Z
converged: true
---

## Challenge loop: nine blind rounds, Opus and Sonnet alternating; round 9 found nothing

Ledger in `.claude/plans/postcadence-4947.md` (Review rounds). From round 4 each reviewer read the plan only up to Review rounds and
the diff without .claude/plans (rounds 3's reviewer saw the plan whole and is not counted as blind).

## [WARNING] round 1, FIXED: a comment contradicted the service's own cap
engine/communitysend.js said 3 a day, my comment 50; measured: the service's code defaults POSTS_PER_AGENT_PER_DAY to 3,
production is 50 (Mona Lisa read the running service, 21:32). Comments now name the setting.

## [WARNING] round 3, FIXED: a post past the cap was told plainly "Posted"
postLater, the route's later: true, and both CLIs now say it goes once the cap lifts.

## [WARNING] round 4, FIXED: the promise was made for posts that would never be sent
postWaits = willSend's gate (Community on, allowed address, key not refused, readable state) and the wait, asked before
the store write. Route test drives postWaits (a live sweep rewrites the keys file under a seeded test).

## [WARNING] round 6, FIXED: a held post could carry later: true
later is sent only with a published post.

## [WARNING] round 7, FIXED: the block said posts go public straight away with no exception
The block names the cap exception in the post command's words.

## [WARNING] rounds 5 and 8, DOCUMENTED and PINNED: asking willSend from the post route records the ON period's start
Decided (a post made before the first sweep of an ON period is now sent, as a comment was); tested.

## Card refinement mid-loop
Josh 21:33 (via Splinter): at least once a day, no more than 5, honesty intact; the bullet rewritten with the honest post
an agent with nothing finished has and "never invent". An over-broad reply-rule guard was narrowed to the reply rule.

## Known and owned elsewhere
A per-minute 429 read as the daily cap: #4953 (Mona Lisa). The post that crosses a cap-3 deployment's limit is answered
plainly (the cap is known only after the service's 429).

## After convergence
Merged origin/main after #4952 (#4938): conflicts in the test file (both added tests; kept both), the communitysend
header and exports (union: sendSoon and postLater/postWaits), and the post route (kept later and sendSoon). The two
period-start records are both first-writer-wins; #4938 recordPeriodStart is the named one, the comment says so. Every
community test file green.
