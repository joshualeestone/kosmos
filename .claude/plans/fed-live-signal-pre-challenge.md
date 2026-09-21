---
method: challenge-loop
branch: fed-live-signal
diff_hash: def241965a682f89f96380c83e0c245c10d4e4b914db27462f9925cc8a13a47e
converged: true
---

# Challenge loop: fed-live coordinator signal (option 2, the customer un-hide)

Adversarial self-review of the board-side federation-live signal that mirrors the W1
standing re-fetch (#3355). Two iterations; converged with no BLOCKERs.

#### Iteration 1

[WARNING] `refreshFederationLiveIfStale` is NOT gated on `enrolled()`, unlike its sibling
`refreshStandingIfStale`. Is that a copy-paste omission? No: it is deliberate and it is the
one real design difference. `standing` is a per-account membership check (needs an enrolled
mac cert); `federationLive` is a GLOBAL launch flag that gates the whole fed UI including the
"sign up for Kosmos+" prompt shown to NON-members. A non-enrolled board therefore must still
learn the flag, so gating on enrolment would wrongly starve every non-member of the signup UI.
Confirmed correct; the rationale is written into both the code comment and the plan, and a
dedicated test ("it is GLOBAL -- refreshes even when NOT enrolled") pins it so a future edit
cannot silently re-add the gate.

[WARNING] The fetch result is only committed when `typeof live === 'boolean'`; anything else
(including a truthy non-boolean like the string "true") falls to the else branch and KEEPS the
last-known value. Is that a footgun that could swallow a real answer? The contract is bool|null,
and treating a malformed answer as "could not determine" is the fail-safe choice (it keeps the
last-known value rather than flipping the UI on garbage). The real coordinator fetch returns a
clean bool; the stub returns null. Intentional, not a bug.

[NIT] `federationLiveNow()` fires the refresh on every `/api/status` poll (~5s), which looks
like it would hammer the coordinator. It does not: the refresh is TTL-gated (`now - fedLive_at
< ttl -> return`) so it only actually fetches once per `FED_LIVE_TTL_MS` (60s), and it is
single-flighted. Same shape as the shipped standing refresh. No extra load.

[STRENGTH] The whole change is observably inert until ICK's endpoint is wired: `fetchFederationLive`
is a null stub, so the default fetcher path keeps `fedLive` false, so `federationLiveNow()` = the
env override only = the merged #3353 behaviour. This is asserted by the "shipped default fetcher
is a null stub -> default false" test, so shipping ahead of the coordinator field is provably safe.

#### Iteration 2

[WARNING] On a null (could-not-determine) fetch the code does `write({ fedLive_at: Date.now() })`
without re-writing `fedLive` -- does that DROP the cached flag? No: `write(patch)` reconstructs the
file from `{...read(), ...patch}`, and `read()` returns the current `fedLive`, so the value carries
through untouched and only the clock advances (to back the retry off). The "null KEEPS the
last-known value" test verifies `federationLive()` is still true after a null and that `fedLive_at`
moved forward. Resolved.

[CONVENTION] The coordinator read is a documented null stub pending ICK's endpoint, matching
exactly how `fetchStanding()` shipped its own null stub pending ICK's standing mechanism. Same
"NO CRYPTO HERE / isolated fetch" boundary. Consistent with the established pattern; the real
fetch is a one-function change later.

[STRENGTH] Fail-safe on every axis: unknown/unreadable state -> false (hidden); a throwing
fetcher is swallowed and leaves the last-known value; single-flight prevents stacked fetches; the
env override is ORed on top so operator/dev boards are unaffected. The fed-route 403 remains the
hard security gate; this only makes the UI honest, identical to W1.

Converged: no BLOCKERs. Both WARNINGs from iteration 1 resolved or confirmed-intentional; the
iteration-2 WARNING resolved by tracing `write()`. Full suite: the 9 new tests + the standing/
kosmosplus regression (24 engine assertions) and server.test.js (306) all green; syntax-checked.
No web/index.html or browser-check change, so no browser-check index touch.
