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
