---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: connflight-1618
diff_hash: e5dfe9a0d4852f0d631244c948052f1334ac95b87bf08afd8d9a44b1abf03f46
subdir_audit: passed
timestamp: 2026-08-30T22:41:46Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

**One pair of eyes, mine.** `explicit_override: true` is set deliberately: the alternative
was relabelling this `method: challenge-loop`, which would be false, because I ran no blind
rounds and cannot spawn blind reviewers in this session. **Read the flag as "reviewed once,
by its author", not as "the gate was satisfied".** A second reader is welcome.

## 🛑 What this diff_hash binds, which is more than the change

`e5dfe9a0d4852f0d631244c948052f1334ac95b87bf08afd8d9a44b1abf03f46` covers **33 files**. The change is **8**. The gate diffs against the **local**
`main`, which is **20 commits behind `origin/main`** on this machine, so the hash certifies
other cards' already-merged work as though I had reviewed it. This is kosmos#1472, still
open; I added a fresh measurement to it today. I did not fast-forward the shared checkout,
because another agent mid-flight may already have hashed against it.

## [BLOCKER] (mine) My wrapper changed WHEN the wrapped function starts

`collapse` first scheduled through `Promise.resolve().then(run)`, so a synchronous throw
would become a rejection through one uniform path. That deferred the run's start by one
microtask, and `engine/openaiaccounts.test.js` went red:

```
'none' !== 'unknown'
```

**That is the exact assertion #1618 records killing the TTL cache**, reached by a completely
different mechanism. Those tests restore a monkey-patched `checkLive` in a **synchronous**
`finally` beside a returned promise, which is correct because `listLive` reads its
collaborators synchronously on the way to its first await. A one-microtask deferral moved the
read past the restore, so the real reader ran and answered a confident `none` where the test
had arranged an unreachable account.

--> FIXED: `run()` is called synchronously inside a try/catch, which keeps the sync-throw
safety without moving the start. Pinned by an assertion in `engine/inflight.test.js` so it
cannot be tidied back.

⭐ **The generalisable half: a wrapper that changes when a function starts is not
transparent, however tidy its scheduling looks.** I would have shipped it; the existing
suite caught it, which is the second time today an existing test caught a change its author
thought was inert.

## [WARNING] (mine) My first check of the accounts wiring was vacuous and printed a pass

I probed `accounts.listLive` in an empty sandbox. It found **zero** accounts, compared
`0 === 0`, and printed `COLLAPSED? YES`. A sharing assertion counted against an empty
population is true for the wrong reason and reads exactly like a pass.

--> FIXED: replaced with `engine/accounts.inflight-1618.test.js`, which asserts a
**population floor at module scope** (`ROWS === 2`) before any test runs, so a sandbox that
produced no accounts fails loudly rather than passing vacuously.

## [WARNING] (mine) I nearly wired only one of the two engines

The route asks both engines together, so collapsing only OpenAI would have halved nothing:
two concurrent requests would still run two full `claude auth status` sweeps. I was about to
accept symmetry as evidence --> FIXED: both sites wired, and **each perturbed separately**.

## [CONVENTION] (mine) Two scratch files from `find` were sitting in the worktree

`.f.z` and `.t.z`, untracked, from my own sweeps --> FIXED, removed before the commit, and
the commit uses explicit paths so they could not have ridden along anyway.

## [STRENGTH] The card's own premise, checked rather than assumed

The card is written around `/api/agent/connections` and a `kosmos connections` verb.
**Neither is on main**, measured with controls that return non-zero. The urgency half of the
card is therefore weaker than it reads, and I said so rather than importing it. The sweep
cost is real and present-tense regardless, which is what the change addresses.

## Verification

Both wiring sites perturbed, each restored to its exact sha afterwards, checked:

| perturbation | sharing test | control | three-state test |
|---|---|---|---|
| `accounts.js` collapse removed | RED | green | green |
| `openaiaccounts.js` collapse removed | RED | green | green |
| neither | green | green | green |

The controls staying green while the sharing test reds is the point: they measure the
uncollapsed shape and must not move.

Every counting assertion is paired with an uncollapsed control, because "the reader was
entered twice" is also what a single caller produces, and on its own cannot tell sharing
from a call that never happened.

Full suite: **3209 tests, 3209 pass, 0 fail**, `SUITE rc=0`. That is 3193 + my 16, which is
the arithmetic that confirms all 16 ran.
