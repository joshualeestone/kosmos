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
