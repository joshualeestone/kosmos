# signin-guard-3827 (kosmos#3827 follow-up, on top of Pete's #3843)

Pete's #3843 (6765c145) switches Kosmos+ on after an in-app sign-in, the core of #3827. My earlier branch signin-on-3827 did the same and went through 7 blind review rounds that found real races around it. This is that hardening, rebuilt on main with a simpler design (engine only; the sign-in UI is Pete's and under active change for #3837):

1. A Sign out that lands while register is in flight never switches Kosmos+ on: register records the sign-in epoch and returns SIGNIN_CANCELLED if it moved (every other sign-in step already did this).
2. forget() cancels any sign-in (epoch, session) and WAITS for a register already out, so what it retires and wipes includes that registration. Earlier rounds tried "abandon, undo later, refuse meanwhile" and it produced a new race every round; the simple wait is safe because:
3. a register and a retire are bounded (registerTimeoutMs, 60s, env seam AGENT_WORKFORCE_REGISTER_TIMEOUT_MS), so neither a hung coordinator nor a hung connector can hang Forget.
4. A failed save of the switch is logged; the Mac is registered either way and the switch honestly reads off. Chose logging over a new UI note to stay out of Pete's in-flight sign-in UI; the failure is disk-level and rare.

Tests (engine/remote.test.js, a slow-register mode in the fake): cancel during register; Forget waits, retires once, nothing left registered; a 15s register bounded at 1.5s cannot hang Forget; a failed switch save still reports the Mac registered. Controls: no epoch check fails "reported success"; no wait fails "did not retire the Mac"; no bound fails "waited out a hung register".

Weakest premise: Forget can now take up to the register bound (60s) when a register is truly hung. Worse than an instant answer, bounded, and only in a case that is already broken.

## Round 1 review (opus)
- BLOCKER: a 60s register bound killed healthy registers: the certificate step holds the call for the ACME wait (65s measured on production tonight). Now 5 minutes; it exists only so a hung register cannot hang Forget.
- BLOCKER: Forget retired only when enrolled() (needs the certificate), so a register killed mid-certificate (key and id written, the Mac registered at the coordinator) was never retired. Forget now retires whenever mac_id and mac_key exist. Test with a partial-register fake mode; control with enrolled-only fails.
- WARNING: two registers at once (the page aborts at 15s; Try again). A second register while one is out is refused, before every path. Test; control fails.
- WARNING: a sign-in started during Forget's retire. signinStart and signinRegister refuse while forgetting. Test; control fails.
- WARNING: the page gives up at 15s while a register can take over a minute: handed to Pete (his UI).
- WARNING: the switch-save test could not fail; it now asserts the log line. Control fails.
- NIT, left: resetForTests does not kill an outstanding register child (every test awaits its register).

## Round 2 review (sonnet)
- BLOCKER: two concurrent forget() calls each retired the same Mac. A second forget now returns the first one's promise (same answer, one retire). Test; control without the dedupe fails "retired the Mac twice".
- BLOCKER: forget's sentence was keyed on enrolled(), so a half-registered Mac was always told "nothing to retire", even after a successful retire, and a real retire failure was hidden. Keyed on canRetire now. Test asserts because is null after a successful retire; control fails.
- WARNING (documented): worst case a hung register then a hung retire, two bounds, about ten minutes, only when already broken.

## Round 3 review (opus)
- WARNING: the older Settings setup (setupComplete) wrote the same state dir without the guards. It now refuses while a register is in flight or a forget runs. Test; control: without it the test hangs (killed after 27 minutes), which counts as a failure but is not a clean one.
- WARNING: after a register cut off mid-certificate, Try again could register over the half identity (stranding it at the coordinator). Register now refuses while a key and id exist with no certificate, pointing to Forget. Test; control fails on the message ("did not finish").
- WARNING: the retire bound was untested. New hung-retire fake mode; Forget returns within the bound and reports retired false. Control with an unbounded retire fails.
- NIT: the env seam only accepts a positive number (never "no bound").
- NIT, left: the forgetting refusal inside signinRegister is not reached by a test (the in-flight check wins first).

## Round 4 review (sonnet)
- BLOCKER: signinStart did not refuse while a register was in flight; the finishing register then cleared the new sign-in's session ("finish the code steps first"). It refuses now, like setupComplete and signinRegister. Test; control fails.

