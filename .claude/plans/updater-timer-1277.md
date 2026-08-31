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

## Iteration 1

Three WARNINGs and three NITs. Two of the WARNINGs were real defects in my own
code and the third is a decision I am making rather than a defect.

**The cadence was 20 minutes, not 15, and a reachable host polled LESS often
than an unreachable one.** `POLL_EVERY` (5 min) divided `TTL` (15 min) exactly,
so every third tick landed on the boundary. The success path stamps `cache.at`
after the await, so the boundary tick misses by epsilon and waits a whole extra
tick; the miss path stamps `started` before the fetch, so it has no epsilon.
Simulated: success fetches at 5, 25, 45, 65 and miss at 5, 20, 35, 50.

⭐ **My own docblock names that exact mechanism** and warns that firing at TTL
doubles the cadence. I then chose an interval that lands on the boundary every
third tick. I wrote "well inside TTL" and never considered ALIGNMENT.

**And my first fix encoded a wrong theory, which the arm caught.** I asserted
the interval must not divide TTL, then set it to 60s, which divides 900s
exactly. The arm went red and was right: divisibility is not the property.
A boundary tick is ALWAYS missed by epsilon, so the cost is one whole tick, and
what matters is the size of that tick. 5 minutes stretches 15 to 20 (+33%);
60 seconds stretches it to 16 (+7%). The arm now bounds the overshoot.

**The suite could reach the real release host, and could start a real
installer.** Sixteen test files boot the real server, so every one starts this
poll against the real fetch. The only thing keeping them off the network was
`installedRoot()` returning null because a checkout is not an installed layout,
which is incidental rather than declared: from an installed app directory that
guard goes truthy, the default-on preference passes, and a test run can spawn a
real `curl | sh`. Gated on `AGENT_WORKFORCE_DRY_RUN`, which 39 test files
already set. The gate is on the FETCH and not the timer, because the wiring
assertion this card exists for asks whether the poll is running. Verified in
both directions: removing the gate reddens, and gating the timer instead also
reddens.

⚠️ My interval change made that exposure worse before I fixed it: 60-second
ticks instead of 5-minute ones is fifteen times more chances to fetch.

### The decision I am making, stated so it can be overridden

**This turns on unattended installs for every board where nobody touched the
switch**, because `engine/autoupdate.js` defaults `on: true` when
`autoupdate.json` is absent. There is no staged rollout, and the machines
affected are precisely the ones with nobody watching.

I am shipping it, and here is why rather than a shrug: the preference already
reads on, and the product already tells the person it auto-updates. This card
exists because that promise was not kept. Making the product do what it already
says it does is delivering the stated behaviour, not adopting a new policy.

**What would change my mind:** if the default were ever intended as "on once
somebody opens the board", rather than "on". That is a product question and it
is Josh's, so it is in the PR body in plain words rather than buried here.

### NITs fixed

`resetCache()` cleared five of six pieces of module state and left the poll
timer running, so any future test that started the poll and called only
`resetCache()` leaked a live interval. And `AGENT_WORKFORCE_UPDATE_POLL_MS` had
no floor, so `=1` would spin `installedRoot()` a thousand times a second on
exactly the unattended machine this card is about. Both fixed with arms.
