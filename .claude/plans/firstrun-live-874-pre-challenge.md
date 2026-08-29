---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: firstrun-live-874
diff_hash: ac489252040de5d5785366e7e6a253c1df64b2619b1c787d0800421dd7bd4f7b
subdir_audit: passed
timestamp: 2026-08-29T17:03:02Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24 push-as-ready). Bracketed markers because the
template's own heading is refused by this gate, my #1458.

**This is a real user's bug**, routed to me by name, reached the first outside install.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] THIS ADDS A SUBPROCESS TO THE ONBOARDING ROUTE.** `/api/first-run` is
  repainted on every "Check again". It already shells out once (`fleet()` ->
  `paneRoster()` -> `tmux list-panes`), so this makes two. **A reviewer who thinks the
  onboarding screen must stay single-subprocess should push back here** and the answer
  would be to move the check behind the button rather than the paint.
  📌 `server.js:3211`'s cost note is about `/api/found-agents`, not this route. I checked.
- **[WARNING]** `state()` changed from sync to async. **One production caller**
  (`server.js`), converted to the `.then()` form its neighbours already use, error
  sentence preserved verbatim. Seven test call sites converted. Nothing else calls it.
- **[WARNING]** A machine where `claude auth status` is slow now has a slower onboarding
  screen. `checkLive` has its own timeout handling; I did not re-verify that path.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0 on all four files, planted control 1.
- **[CONVENTION]** **No closing keyword.** The card's first defect is untouched.

### NITs

- **[NIT]** The plan-name merge calls `check()` a second time. It is a file read the
  route already pays for elsewhere, and splitting it out would obscure why it is there.

### Attacked and CLEARED

- **Reproduced the mechanism at the source** (`subscription.js:169`) before writing code.
- **Perturbed both halves:** revert to the cached check -> the #874 test goes red; drop the
  plan merge -> **two** tests fail, including a **pre-existing** one, so the merge is
  load-bearing rather than decorative. Restores sha-verified.
- **The regression test has a CONTROL arm** asserting the same file DOES read connected
  when the live check confirms it. Without it, the fix would look right on a `state()`
  that could only ever answer `none`.
- **Suite 2944 pass, 0 fail**, both new tests present by name.

### The near-miss worth reading

**`checkLive()` returns `plan: null` on purpose**, and the screen renders
`(sub.plan || 'A Claude subscription') + ' is connected'`.

⇒ The obvious one-line fix would have **silently downgraded "Claude Max is connected" to
the generic sentence for every paying customer.** I found it because a pre-existing test
asserted the plan name, not because I reasoned about it.

⭐ **The two fields answer different questions: whether you are signed in is a claim about
the world and must be verified; which plan the file names is a description.** Sourcing them
identically is what caused the bug in the first place.

### What I am NOT claiming

**I have not driven the real first-run screen in a browser.** The verification is the engine
contract plus the suite. The browser is queued to three other agents and this change is
engine-side.
