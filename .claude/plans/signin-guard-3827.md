# signin-guard-3827 (kosmos#3827 follow-up, on top of Pete's #3843)

Pete's #3843 (6765c145) switches Kosmos+ on after an in-app sign-in, the core of #3827. My earlier branch signin-on-3827 did the same and went through 7 blind review rounds that found real races around it. This is that hardening, rebuilt on main with a simpler design (engine only; the sign-in UI is Pete's and under active change for #3837):

1. A Sign out that lands while register is in flight never switches Kosmos+ on: register records the sign-in epoch and returns SIGNIN_CANCELLED if it moved (every other sign-in step already did this).
2. forget() cancels any sign-in (epoch, session) and WAITS for a register already out, so what it retires and wipes includes that registration. Earlier rounds tried "abandon, undo later, refuse meanwhile" and it produced a new race every round; the simple wait is safe because:
3. a register and a retire are bounded (registerTimeoutMs, 60s, env seam AGENT_WORKFORCE_REGISTER_TIMEOUT_MS), so neither a hung coordinator nor a hung connector can hang Forget.
4. A failed save of the switch is logged; the Mac is registered either way and the switch honestly reads off. Chose logging over a new UI note to stay out of Pete's in-flight sign-in UI; the failure is disk-level and rare.

Tests (engine/remote.test.js, a slow-register mode in the fake): cancel during register; Forget waits, retires once, nothing left registered; a 15s register bounded at 1.5s cannot hang Forget; a failed switch save still reports the Mac registered. Controls: no epoch check fails "reported success"; no wait fails "did not retire the Mac"; no bound fails "waited out a hung register".

Weakest premise: Forget can now take up to the register bound (60s) when a register is truly hung. Worse than an instant answer, bounded, and only in a case that is already broken.
