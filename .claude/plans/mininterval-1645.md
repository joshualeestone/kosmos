# #1645: a minimum interval that ANSWERS with the last sweep plus its age

**Branch:** `mininterval-1645` · **Card:** kosmos#1645

## Scope, and it is narrower than the card, for a measured reason

🛑 **The route this card names does not exist on `main`.** Measured, with controls:

```
                                     Angel's branch    main
/api/agent/connections handler             1             0
CLI `connections` verb (install/kosmos)   13             0
control: /api/connections handler          1             1
```

`connect-verdict-1034` is Angel's, unmerged, and it carries both the route and the CLI verb. So the
two acceptance criteria that touch them - wiring the guard into the route, and the CLI saying the age
in words a person understands - **cannot be built on main today and are hers to land.**

⇒ **I built the part that is mine and that unblocks the rest: the guard itself**, in
`engine/inflight.js`, which is the module I wrote for #1618 and which **her branch does not touch**
(measured: 0 of her 13 changed files; control, `server.js`: 1). So this cannot conflict with her
work, and wiring it in is one line when her branch lands.

## What the guard is, and why it answers rather than refuses

`collapse` (#1618) bounds **concurrent** callers and deliberately holds nothing once a run settles,
so a **serial** poll is N sweeps. My own #1636 comment in `server.js` says exactly that and names it
as not-a-defence. This is the other half of my own change.

The route's original no-rate-limit decision was right about the limiter it imagined: **a refusal has
to render as something, and the only honest rendering is `cannot tell`**, which manufactures
uncertainty about a machine we could read perfectly well.

**So `minInterval` never refuses.** Inside the interval it returns the previous run **and its age**:

```js
minInterval(collapse(sweep), ms)   // compose, do not replace: they bound different things
  -> { value, ageMs, fresh }
```

- no verdict is changed, so `cannot tell` cannot become a confident `not connected`
- nothing is presented as fresh, because the age travels with the answer

## Decisions I made, with what I rejected

**A rejected run is not remembered**, and **a failure is never answered from the remembered value.**
The tempting alternative is falling back to the last good sweep when a new one fails. I rejected it:
that presents a stale reading as the current state of the machine with no way for the caller to tell,
which is the confident-none failure arriving by another door. Same rule as `collapse`.

**The age is stamped when the run SETTLES, not when it started.** A sweep that took four seconds is
four seconds of work, not four seconds of staleness.

**The remembered value is returned unchanged**, asserted by object identity. Any normalising on that
path would be a second definition of the answer, and two definitions drift.

**The clock is injectable.** A guard keyed on time is exactly the shape where a sleeping test is slow
and flaky, and where a test that cannot move the clock quietly stops testing the boundary.

**I did NOT pick the interval value here.** The guard takes `ms` from its caller, so the number is
chosen where the route is wired, by whoever owns that route. Hard-coding a number in a general helper
would have made it look like a property of the mechanism.

## Verified by perturbation, arm by arm

Not "the tests pass". Each arm was broken on purpose and the right tests went red:

| perturbation | red |
|---|---|
| disable the interval check | **3** |
| always report `ageMs: 0` | **1** |
| coerce the held verdict to a boolean | **2** (the invariant arm) |
| remember rejections too | **1** |
| restored | **0**, 11/11 green |

**The invariant arm is the load-bearing one** and it is asserted on **both** paths: a door that could
not be read stays `connected: null`, never `false`, fresh or held. That is what an age-bearing answer
could quietly break.

The counting arm has its own **negative control**: the same stub, unguarded, reaches 2. Without it,
`runs === 1` is equally consistent with a stub that cannot count.

## What is left for the route owner

- wire `minInterval(collapse(sweep), ms)` into `/api/agent/connections` and choose `ms`
- carry `ageMs` into the response and have the CLI say it in words

Both are in `connect-verdict-1034`. I have told Angel the helper is here and that I did not touch her
files.
