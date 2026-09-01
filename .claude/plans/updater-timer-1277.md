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

## Iteration 2

Six WARNINGs, and the first three are one mistake of mine with three faces.

**My floor clamped the in-process test seam, not just the production variable,
and that made two arms unfalsifiable.** `Math.max(wanted, 1000)` applied to
`opts.every` as well as the env value, so three arms driving `{ every: 5 }` were
silently running at 1000ms and observing a 150ms window in which no tick could
occur. Measured, with a positive control: gate-null gave 0 fetches, gate-truthy
gave 0 fetches, indistinguishable, while a 1200ms window gave 1.

⭐ **A guard that cannot fail is not a guard, and I built two of them while
fixing a NIT.** The floor now applies to the env variable only, which is the
thing that needed protecting: `opts.every` is an in-process argument no user can
reach. Re-measured after the fix: gate-null 0, gate-truthy 1, so the arm
discriminates again. The orphan-timer arm recovered too, verified by removing
the single-flight stop and watching it redden.

**The source comment still asserted the theory I had already retracted.** It
said the interval must not divide TTL and closed with "no alignment to walk
into", above a constant that divides TTL exactly. The retraction had reached the
test and this plan but not `engine/update.js`, which is the copy a maintainer
reads. A reader trusting it would either think the code was broken or change the
constant for a reason that does not exist. Corrected in the source to the
invariant the test actually asserts.

**One arm overclaimed in its name and I rescoped it rather than covering it with
a bad instrument.** "The poll the board started does not hold the process open"
drives `startAutoPoll` directly, so it proves the mechanism unrefs and never
inspects the boot timer. Closing it properly needs an accessor for the live
timer, and I did not add one: an export only tests can reach is what the repo's
`engine.reachable` guard catches, and it caught exactly that on this branch one
iteration earlier.

I also tried to observe it without an accessor, through
`process._getActiveHandles()`. Measured: that returns zero Timeouts even for a
deliberately ref'd interval, so the probe cannot distinguish ref'd from unref'd
and would have been a check that always passes. Recorded as a known gap rather
than papered over with an instrument that cannot fail.

📌 The remaining WARNING, about nothing recording which version an automatic
install targeted, arrived truncated and is carried into the next iteration
rather than guessed at.

## Iteration 3

**My floor had no ceiling, and the overflow direction is the worse one.**
`setInterval` collapses any delay above 2147483647 to 1ms, so setting
`AGENT_WORKFORCE_UPDATE_POLL_MS` to a year, which is the natural way an
operator would try to turn the poll OFF, spins `installedRoot()` about 780
times a second forever. Measured, both arms: a one-year value gave `_repeat=1`
and 39 ticks in 50ms with a TimeoutOverflowWarning, against 0 ticks for the
60000 control.

⭐ The floor's own justification applies verbatim to the other end, and I had
written that justification while guarding only one side of it. Clamped now, so
a year resolves to about 24.8 days, which is what the operator wanted anyway.

**Nothing on the machine recorded what an unattended install took.** The
attempt carried a start stamp, an exit code and no version. That was tolerable
while an automatic install needed somebody at the board; this card makes the
unattended path normal, and the first question after a machine changes version
by itself is what it installed and when. The record now carries `version` and
an `auto` flag, and the automatic path writes one stderr line. The manual path
stays quiet, because a person who pressed the button already knows.

**A docstring named a use nothing supports.** `autoPollRunning()` said it was
"for anyone diagnosing a frozen board", when no route, CLI verb or Settings
field exposes it, and it is excused elsewhere as a test seam. It would also
answer true in the state a diagnoser cares about most, since a timer that fires
and returns early at a gate is still running.

### Named, not changed: the board now phones home even when auto-update is OFF

The tick gates on `AGENT_WORKFORCE_DRY_RUN` and `installedRoot()`. The
preference is consulted downstream inside `maybeAutoInstall()`, so an installed
board contacts the release host on the timer regardless of the switch. Before
this change an unattended board made zero outbound requests.

