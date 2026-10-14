# owesfixture-6059: the 200-answers fixture in one write (#6059)

Card: joshualeestone/kosmos#6059. `server.dm-owes-4340.test.js`'s "an owed DM behind more than 200 later menu answers
is still owed" failed five times in CI (10-12 03:11 to 10-13 15:06), always `fetch failed` / `ECONNRESET`, always in the
slowest tail (5.99 to 6.72 s; passes 2.5 to 5.9 s).

## The call
Build the fixture with two `chat.appendMessage` calls (the owed DM and the first "Yes"), then copy appendMessage's own
kept answer row 200 times into the thread file in ONE write. The route reads the same shape it always reads; only the
way the fixture gets there changes. Locally 2,670 ms to 24 ms.

## Proven
- The file passes 7 of 7.
- Mutation: `dmOwes` given `messages.slice(-200)` (owes taken from the tail, the #4340 bug) reds exactly this test.
- The existing `olderCount > 0` control still guards that the thread is longer than the tail; a new check guards that
  appendMessage kept the two rows the copy is taken from.

## Not proven (weakest premise)
The cause of the reset is unknown and does not reproduce on this Mac (a 5.5 s block before the fetch, and 10 parallel
copies at 13.8 s, all passed). This removes the long synchronous window every failure sat in; it fixes a correlate.
If the reset recurs after this lands, the window was not it, and #6059 reopens with that fact.
Leading candidate (review 1, reasoned from source, not measured): the server runs in the test's own process with
Node's default 5 s keepAliveTimeout, so a loop blocked past 5 s can race the server's idle close against the client
reusing its pooled socket. Not reproduced: the 10 parallel copies blocked about 13 s each and none reset.

## Rejected
- Retrying the fetch: hides a real reset if the route has one.
- Writing the whole thread by hand: re-implements appendMessage's record shape, which can drift (#4340's fixture
  must be the shape the route reads).
