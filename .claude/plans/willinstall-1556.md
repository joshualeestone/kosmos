# willinstall-1556: the confirm step should know whether 281MB is coming

## The card

`/api/connect` does not say whether pressing Connect will download Claude Code.
The confirm dialog exists because a large download beginning with no warning is
alarming, and it cannot warn about what it cannot see.

## 🛑 CORRECTION, AFTER REVIEW: MY FIRST DESIGN SHIPPED NOTHING

**The first version of this branch served `willInstall` on `/api/connect`. Nothing
reads that.** `frClaudeInstallNeeded()` reads `FR.connect.willInstall`, and `FR` is
assigned WHOLESALE from `/api/first-run` at both of its two assignment sites, so it
never carried the route's reply at all.

Verified independently, not taken on the reviewer's word:

```
frClaudeInstallNeeded()      reads FR.connect.willInstall        (web/index.html:30754)
FR assigned at               30101, 32559 -- both from /api/first-run, wholesale
FR.connect = ...             assigned NOWHERE
firstrun.state() returns     {done, fleetKnown, fleetCount, path, subscription}
'connect' in firstrun.js     2 mentions, both PROSE   (control: 'subscription' 7)
```

⇒ `typeof st.willInstall === 'boolean'` stayed false, so the screen kept asking
everybody, exactly as before the change.

⭐ **My verification was three boards querying the route, which is precisely the
half that already worked.** This file's own producer says the rule I broke: *"a
field nothing reads is a claim nothing checks."*

**Fixed by moving the field to `/api/first-run`**, and `/api/connect` is now
byte-identical to main. That also removed a second defect rather than trading it:
`/api/connect` is polled every 1000ms, and an awaited 15s probe on a 1s poll stacks
concurrent subprocesses. `/api/first-run` is fetched at two sites, neither in a
timer, and already awaits `checkLive()`.

## Design, and the constraint that decided it

I measured the shape before choosing, because the card's line references were
stale after #1560 landed:

```
state()       287-312   SYNC     owns 6 of 11 publicView calls, what the client reads
start()       643-800   async    owns haveBinary
publicView()  314       SYNC     11 call sites
/api/connect  route at server.js:3672, handler NOT async
```

`state()` is sync and feeds most of `publicView`. A probe cannot be awaited from
there, and making it async disturbs eleven callers for one field.

⇒ **Do not touch `state()` or `publicView`.** `connect.willInstall()` is its own
async function that only COMPUTES the value; `firstrun.state()` is the producer
that carries it to the page, and it fails open (a null is not a boolean, so the
reader asks, which is the pre-#1556 behaviour).

The cache is one-sided deliberately: the cheap `accessSync` runs every time and can
only move the answer toward "will install". Only the probe result is cached, 60s.

## 🛑 What the end-to-end check found that six unit tests could not

I wrote six unit tests and five passing perturbations, all green. Then I queried
the real route on three boards:

```
working claude    willInstall=false
BROKEN  claude    willInstall=false   <- MUST be true
no claude at all  willInstall=true
```

`false` means "no install needed", so that is the unannounced download this card
exists to prevent, produced by the exact case the card is about.

**Cause, both arms measured:** `run()` returns `{ok:true, dryRun:true}` without
executing, so the probe scored a binary it never invoked.

```
same broken binary, dry-run OFF -> true    (correct)
same broken binary, dry-run ON  -> FALSE   (harmful)
```

**The units and the route disagreed and the route was right.**

## The finding that is bigger than this card

I only had dry-run set because **the server's own sandbox guard told me to.** It
refuses a half-sandboxed start and names `AGENT_WORKFORCE_DRY_RUN=1` as the way to
neutralise tmux.

⇒ The safety guard's recommended remedy silently disables the probe. Anyone testing
a board the way the guard instructs gets the harmful answer, from a path that looks
fully exercised. Filed as **#1568**; Angel hit the same guard on #1562 the same
night. I did not touch the guard - that is wider than this card.

## Two things I got wrong and corrected in flight

1. **I named `create.js:240` as the cause. Wrong file.** `connect.js` has its own
   `run`, `DRY_RUN` and `setDryRun`, and never requires `create.js`. The behaviour
   was measured; the cause I named was not. A wrong citation reads as checked, so it
   is corrected in the code comment rather than dropped.
2. **My first test for it was vacuous.** It set the env var inside the test, but
   that var is read at module load (`connect.js:137`). Perturbation caught it: guard
   removed, all 7 arms still green. A test that passes with and without the fix is
   not a test. The real arm is in its own file, because `setRunner(null)` forces
   dry-run back on and `setDryRun(false)` refuses without a runner, so the seam
   cannot be un-set inside a shared file.

## Deliberately not done

- `willInstallBytes` - Renet's separate card, needs the manifest. Two fields.
- The sandbox guard - #1568.
- `state()` / `publicView` - see the constraint above.

## Verification

- Route, sandboxed with a tmux stub so the probe really runs: false / true / true.
- All five files touching `/api/connect`: 53/53 green.
- Full suite 3071 tests, 1 red, shown to be contention on five independent grounds
  (green alone 250/250; the test body references none of connect, willInstall or
  `/api/connect`; whole file zero `/api/connect` against a control of 486 `/api/`;
  load 7.61 on 10 cores; the suite prints that exact guidance).
