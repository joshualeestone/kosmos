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

> 🛑 **REVERSED IN ITERATION 5, SEE BELOW.** This section records a decision the
> code no longer has: the tick now gates on the preference at
> `engine/update.js`, and `engine/update.test.js` measures it. The reversal and
> the reason are recorded further down, so a reader going front to back gets the
> correction; a reader who greps for "phones home" lands here and would take a
> dead decision for a live one. Pointer added after a reviewer found exactly
> that. The section is kept rather than deleted because the reasoning that was
> wrong is the useful part.

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

## Iteration 5

**My iteration-4 fix covered the rare branch, not the one that matters.** On an
update the installer runs `kosmos stop` before downloading a byte, so THIS
server is dead for every real failure: a 404, a dropped download, a checksum
refusal, a failed swap. The in-memory `noteAttemptEnd` path only ever sees
preflight refusals and spawn errors. The record an operator actually reads after
an unattended machine changed version by itself is seeded from
`logs/install.status`, and that file carried an exit code and a start stamp and
nothing else, so it answered `version: undefined`.

The spawned shell now writes four fields instead of two, and
`seedFromStatusFile` reads them with the trailing pair OPTIONAL, so a status
file written by an older release still parses and loses two fields rather than
the whole failure record.

⚠️ That change tripped a SECURITY guard, correctly. The installer command is
pinned to a reviewed shape because interpolating a release base into a shell
string turns it into shell. The two new values ride as `$4` and `$5`, argv
elements like the three before them, and nothing new enters the `-c` string. The
guard was re-pinned rather than loosened, and it still catches an interpolated
command: verified by planting one.

**My reason for not gating the tick on the preference was false, so I gated
it.** I had argued the tick must run regardless because the Settings card needs
a fresh answer. It does not: opening the board hits `/api/status`, which already
calls `poke()` at `server.js:1778`. Ungated, this was new unattended outbound
traffic from machines whose owner had switched auto-update OFF, for no
functional gain. The standing "off means do not install, not do not tell me"
decision is untouched, because the status route still pokes on demand.

**And I wrote a second false claim while fixing the first.** I said a null
preference would throw, be swallowed by the tick's catch, and stop the poll for
good. Measured: the catch is per-tick, so the interval keeps firing and the poll
survives. My arm asserting "the poll still runs and does not fetch" could not
tell the throwing form from the defensive one, so I deleted it and left the
reason in its place. The defensive form stays for smaller and honest reasons:
it matches its sibling, and it avoids throwing once per tick forever on a
machine whose preference file is unreadable.

**The DRY_RUN gate was a convention with nothing enforcing it.** Every file that
boots the server sets it today, so the exposure is closed, but the next file
inherits nothing.

⚠️ **That enumeration was wrong when written and the number is gone on purpose.**
It counted only the files that REQUIRE the server. Seven more boot it as a child
process with `spawn(process.execPath, [.../server.js])`, and the original
detector could not see them: a reviewer planted two files and the require-shaped
one was named while the spawn-shaped one was not. The claim was accidentally
true, because all seven happen to set the variable in their child env. A count
that excludes a whole boot shape is worse than no count, because it reads as
having been enumerated. The guard now matches both shapes and is verified by
planting a spawn-shaped file with no DRY_RUN and confirming it is named. There is now an arm that finds every file which requires
`./server` and calls `start(`, and fails naming any that does not set the
variable. It carries a floor on the detector too, because a detector that finds
nothing would make the arm pass for the wrong reason. Verified by planting a
file that genuinely boots the server: the arm named it.

### Named plainly rather than built: the new fields reach no screen

`/api/status` ships `updateAttempt`, but the only consumer is the update
overlay, which reads `log`, `code`, `startedAt` and `endedAt`, and gates on the
record belonging to a press the viewer just made. An unattended attempt has no
such press, so it is never surfaced there at all.

So the intended surfaces for an unattended attempt are the board's stderr log
and `/api/status`, and I am saying that here rather than implying a screen
exists. Wiring a line into the Settings update card for an ended automatic
attempt is a follow-up, not this card: this one is about the machine asking at
all. Recorded so the gap is a decision rather than an oversight.

## Iteration 6

**The most serious finding on this branch: without a durable brake, #1277 turns
"stale but up" into "DOWN" on the machines it exists for.**

`install/setup.sh` runs `kosmos stop` before it downloads a byte, so a 404, a
dropped download or a checksum refusal kills this process, and `autoFailedAt`,
the module-level brake designed for exactly this scenario, dies with it. The
launchd job is `RunAtLoad` with no `KeepAlive`, deliberately and documented at
`install/setup.sh:3155`, so the board then stays down until the next login.

The sequence on an unattended machine with a persistently failing installer:
boot, poll about a minute later, find an offer, stop the board to install, fail,
stay stopped. Before this branch nothing polled with nobody watching, so that
path was never reached.