## Round 5 review (opus)
- BLOCKER: the half-identity refusal sent the person to "Forget this computer", which no screen offers (and any certificate failure leaves a half identity, not only the bound). No dead end now: a register (in-app or Settings) retires the half identity first and proceeds. Test: a retry after a killed register succeeds, retire before register.
- WARNING: setupComplete was not tracked or bounded: now registerInFlight + registerTimeoutMs, like the in-app register, so Forget waits for it and nothing starts beside it.
- WARNING: setupComplete had no half-identity handling: it clears it first too.
- WARNING: signinVerify/Second/Enrol/ConfirmEnrol did not refuse while a register was out or while forgetting. One busy() check now heads every sign-in step and setupComplete. Test covers the four steps.
- NIT: "key and id exist" has one definition (halfRegistered), used by forgetNow too.
- Controls: without clearHalfIdentity fails "not retired before the new register"; without busy() in signinVerify fails "verify ran while a register was out" (that run then hung and was killed).
- Two new-test expectations fixed: a sign-in during Forget with a register still out gets "still signing in" (busy checks the register first); the call-name map read "retire --coordinator".

## Round 6 review (sonnet)
- WARNING fixed: busy() is now the first statement of signinRegister (it ran after the session and name checks).
- WARNING open: tests for the forgetting branch on setupComplete and the four signin steps; a test for clearHalfIdentity's failed-retire log.

## Round 6 review (opus)
- WARNING: busy() first in signinRegister. Fixed in 0ffc60806.
- WARNING: the `forgetting` branch was untested. Test: with a registered Mac and a hung retire, a Forget in progress refuses start, verify, second, enrol, confirm, register and the Settings setup with "being forgotten" (no register out, so only that branch can refuse). Control (busy() ignores forgetting) fails.
- WARNING: clearHalfIdentity's failed-retire log was untested. Test: a killed register leaves a half identity, the retire hangs past its bound, the line is logged and the new register still succeeds. Control (log removed) fails.
- NIT: enrolled() now says why mac_key is not listed.

## Round 7 review (sonnet)
- WARNING: after a half identity could not be retired, the new register's 409 ("a Mac on this account already has that name") read as another Mac's name, when it is most likely this computer's own stranded attempt. clearHalfIdentity now answers why its retire failed; a 409 after that says it may be this computer's own earlier sign-in and what to do (remove it on the account page, or another name). Test with a 409 mode in the fake; an in-test control shows a plain 409 is left alone; mutation control (explainStranded a no-op) fails by name.
- WARNING: setupComplete's half-identity retire was untested. Test: a killed in-app register, then the Settings setup retires before `setup complete`. Control (no retire there) fails by name.
- NIT: busy() now says "being forgotten" first: while a Forget waits on a register both are true, and Forget is what the person asked for.
- NIT (no change): forget's `address` is null for a half-registered Mac. Nothing reads it: server.js relays it and no page consumes it (searched web/ and bin/).

## Round 8 review (opus)
- WARNING: explainStranded matched every 409 (its "already has that name" half matched only the fixture). It now matches only the coordinator's same-account sentence ("already in use by a Mac on this account"); the fake now prints the coordinator's real sentences in the tunnel's "Kosmos+ said no (409): ..." form. Test: after a refused retire the same-account 409 gets the note; after a working retire, or another account's "that name is taken", it does not. Control (any 409) fails by name.
- WARNING: a retire that got no answer still deleted the only key that could retire the half identity. Now: no answer (timeout, unreachable, would not start) keeps the key and the register answers "could not be removed yet; try again in a moment"; the retry retires and registers. A retire that worked or a definite refusal (said no 4xx) wipes as before. Test; control (always wipe) fails by name.
- WARNING: Kosmos+ could be turned on during Forget's retire wait, starting a tunnel from the key about to be deleted. setOn(true) refuses while forgetting; forgetNow also stops any child after its final write. Test; control fails by name.
- WARNING: a register the page gave up on (15s vs ~65s) succeeded, cleared the session, and a Try again at the same name was told "finish the code steps first". The already-set-up-at-this-name answer now comes before the session check. Test; control fails "finish the code steps first".
- NIT: the Forget worst case is three bounds (~15 min); comment corrected.
- NIT: the "being forgotten or still signing in" assertion now asserts being forgotten (busy() order). The in-test control now plants a half identity and retires it before the plain 409.
- NIT: doubled period in the stranded note fixed (tested). setupComplete now has the epoch check signinRegister has: a Forget during a Settings setup answers cancelled, not set up. Test; control fails by name.
