# signin-on-3827

Problem (#3781, measured 2026-09-25): Josh signed in to Kosmos+ in the app, the
coordinator registered his Mac (register-mac 200) and issued the certificate, and
his address still did not load. The relay saw zero AUTH attempts from the Mac.
remote.ensure() starts the tunnel only when read().on && enrolled(); the sign-in
wizard's signinRegister() never set `on`, so the tunnel never started and the pane
sat on "Connecting" over a "Turn on" button.

Fix: signinRegister() sets on:true (turnOnAfterSignin) on both success paths, the
fresh register and the #1010 recognised-Mac path, before ensure(). A failed
register leaves the switch alone. setupComplete (the older flow) is unchanged:
its steps only show once the switch is already on.

Tests (engine/remote.test.js): switch starts off, sign-in turns it on and the
tunnel comes up; the recognised path turns it on; a failed register does not.
Control: with turnOnAfterSignin a no-op, the first two fail (41/43).

Why the suite missed it: the existing "full sign-in ... brings the tunnel up"
test calls remote.setOn(true) BEFORE signing in, so it proved the tunnel starts
when someone already pressed the switch.

## Round 1 review (sonnet) fixes
- BLOCKER: signinRegister had no epoch check, so a Sign out landing mid-register was followed by the switch turning on. It now records the epoch before the await and returns SIGNIN_CANCELLED if it moved, like every other step.
- WARNING: forget() racing a register could have its on:false overwritten. forget() now bumps the sign-in epoch and drops the held session first.
- WARNING: a failed switch save was swallowed and the wizard said "connecting". It now returns "you are signed in, but Kosmos+ could not be switched on here. Press Turn on".
Controls: removing each fix reds exactly its test (epoch -> both race tests; forget bump -> the forget race; swallowed write -> the save test).

## Round 2 review (opus) fixes
- WARNING: forget() during a register let the register child rewrite the state dir after forget emptied it, so the Mac came back registered. forget() now waits for a register in flight (registerInFlight), then retires and wipes. Test asserts enrolled() is false; control without the wait fails "brought the Mac back as registered".
- WARNING (documented, not changed): a Sign out that lands after the coordinator accepted the register cannot undo it; the page drops the late answer and the next paint shows the connected pane with the switch OFF, which is true.
- WARNING: a failed switch save now returns ok with switchOff + note (the Mac IS registered); server passes them; the wizard puts the note in the connected pane's message line and repaints, so "Press Turn on" sits beside the Turn on button. Recognised-path test added.
- NIT: fedSetStanding now runs before the switch write.

## Round 3 review (sonnet) fixes, and the validation gate
- BLOCKER: forget() awaited a register in flight with no bound (setupRun has no timeout), so a hung register hung Forget and /api/remote/forget. Now bounded by FORGET_WAIT_MS (20s); a register that finishes after a forget stopped waiting sees forgetGen moved and undoes itself (retire + wipe + switch off), so the Mac still ends up forgotten. Test with a slow fake register and a 50ms wait: Forget returns fast, the late register reports cancelled and leaves nothing enrolled. Controls: unbounded await fails "Forget waited"; no self-undo fails "left the Mac registered".
- WARNING (accepted): a brand-new sign-in STARTED after forget began is a new, deliberate sign-in; it is not cancelled.
- NIT: the dead catch around the await is gone.
- Validation gate (#1720): web/ changed with no browser-check assertion. render-plus-signin-3478.js gains a 'switch-off' scenario: registered with switchOff, board enrolled and off; asserts the note is in #plus-msg, the Turn on button is there, and no "Connecting".

- Validation (engine.reachable guard): the test-only export _setForgetWaitMs was "reachable from nowhere"; replaced by the env seam AGENT_WORKFORCE_FORGET_WAIT_MS, like AGENT_WORKFORCE_TUNNEL_BIN.

## Round 4 review (opus)
- BLOCKER: the late-register self-undo keyed on forgetGen, so a register that finished INSIDE the forget wait also undid itself, and forget retired again: two concurrent retires, forget answering "could not be updated". Now only a register forget actually abandoned (its wait timed out) undoes itself. Test: register finishes within the wait; forget says retired and retire runs exactly once.
- WARNING: a late register could wipe a newer sign-in. While an abandoned register is out, a new sign-in is refused ("a previous sign-in on this computer is still finishing"), and register has its own timeout (REGISTER_TIMEOUT_MS 60s), so the refusal is bounded. Test: blocked while out, allowed after.
- WARNING: the self-undo's retire result was ignored; a failure is now logged.
- NIT: AGENT_WORKFORCE_FORGET_WAIT_MS=0 means the default, now said.
