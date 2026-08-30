# #1618, doors half: collapse the Connections shelf read, with no time window

**Branch:** `doorflight-1618` · **Card:** kosmos#1618. The accounts half is #1630, merged.

## Why there is a second PR at all

The card's cost list has two halves living on **two different handlers**, which I did not
see until after #1630 merged:

| cost the card names | handler | state before this branch |
|---|---|---|
| `claude auth status` per Claude account | `GET /api/accounts` | collapsed in #1630 |
| a live OpenAI request per OpenAI account | `GET /api/accounts` | collapsed in #1630 |
| `gh auth status` | `GET /api/connections` | uncollapsed |
| `vercel whoami` | `GET /api/connections` | uncollapsed |
| a live `api.cloudflare.com` request | `GET /api/connections` | uncollapsed |

The card reads as one route because it is written about `/api/agent/connections`, which
would have combined them and **is not on main**. I closed nothing and said so on the card
rather than letting "the connections route is uncached" look answered while three of its
five named costs were untouched.

The doors are not cheap: `engine/github.js` and `engine/vercel.js` are built by `makeDoor`
in `devicedoor.js` with `statusArgs: ['auth', 'status', ...]`, so each `state()` is a
subprocess, and `cloudflare.state()` and every token door make an authenticated request.

## The decision, and the one boundary that matters

Same rule as #1630: **share the in-flight read, no time window.**

🛑 **Collapsed on the READ PATH ONLY, and this is the whole design.** Both door shapes end
`connect()` and `forget()` by calling their own `state()` to answer with what they just did
(`tokendoor.js` and `cloudflare.js` both `return state()`). Collapsing `state()` inside the
doors would let a mutator share a read that began **before** its write, so a person who had
just connected would be told by that very request that they had not.

⇒ So this wraps the **shelf**, and the mutators keep calling the bare `state()`.

**Why sharing a read is safe where sharing a mutator's confirmation is not:** an
in-flight-only share can never return an answer older than one request's duration, which is
a property any single request already has. A mutator has a different requirement: it must
observe its own write.

**Weakest premise, named:** I claim the mutators are the only callers of `state()` that need
their own read. That rests on reading the two door factories; if a third door shape appears
with a different confirmation habit, this boundary needs re-checking.

## What the perturbation showed that my reasoning did not

I predicted that collapsing `state()` would produce a **stale answer**. I built the
perturbation and it produced a **deadlock**: `forget()` shared the held in-flight read and
never returned, hanging the file for 65 seconds until it was killed.

⇒ The wrong design is worse than I argued for, not better, and the argument in the code
comment now says staleness while the measured failure was a hang. Recorded here because a
prediction that was directionally right and mechanically wrong is exactly the shape that
gets quoted later as though it had been measured.

## Not done

- **HEAD on `/api/connections` still pays the full sweep**, unlike `/api/accounts` which
  short-circuits it. Real, pre-existing, and a behaviour change rather than a cost fix, so
  it is raised on the card instead of taken here.
- No cache, no TTL, no rate limit, and no revival of `/api/agent/connections` or the CLI
  verb, which belong to #1034 part 2.
