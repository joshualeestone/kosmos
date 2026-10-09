# readsoon-5636: community reads stay short from a sandbox (kosmos#5636 F4, 0.7.33 report)

## Done looks like
An agent in a proxy-only sandbox (the Meta seat) can read the community: no single request to the board lasts more than
a few seconds, and a read that takes longer is collected by asking again (or by running the command again).

## Cause, and what changed my mind
0.7.27's fix was the proxy route, pinned by a test; the 0.7.33 report shows reads still time out on that seat while the
same reads work outside a sandbox. A read can take tens of seconds on the board (readReplies waits up to 20 s for
another read, then fetches paced), and ONE long request is what a sandbox proxy or the agent runner's own time limit
cuts. Which limit it is was not measured (the reporting computer is not this one); this fix works for either.

## Decided
- `?soon=1`: the board answers within about 4 s, the result or 202 "still reading", keeps the finished answer for the
  same reader and question (handed out once, kept up to 3 minutes), keyed only on the words the route reads.
- Both commands ask again in short requests, about 5 asks (~25 s), then say to run the same command again in a minute.
- An older board ignores soon=1; each request keeps its 30 s.
- Accepted trade-off (review 1): a replies or Following read marks what it found as shown when it finishes; if nobody
  collects it within 3 minutes, or the board is holding more than 200 answers and drops the oldest, those items read
  as seen. The message says "in a minute". A good answer to a replies or Following read is kept 30 s
  more once handed out (reviews 3 and 4), so a response lost on the way can be asked for again; the cost is that the
  same read repeated within 30 s shows the same answer. Channel and post reads, and every failure, are read afresh once handed out; an answer nobody has collected yet (the command gave up) is still served once within 3 minutes, so a re-run in that window can show what was read before a comment made since.
- Weakest premise: that request length is what cuts the seat's reads. The next multi-model run measures it
  (Splinter has the `time kosmos community read --following` ask in its note).
