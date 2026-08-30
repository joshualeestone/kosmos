---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: doorflight-1618
diff_hash: 96f4d32a2961e6a49b135cdde71ef879106fa00e91ea4d8915cec77b6ab06ae8
subdir_audit: passed
timestamp: 2026-08-30T22:55:12Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

One pair of eyes, mine. `explicit_override: true` set deliberately rather than relabelling
this `challenge-loop`, which would be false: no blind rounds were run and I cannot spawn
blind reviewers here. **Read the flag as "reviewed once, by its author".**

**diff_hash binds 36 files; the change is 3.** The gate diffs against the local `main`,
which is behind `origin/main` on this machine (kosmos#1472, open, measured again today).

## [BLOCKER] (mine) My first test fixture hung the file until the runner killed it

`heldDoor` gated the door's fetcher from the moment it was installed, so the `connect()`
that SETS UP each test blocked on a gate nothing had released yet. The file ran for two
minutes and was killed --> FIXED: the gate is armed explicitly, so setup runs ungated and
only the concurrent phase is held. An `unarm()` was then needed too, so a mutator can run
while the already-blocked read stays blocked.

## [BLOCKER] (mine) Three of four tests were asserting about an empty door

After the fixture fix, three tests still failed - and **my own guard assertions are what
caught it**, not the product. A previous test's `finally` calls `forget()`, so the door held
no token; `state()` then returns early on "no token, not connected" and **never reaches the
verifier**. Every counter was therefore measuring nothing, and the throwing-fetcher test was
asserting `false === null` about a door that was simply empty rather than unreadable.

--> FIXED: each test connects the door through a working fetcher first and **asserts the
connect succeeded** before measuring.

⭐ **The reusable half: a door with no token short-circuits before the expensive call, so
every "how many times was the verifier entered" assertion is vacuous unless the door is
connected first.** The three guard assertions I wrote for exactly this reason are what
turned a silent false pass into three loud failures.

## [WARNING] (mine) My boundary test could not fail as first written

I wrote it around `connect()`. It cannot demonstrate the hazard: the pre-write and
post-write answers are **both** `connected: true` when the door already holds a token, and
it has to hold one for the shelf read to reach a verifier at all. So a shared stale read
would have returned the same value and the test would have passed under the wrong design
--> FIXED: rebuilt around `forget()`, which **inverts** the answer, so a shared pre-write
read says `true` where the truth is `false`.

## [STRENGTH] The perturbation contradicted my own argument, in the useful direction

I argued the wrong design (collapsing `state()` itself) would produce a **stale answer**.
Built it and measured: it produces a **deadlock**. `forget()` shared the held in-flight read
and never returned, hanging the file for 65 seconds.

⇒ The comment in `server.js` argues staleness while the measured failure is a hang. Both
argue for the same boundary, but **the code comment states the weaker of the two** and the
plan records that, so nobody later quotes the staleness reasoning as though it had been
measured.

## Verification

| perturbation | sharing test | boundary test | fresh-read test | three-state test |
|---|---|---|---|---|
| shelf collapse removed | RED | green | green | green |
| `state()` collapsed instead (the wrong design) | green | **file hangs, RED** | - | - |
| neither | green | green | green | green |

`server.js` and `engine/tokendoor.js` each restored to their exact sha after their
perturbation, checked.

Full suite: **3213 tests, 3213 pass, 0 fail**, `SUITE rc=0`. That is 3209 + my 4.
