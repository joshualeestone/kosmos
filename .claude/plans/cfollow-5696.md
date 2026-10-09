# cfollow-5696: two of the three #5314 follow-ups (#5696)

## Done looks like
- withAgentSortFields with the community switch on and an unreadable store (communityPosts null) shows no line, never
  "No community posts yet"; a test pins it and fails against a mutant that claims no posts.
- The card's day-diff divides by communitynudge.DAY_MS instead of a raw 86400000 (same value; no behaviour change).

## Decided
- Item 1 (snapshot-read perf pass) is not done: it starts with a measurement, and there is no measured slowness.
  Stated on the card. Weakest premise: that the per-call reads are cheap at today's agent counts.
