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
