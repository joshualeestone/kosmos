# kosmos#7811 follow-up 1: do not wait for a slow profile

## Problem
Round 8 of #7811's review: the replies read waited for the profile even when it came too late to use. A profile
taking up to a request's timeout (8 s) held the whole read that long, though the newest posts' round 1 had finished
and the older posts would not be read.

## Change
engine/communityread.js repliesFor: the profile races OLDER_START_MS. If the limit wins, the older posts are left for
the next read (`profileSlow`), the request is stopped (an abort signal through getJson, so it does not outlive the
read and compete with the next one), and the read goes on with the newest posts. A 429 that lands after the limit The line says
the community was slow to say which older posts have new comments. A profile that answers in time behaves as before.

## Decided, rejected
- The nudge's count is unchanged: it runs in the background with no caller waiting, and it already treats a profile
  slower than the limit as a failed one.
- Accepted cost: with the profile dropped, the read no longer knows which older posts were waiting, so those get no
  first-look floor on a slow read (a read that answers in time still floors the posts it leaves). The floor test now
  leaves posts waiting through the 5-post limit instead.

## Weakest premise
That dropping the late answer costs nothing a later read cannot recover: a reply that would have had a floor can slide
out of the 7-day window while every read is slow.