`maybeAutoInstall()` now reads the DURABLE record as well, and skips the
automatic path when the last recorded attempt was automatic, failed, targeted
the same version, and is younger than `AUTO_RETRY_AFTER`. The channel already
existed and iteration 5 widened it to carry the version and the auto flag, so
this is the payoff for that work rather than new machinery. The manual Install
button is untouched, because it does not come through here.

⭐ The arm carries a control: a failure recorded for a DIFFERENT version must
still allow the install, or the arm would pass for a predicate that never
installs at all.

**My DRY_RUN gate was the only truthiness read in the repo.** `remove.js`,
`connect.js`, `create.js`, `delete-leftover.js` and `chat.js` all use
`=== '1'`. So `AGENT_WORKFORCE_DRY_RUN=0`, the natural way to say NOT a dry run,
left every other subsystem live and silently switched the update poll off for
good on a production machine, with no signal anywhere. It now matches the fleet.

**My convention guard scanned the wrong tree.** It read only the repo root, but
`tools/run-tests.sh` runs `engine/*.test.js` too, and there are over a hundred
files there. It now walks the tree the runner actually runs, and matches
`require('...server')` rather than the literal `./server`. Verified by planting
a probe under `engine/` that genuinely boots the server: the guard named it.
Measured today: zero engine tests require the server, so the exposure was
latent rather than live.

**And the cadence arm was reading the ambient environment.** It reasons about
the `POLL_EVERY` constant but called `startAutoPoll()` with no options, so it
picked up `AGENT_WORKFORCE_UPDATE_POLL_MS` if an operator had set it. On any
machine with that above `TTL/10` the suite went red for a configuration choice
rather than a code change. It now clears the variable for the duration and
restores it. Verified: the suite passes with a hostile 10-minute ambient value.

## Iteration 7

**My iteration-6 note said the boot loop was closed. It was DELAYED, not
closed, and the difference is the whole point.**

The durable brake I added was a TIME WINDOW, and `endedAt` is the status file's
mtime. launchd is `RunAtLoad` with no `KeepAlive`, so a board that stopped
itself for a failing install comes back only at the NEXT LOGIN, by which point
the previous failure is hours old and the window has long expired. Traced:
login, boot, poll a minute later, install, stop, fail, dead until the next
login. **The board would be up about sixty seconds per login, forever**, and the
window would never once apply. It only ever covered a manual `kosmos start`
inside the hour.

✅ A COUNT does not decay. `maybeAutoInstall()` now also stops after
`MAX_AUTO_ATTEMPTS` recorded automatic failures for the SAME version, carried in
the durable record, and a new version resets it because the count is per
version. Two controls: one prior failure must still retry, and a failure
recorded for a different version must not block a new release.

⭐ Recorded as a correction rather than an addition, because the iteration-6
entry read as if the outcome was closed. A fix that delays a failure and a fix
that removes it are not the same claim.

**Two of my own guards could not be trusted to fail.**

The DRY_RUN arm stubbed two of the tick's three gates and left `autoPref` real.
⚠️ **This paragraph carried a false claim about `autoupdate.js` and the
correction is recorded here rather than made silently.** It said an absent or
unreadable preference reads as off. `engine/autoupdate.js:43` returns
`{ ...DEFAULTS, ok: true }` on `ENOENT`, so **absent reads as ON**; only
present-but-unreadable or corrupt fails toward off, at `:46`. So on a machine
with no `autoupdate.json` the ambient preference was ON, deleting the gate under
test would have produced a fetch, and the arm would have failed. **The hazard I
described did not exist in the state I described it in.**

The hazard is real for the other two states, a file present and off or one that
is unreadable, so the fix is unchanged: the arm stubs all three gates and carries
a negative control, with the variable unset the tick MUST fetch, or the assertion
proves only that this poll never fetches. **The fix was right and its stated
reason was wrong**, which is the third time on this branch, and it is the harder
error to catch because a passing arm does not invite anyone to read the sentence
above it. `server.switch-account-1373.test.js:143` stated it correctly on this
same branch the whole time.

The convention guard tested for MENTION, not VALUE, while the product gate is
`=== '1'`. A file setting `''` or `'0'`, or naming the variable only in prose,
satisfied it. Not hypothetical: `engine/remove.test.js` sets it to `''`.

🛑 **And tightening it found a real file, which I nearly broke.**
`server.switch-account-1373.test.js` boots the server and deliberately does NOT
set the variable: its header records that DRY_RUN also disables the account
block, so a test that set it would measure a world where the feature never ran.
It intercepts with `setRunner(fake)` instead. I was one edit from "fixing" that
file and destroying its purpose; reading the comment is what stopped me. It is
now excused BY NAME WITH A REASON, the same shape `engine.reachable.test.js`
uses, and the guard still catches a file setting the variable to `''`.

