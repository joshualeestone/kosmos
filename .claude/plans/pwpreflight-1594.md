# #1594: prove the browsers can LAUNCH before running the page gate

**Branch:** `pwpreflight-1594` · **Card:** kosmos#1594, found by Baron Draxum during the 0.6.14
cut.

## Scope: the diagnostic half, NOT the card's "right shape"

The card asks for the whole toolchain to be pinned - a Playwright version and its browser builds
committed into provisioning. **I am not doing that**, and the card should stay open for it:
committing browser binaries is an ownership call about repo size and provisioning.

I am fixing the thing that actually cost the cut its second cycle.

## The defect underneath the one the card names

```
resolve_pw()   [ -d "$c/playwright" ]     <- a DIRECTORY EXISTS
```

Nothing verified the resolved Playwright could **launch** anything, and there was no pre-flight
at all. So the first evidence of a missing browser build arrived minutes in, from inside a
check, as *"the page checks are red"* - and because the checks are multi-engine, a missing
**webkit** reds a check whose chromium half was fine.

⇒ **A proxy where an effect was needed.** The presence of a `webkit-*` directory is not evidence
that THIS Playwright can start it, which is the card's 2342-versus-2336 point stated as code.

## What this adds

A launch pre-flight after Playwright resolves: launch each engine, close it, and refuse before
any check runs. The engine set is **derived from the check files** (`grep` their `ENGINES`
arrays, union, sorted) rather than hardcoded, because they differ - some ask for
`['chromium','webkit']`, some only `['chromium']` - and a hardcoded list is one new check away
from being wrong. It falls back to `chromium` if the derivation ever finds nothing.

The refusal keeps the same posture as the existing no-Playwright branch: loud, blocking, and
skippable only by `KOSMOS_SKIP_BROWSER_CHECKS=1`, which prints that the page layer is NOT
covered.

**Only the first line of Playwright's error is printed.** It carries
`Executable doesn't exist at <path>/<engine>-<build>`, which is the entire diagnostic; the rest
is an ASCII install banner that buries it.

## Verified, both arms, end to end through the real script

```
real browsers        chromium ✅  webkit ✅   and the run PROCEEDS into the checks
browsers absent      chromium 🛑  webkit 🛑   exit 2, and ZERO checks ran
```

The absent-browser arm names the build: `webkit-2336`, `chromium_headless_shell-1234`. That is
the discrimination the card says a directory check cannot make.

⚠️ **What it does NOT do:** it does not stop the skew. Two Playwrights can still pin different
builds. It stops the skew being **invisible and mis-attributed**, which is the part that made
the same cut fail twice and sent the operator after chromium a second time.

## Housekeeping

Testing this left four headless shells orphaned when I killed the run. Traced them to one tree
(`node docs/browser-checks/regress-a-night.js`), confirmed no other browser-checks run existed,
killed the parent by PID and **verified by `ps`** that all five were gone, with a control
showing the check could still see live processes. Same lesson as earlier tonight: stop what you
started, and a kill that returns 0 is not a process that died.
