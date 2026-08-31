# #1636: refuse a cross-site read of /api/connections BEFORE it sweeps the doors

**Branch:** `xsite-1636` · **Card:** kosmos#1636, filed from `connect-verdict-1034`'s challenge
loop as a card rather than a commit, because the defect is pre-existing.

## The defect

A page the person merely visits can `fetch('http://127.0.0.1:PORT/api/connections')` in a
loop. **It learns nothing** - CORS makes the response opaque and the Host guard closes DNS
rebinding - **but the side effects still run**, and this is the expensive sibling: the three
first-party doors plus **every metered token door**, each making a live authenticated
`verify()` on every call. Brave Search, Exa, Tavily and Serper meter against the person's own
paid quota, so a drive-by page can spend somebody's money with nothing on their machine saying
why.

## The fix, and the part that is not the one line

The line itself is the card's, and it is the same one three sibling routes already use.
**The placement is the fix**: before `readConnectionsShelf()`, so nothing touches a door
before the refusal. A 403 returned after the sweep refuses the ANSWER and still pays the cost,
which is not a refusal at all.

📌 `engine/inflight.js` (#1618, mine) is not a defence here and was never meant to be. It
collapses CONCURRENT callers; a loop of sequential fetches is not concurrent and the slot
deliberately holds nothing once it settles. The loop test says so out loud.

## Two claims, and only one was already established

The card says "one line, the same one already used at `/api/unfurl`, `/api/unfurl/image`, and
`/api/agent/connections`" - and then, to its credit, refuses to let that settle the second
claim: *"that is the thing to verify rather than assume"*.

- **the ACTION** (add `crossSiteRead`): established by the three sibling routes.
- **the COVERAGE** (this route's real caller still passes): **not** established by them,
  because none of them is what the Connections screen reads on every open.

So the same-origin arm asserts the board's own headers get **200 AND reach the doors** - if it
only checked the status it could pass while the screen was broken in some other way - and a
separate pin says the page reads this route with a **plain relative-URL fetch**, so the caller
is same-origin by construction rather than by luck.

⚠️ **Named limit:** the same-origin arm sends the headers a browser sends; it does not drive a
real browser. The repo's browser checks cover the Connections screen separately. I did not add
one, and a reviewer who wants the belt-and-braces version should say so.

## Verification

| perturbation | status code | door assertions |
|---|---|---|
| guard removed | 200 | **RED** (7 failures) |
| guard moved AFTER the sweep | **still 403** | **RED** |
| shipped | 403 / 200 | green |

⭐ **The second row is the one that matters.** With the guard after the sweep the response is
still a 403, so a test reading the status code would have passed while the money was still
being spent. Every assertion in this file counts door `verify()` calls instead.

`server.js` restored to its exact sha after each perturbation.

## A correction to my own verification method, from this run

Full suite: **3214 tests, 3214 pass, 0 fail**, with all six of these confirmed present by name.

⚠️ **I have twice tonight written "that is N + my M, which is the arithmetic that confirms
they all ran". THAT METHOD IS NOT SOUND IN THIS REPO and I am retiring it.** This branch is
`origin/main` plus one file of six tests, and the total came out **lower** than the previous
branch's. The reason: several test files call `test()` inside a loop
(`web.machine-absence-claims.test.js`, `server.test.js` and others), so the total is
data-dependent on the tree rather than additive across branches.

✅ **The sound check is the one I also ran: grep the suite output for the test NAMES.** It
answers "did my tests run" directly instead of inferring it from a total that has other inputs.
The earlier arithmetic happened to come out right, which is worse than coming out wrong.

## Coordination

`connect-verdict-1034` is Angel's and live (30 commits ahead of main, no PR, its `server.js`
diff mentions `api/connections` twice). I messaged her before pushing and offered to drop it or
hold. **This branch is not merged until she answers.**
