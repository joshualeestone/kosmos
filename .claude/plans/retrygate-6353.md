# retrygate-6353: a lapsed pairing code waits for the person's Try again (kosmos#6353)

## Done when
A code that lapses with nobody at either computer costs one try, not ten; the joining computer shows "Try again",
and pressing it starts exactly one new attempt. A test proves an overnight with nobody there spends exactly one try.

## Scope (two repos, both ride 0.7.56; a cut bundles the tunnel built from relay main)
- kosmos-relay `retrygate-6353`: crates/tunnel/src/pairing.rs `owe_commitment` restarts after an answered attempt
  lapses only when `Joining.retry_asked` is set; `retry_joining` (verb `join retry`) sets it, refused when nothing
  lapsed or every try is used; `JoinStatus.needs_retry`. Tests: overnight (12 h, polled every minute) spends 1 try
  (mutant with the old auto-restart spends 10); one Try again = one attempt; refusals; CLI test.
- kosmos `retrygate-6353`: engine `joinStatus` passes `needs_retry`; `joinRetry`; screen-only
  `POST /api/remote/join/retry`; page needs_retry state with a Try again button; render-connect-sheet-4637 arm; design-shots screen plus-join-retry (mobile-shots.js).

## Decided
- Counting stays where it is (a try is spent when the other computer answers). Rejected: free unanswered codes, which
  would let someone in the middle cycle codes and break the 20-guesses bound.
- Try again is screen-only (advisory isViaScreen, as confirm): the press is meant to mean a person is back.
- The first attempt still starts by itself; only restarts after an ANSWERED attempt need a press.
- A confirmed-on-this-side code that lapses (the other computer never pressed Allow) also waits for Try again.
- Mixed versions: an old page never sees needs_retry; a new page on an old tunnel never gets it. Both ship together.

## Weakest premise
A headless joining computer needs a reachable Try again. Today that is `kosmos-tunnel join retry --state-dir <dir>`
run by a person at that machine; no remote path. tmnt (this fleet's joining Mac) has a screen.
