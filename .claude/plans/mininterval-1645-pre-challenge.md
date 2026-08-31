---
method: pre-challenge
branch: mininterval-1645
diff_hash: 4c37d61431ed9a24440cc456de6875677fd36e63d0aed952a230fb545a050447
explicit_override: true
---

# Pre-challenge: #1645 minimum-interval guard

**Override reason:** self-review, not a `/challenge-loop` run. Stated rather than relabelled.

## What I challenged in my own change

**1. Is this a cache by another name?**
The thing #1618 killed was a TTL that turned `cannot tell` into a confident `not connected` for
the length of its window. This returns the previous value **with its age attached** and changes no
verdict, so the collapse that killed the TTL cannot happen here. I asserted that directly rather
than arguing it: the invariant test drives an unreadable door through **both** paths and requires
`connected` to stay `null` and never become `false`. Coercing it reds 2 tests.

**2. Does the counting arm actually prove anything?**
On its own, no. `runs === 1` is equally consistent with a stub that cannot count. There is an
explicit **negative control**: the same stub, unguarded, must reach 2.

**3. Does each arm fail on demand?**
Perturbed four ways, each restored afterwards:

```
disable the interval check              -> 3 red
always report ageMs 0                   -> 1 red
coerce the held verdict to a boolean    -> 2 red   (the invariant)
remember rejections too                 -> 1 red
restored                                -> 11/11 green
```

**4. Should a failure be answered from the remembered value?**
This is the design decision I most nearly got wrong, because the fallback is appealing. Rejected:
it presents a stale reading as the current state of the machine with no way for the caller to tell,
which is the confident-none failure by another door. There is a test asserting the rejection
propagates instead.

## Weakest premise, named

**I have not run this against the real route, because the real route is not on main.**
`/api/agent/connections` and the CLI verb exist only in `connect-verdict-1034`, measured with
controls (handler 1 vs 0, CLI 13 vs 0). So the helper is verified in isolation and its integration
is unproven by construction. **What would change my mind:** if wiring it into her route needs any
shape I did not provide - most likely a different age unit, or the age needing to sit inside
`doors` rather than beside it. That is a signature change, not a rethink.

## Deliberate non-scope

I did not choose the interval value. `ms` comes from the caller, so the number is picked where the
route is wired, by whoever owns it. A number baked into a general helper would read as a property of
the mechanism.

## Known imprecision in this proof, stated rather than hidden

`diff_hash` is computed against **local `main`, which is 1 commit behind `origin/main`**, so it
binds **6 files for the 3 I changed** - the extra 3 are my own #1594 work already merged. This is
kosmos#1472. I did **not** fast-forward shared `main` to fix it: that can invalidate a colleague's
in-flight proof, my instrument for measuring who is at risk **proved unreliable** (it counted every
plan file ever committed, reporting 501 of 584 branches), and over-binding costs fidelity on my own
proof only. **Accepting a known imprecision beat acting on a measurement I had just caught being
wrong.**

## Verified before opening this PR

- full suite **3236/3236, fail 0, rc=0**, and my 11 tests confirmed present **by name** (11 lines
  naming #1645; control #1618 -> 17; negative control -> 0) rather than by arithmetic on the total
- 0 em dashes in the diff
