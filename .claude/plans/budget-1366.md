# kosmos#1366: one budget for the whole live read, not three independent timeouts

**Branch:** `budget-1366` · **Card:** kosmos#1366, Renet Tilley's, unclaimed when I took it.

## The card's arithmetic

`runningAs` makes three synchronous `execFileSync` calls at 5s each. `cmd_whoami` calls the
route with `curl -m 15`. **3 x 5s = 15s equals the client's entire patience**, so a degraded
`tmux` or `ps` produces "Kosmos did not answer" rather than the record-sourced answer that was
available the whole time. That reintroduces the failure #1304 removed, one layer out.

## What I built, and why it is cheaper than the card expected

The card prefers option 2, bounding the whole read, but notes it *"means restructuring rather
than passing a number"* because the read is synchronous.

**That is true if the three calls are independent. They are not.** There is exactly one
`execFileSync` call site, the `sh` helper, and all three readers go through it. So a deadline
threads through one function:

```
sh(cmd, args, deadline)   ms = deadline ? min(5000, deadline - now) : 5000
                          spent budget -> return '' WITHOUT spawning
```

**No async, no restructuring, no change to the call graph.**

⭐ **A spent budget returns `''`, which is exactly what a failed read already returns**, so it
lands on the fallback the callers already have. That is why the change is small: the handling
existed and only the trigger was missing.

**Opt-in.** `budgetMs` absent means today's behaviour precisely, so option 1 (shrinking the 5s
default for every caller) stays a separate decision, which is what the card said it should be.

## A second finding, in the same function

`everyone()` hoisted `panes` and forwarded it, and did neither for `procs`. When no `procs` dep
is supplied, which is production, `runningAs` falls back to `defaultProcs()` **once per
session**, so N panes meant N full `ps -eo` reads where one answers for all of them.

**The asymmetry is the tell:** `panes` had to be hoisted because it drives the loop; `procs` has
the identical shape and was not. It compounds this card rather than being merely slow, because
each of those reads carries its own timeout.

## 🛑 What the tests prove, and what they do not

**My first draft of the test file was worthless and I only know because I perturbed it.** One
test counted its own argument literal, so it could never be anything but 1. The other passed
because a fake session does not exist on this machine, not because the budget was honoured.
**Both went green against the unmodified file.**

What is here now:

```
_sh spent-budget arm        RED without the change
_sh shortened-call arm      RED without the change
_sh unbounded CONTROL       must still work with no budget
everyone() forwarding       REGRESSION guard only, see below
```

⚠️ **Honest limit, stated in the test file as well as here: the three `_sh` arms go red on
`origin/main` because `_sh` is not exported there.** That is a real red for a new capability,
but it is not a behavioural catch and I am not presenting it as one.

⚠️ **The `procs` defect is not observable through dependency injection at all.** Injecting
`procs` is exactly what suppresses it, so any test that injects it passes either way. The
forwarding test is kept as a regression guard on the forwarding, not as evidence for the fix.
**The fix rests on reading the call graph, and I am saying so rather than dressing it up.**

## Why `_sh` is exported

**Only to make the guard possible.** The budget is not reachable through `runningAs` with
injected deps, and with fake pids a real read returns empty anyway, so both arms agree for the
wrong reason. Without the export there is no test that can go red, and a test that cannot go
red is decoration. The export is commented as testability-only so nobody reads it as API.

## Not done

**Not shrinking the 5s default** (the card's option 1, correctly flagged as everyone's
decision). **Not raising `curl -m`** (rejected on sight, and rightly). **Not claiming this fixes
the unauthenticated-blocking point** the card raises second-order: a budget changes the number,
not the shape.

## Verification

Recorded on the PR in who/branch/rc/tally/runner form.

## Held

Under the demo freeze. This queues.