**An arm's name promised a stderr assertion its body never made.** That matters
here beyond naming: the new fields reach no screen, so that line is the ONLY
artifact an unattended install produces for a human, and it was the one thing
with no cover. Now asserted on both paths, and the first attempt captured
nothing because `refresh()` ends by calling `maybeAutoInstall()`, which fires
the install before a spy installed afterwards can see it.

### One intermittent failure, recorded rather than swallowed

The first full-suite run after iteration 7 failed one arm,
`server.test.js:5582` ("the first-run routes answer"), with `TypeError: fetch
failed`. It is not my change: that file passes 251/251 twice in isolation, the
full suite passes 3369/3369 on re-run, and nothing in this diff touches
first-run.

📌 Written down anyway. An intermittent red that gets re-run to green teaches
people to re-run rather than to look, and a suite nobody trusts is a permanent
loss. The shape is a network-shaped failure under a full-suite run with many
servers up at once, and it should be chased on its own rather than attributed
to whatever branch happens to be in flight when it fires.

## Iteration 8

**Two findings meant the brake I built in iteration 7 could never fire at all.**

The recorded exit code was the PIPELINE's, which is `sh`'s, not `curl`'s, and
there was no `pipefail`. Measured on the live origin, both arms: a 404 piped
into `sh` records **0**, unpiped records 56, with `pipefail` 56. And
`seedFromStatusFile` returns early on `code === 0`. So a 404, named verbatim in
my own comment as the failure this channel exists to record, produced no failure
record and no attempt count. Pre-existing, and this card is what made it
load-bearing.

And `parts()` trims only to VALIDATE, so `refresh()` assigned the raw
`body.version` while the durable read splits on whitespace and returns a trimmed
one. A manifest carrying padding made `durable.version === offer.version` false
forever, which silently disables the same-version brake. Trimmed on assignment,
with an arm.

**The record rebuild dropped a field for the THIRD time.** `noteAttemptEnd`
carried `version` and `auto` but not `attempts`, so on the one path where this
server survives a failed install the count walked BACKWARDS: the child wrote 2
durably, the rebuilt record said undefined, and the next attempt wrote 1 over
it. Three fields, three iterations, one rebuild.

**Giving up was silent.** Starting an automatic install writes a line; hitting
the cap wrote nothing, and the update overlay renders only a record belonging to
a press the viewer just made. The terminal state of this entire mechanism,
"this machine has permanently stopped auto-updating to 99.0.0", reached no human
anywhere. One line now, mirroring the start line.

**And my excuse explained a hole instead of closing it.**
`server.switch-account-1373.test.js` cannot set DRY_RUN for a documented reason,
so I excused it. But it also never touches `engine/update`, so the fetcher and
runner are real, and it seals a sandbox with no `autoupdate.json`, which reads
as ON. From an installed layout the whole chain opened: real fetch, an offer,
a real `curl | sh`. It now calls `stopAutoPoll()` immediately after `start()`,
which closes the exposure without touching its reasoning, and the excuse records
that rather than merely justifying the omission.

⭐ An excuse that says why a file cannot comply is not the same as a file that
is safe. I wrote the first and called it the second.

## I audited every "checkable" claim I wrote on this branch, and ran them

A claim labelled checkable that nobody has run is worse than no claim, because
the label is what stops the next reader checking. I wrote four of them and had
run none. Results, each by perturbing the named line and reading which arm moved:

| claim | verdict |
|---|---|
| delete `stopAutoPoll()` from `resetCache`, `engine/update.test.js` goes red | TRUE, and exactly the named arm |
| delete `updates.startAutoPoll()` from `server.js`, the wiring test goes red and `engine/update.test.js` stays green | TRUE, both arms |
| `engine/create.js` checks the runner BEFORE `DRY_RUN` | TRUE, `:266` then `:267` |
| delete `create.setRunner(fake)` from the switch-account test and its control goes red | **FALSE** |

The false one is the interesting one. Removing that interception leaves all six
of that file's tests green. Instrumenting the seam says why, and the two numbers
are the finding: a control marker proving the probe ran fired **once**, and
recorded invocations of the create runner were **zero**. That file never reaches
the seam. The interception is defence in depth, not the thing protecting it.
What protects it is the #1598 fail-closed live-execution gate at
`engine/create.js:268`, which throws in a test process unless `server.js` has
called `allowLiveExecution()` on its real start path.

So the exemption itself stands, and the reason printed under it did not. That is
the fourth time on this branch that a correct thing carried a wrong reason, and
the pattern is now clear enough to state: **I am reliably right about what to do
and unreliably right about why**, and the wrong why survives because it sits
above something green. Nothing in a test run reads a sentence.

Two of the three true claims were verified only because I went looking; neither
had been run when I wrote them either. The audit is cheap, it is one perturbation
per claim, and it found the one that mattered.
