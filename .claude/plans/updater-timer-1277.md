# kosmos#1277: the updater gets its own timer

## What was wrong

`poke()` had exactly one caller in the whole product: the status route. That
route runs only while a browser is polling it, so a board nobody has open never
poked, never refreshed, and never reached `maybeAutoInstall()`, no matter how
loudly its own `autoupdate.on` read true.

Measured on this machine's standing install: alive, auto-update on, every
install gate passing, and **four releases behind after thirteen hours**, because
nobody had opened its page.

An agent Mac is exactly that shape. A machine running agents with nobody at its
board is the normal case rather than the odd one, and every one of them had
quietly stopped taking updates, security fixes included.

## What changed

`engine/update.js` gains `startAutoPoll` / `stopAutoPoll`. `server.js` starts it
at boot, beside the tunnel tick and the #185 nudge sweep.

**Its own timer, never the status GET.** That is the same posture as the sweep
it sits next to, and the reason is not symmetry: polling the status route to
force an update is not a read, it installs. A route that installs when you look
at it is the wrong shape to lean on.

The interval, the installed-copy gate and the `unref` live in `update.js` beside
the thing they govern rather than at the call site.

## The interval is deliberately well inside TTL

`poke()` already rate-limits to one fetch per TTL window, so this timer does not
decide how often the host is asked. It decides only that the question gets asked
at all when nobody is watching. Choosing an interval inside TTL means the rate
limit stays the thing that governs network traffic, and the timer cannot become
a second, competing rate policy.

## Weakest premises, named rather than buried

**This is a real behaviour change for unattended machines, not a pure fix.** It
moves when they install from "when somebody looks at the board" to "whenever the
timer fires". That is what the preference already promised, and it is still a
change in observable behaviour on machines nobody is watching. Flagged for a
reviewer rather than assumed obviously fine.

**The measurement behind it is one machine.** Four releases behind after
thirteen hours is this box, not a survey. The mechanism argument does not depend
on the sample (one caller, only while polled), but the severity claim does.

**An `unref`'d timer is invisible to anything that counts work.** It will not
hold the process open, which is correct, and it also means a health check that
asks "is anything scheduled" cannot see it.

## What this does not do

It does not change the rate limit, the install gate, or what
`maybeAutoInstall()` decides. It only ensures the question is asked on a machine
with nobody at its board.