I am leaving the behaviour as it is. The standing decision in
`engine/update.test.js` is that off means do not install rather than do not
tell me, and the Settings card needs a fresh answer to show. But the plan named
only the INSTALL change under weakest premises, and unattended outbound traffic
from a machine nobody is at is the half a reviewer would want named. It is
named here and it goes in the PR body.

### For the PR body, recorded so it is not forgotten

`tools/check-ship-declaration.js` classifies a body with no `user-visible` line
as SILENT, which is indistinguishable from a deliberate internal-only merge.
This branch is user-visible on every installed machine, so that line has to be
there.

## Iteration 4

**My iteration-3 fix was erased at exactly the moment it mattered.**
`noteAttemptEnd` rebuilds `lastAttempt` from scratch, so it dropped the
`version` and `auto` fields I had just added. And it drops them in the ONE case
where the record survives to be read: a successful install kills this server
before anything is recorded, so an attempt that has an `endedAt` is always a
failure, and the failure record is precisely what an operator reads after a
machine changed version by itself. `/api/status` ships it to the page, so both
fields vanished from the API the instant the installer exited.

⭐ My new arm never caught it because it only asserted while the install was in
flight; the injected runner's `on()` was a no-op, so the exit path was never
driven. Now carried through the rebuild, with an arm that fires the exit
handler and re-reads the record.

**A guard that had never once fired.** `setupUrl()` read `cache.latest.version`,
but `cache.latest` is a STRING, so `.version` was always undefined and the
cache-busting query was never appended. The comment above it explains the buster
exists because an edge cache can hand an updating machine the PREVIOUS release's
installer, which then fetches the previous release's bytes and reports success.

This is pre-existing and I am fixing it here because this branch changes its
consequence rather than its correctness: #1277 makes the unattended path the
normal one, so that failure now happens with nobody watching. Measured before
and after: `https://installkosmos.com/setup` became
`https://installkosmos.com/setup?v=9.9.9`.

**The ceiling was scoped like the floor, and it should not have been.** The
floor is deliberately env-only, because an env variable is something a user can
reach while `opts.every` is an in-process argument. That argument does not
transfer to the ceiling: the `setInterval` wrap above 2147483647 is a property
of the VALUE, not of who supplied it, so `{ every: 1e12 }` would have got the
same 780-per-second spin in-process. Applied to both paths now.

**`stopAutoPoll` is excused by name.** It has no product caller: its only uses
are inside `engine/update.js` itself, in `startAutoPoll` and in `resetCache`,
which sits under that module's own "Test hooks. Production code never calls
these" banner. It passed the reachability guard only because a module's internal
mentions are counted, which is the same name-collision escape the `setRelay`
entry already calls out. The excuse carries a check, and the check works:
deleting the call from `resetCache` reddens the arm asserting a reset stops the
poll, while nothing in the product changes.

### Accepted rather than fixed

The two interval arms read Node internals (`t._repeat`). There is no public way
to ask a timer its period, and adding an accessor is the export-only-tests-reach
defect the repo's guard caught on this branch twice. The reviewer's own scoping
is right: these fail LOUDLY rather than silently if the internals disappear, so
they are version-fragile rather than unfalsifiable. Recorded so a future red
there is read as a probe that stopped working rather than a cadence regression.

### A green test was holding the broken guard in place

Fixing the cache-buster broke `server.test.js`, which asserted the installer URL
matched `/\/setup$/`. Anchored to the end, that assertion REQUIRED the buster to
be absent, and it was only ever green because the buster was inert. So a passing
test had been pinning the defect.

⭐ Worth naming as a shape rather than an incident: a check written against
observed behaviour rather than intended behaviour will hold a bug in place and
look like coverage while doing it. The assertion now requires the buster, which
is the stronger claim and the one the surrounding comment always intended.

📌 Found only by the FULL suite. My single-file runs stayed green through both
this and the reachability-guard catch in iteration 1, because both defects live
in the interaction rather than in the file I was editing.
