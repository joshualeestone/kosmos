# #1618: collapse concurrent live-account sweeps, with no time window

**Branch:** `connflight-1618` · **Card:** kosmos#1618, split out of #1034 part 2.

## What I checked before building, because two of the card's nouns are not in the tree

The card is written around `GET /api/agent/connections` and a `kosmos connections` verb
spliced into eighteen agents' instruction files. **Neither exists on main today**, which is
consistent with the card's own note that #1034 part 2 was "attempted and reverted".

Measured, each with a control that returns non-zero:

```
'/api/agent/connections' as a route in server.js   0     ('/api/accounts'   1)
'connections' verb in install/kosmos               0     ('agents' 18, 'report' 15)
```

⇒ **The eighteen-agent caller population is not real today, so the urgency half of the card
is weaker than it reads.** The route's own comment says every current caller is "a person
pressing something rather than a timer".

**What IS real and present-tense:** `GET /api/accounts` runs `accounts.listLive()` and
`openaiAccounts.listLive()`, which is a `claude auth status` subprocess per Claude account
and an authenticated request per OpenAI account. Two callers arriving together run two full
sweeps. That is worth removing on its own, and it is what I built.

## The decision

The card offered a cache and rejected it with evidence: a 5s TTL was built and the suite
killed it in one run, because **a window converts `cannot tell` back into a confident `not
connected`**. I took the card's own first alternative instead: **collapse concurrent
in-flight requests, with no time window at all.**

`engine/inflight.js` holds one promise per wrapped function, **only while it is unsettled**,
cleared on both arms. Every sharer gets the answer of one sweep taken at one moment, which
is the same guarantee a lone caller gets. A failed sweep is cleared like a successful one,
so one unreachable moment cannot become a stretch of them.

**Wired in the ENGINES, not the route.** The cost lives in `listLive`, and engine-level
placement protects any future caller, including the `kosmos connections` verb if #1034 part
2 returns. Rejected: route-level, which would collapse the pair as one unit but leaves a
direct `listLive()` caller unprotected.

**Weakest premise, named:** I claim in-flight-only sharing has no staleness. That rests on
the slot being cleared on settle before any later caller can observe it, which is true for
promise semantics in one process, and this is a single-process server. It would NOT hold
across processes, and nothing here would stop somebody adding a window later.

**What would change my mind:** a caller for whom two concurrent requests must produce two
genuinely independent readings.

## The thing I got wrong, kept because it is the useful part

My first `collapse` scheduled through `Promise.resolve().then(run)`, so a synchronous throw
would become a rejection through one uniform path. That **deferred the run's start by a
microtask**, and `engine/openaiaccounts.test.js` went red with `'none' !== 'unknown'` - the
exact assertion the card records killing the TTL cache, reached by a completely different
route. Those tests restore a monkey-patched reader in a synchronous `finally` beside a
returned promise, which is correct because `listLive` reads its collaborators synchronously
on the way to its first await. My deferral moved the read past the restore.

⇒ **A wrapper that changes WHEN a function starts is not transparent, however tidy its
scheduling looks.** Fixed with a try/catch that keeps the synchronous start and still
converts a sync throw. Pinned by an assertion so nobody tidies it back.

## Not done

No route-level change, no cache, no TTL, no rate limit, and I did not build
`/api/agent/connections` or the CLI verb: those belong to #1034 part 2 and reviving them is
that card's decision, not a side effect of this one.
