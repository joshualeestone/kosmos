# kosmos#727 item 4 -- an abandoned browser leg outlives the sign-in

## Source

`source: Josh, #chaoskosmos-design 2026-08-24 20:56-20:58 CDT`, card kosmos#727. Items 1-3
(one provider at a time, a real-sized key field, a findable exit) already shipped in PR #821
and were confirmed live by Mona Lisa (comment 2026-08-25 23:58). **Item 4 is the engine's**,
handed to Angel by her heads-up at 21:01, and is the only thing left open on the card:

> An abandoned browser leg still leaves the sign-in awaiting a code across refreshes; the
> screen now makes the exit findable and honest, but only the engine can tell an abandoned
> leg from a slow one.

Josh's own words, describing the trigger directly: he added a second account, then tried a
third; the "Switch Account" click inside the OAuth browser tab took him to the Claude web
app instead of back to Kosmos, and Kosmos was left showing "Enter the code from your email
to finish" with no code ever coming and no way out ("I've refreshed several times but I
can't get out of this" -- true before #821's Stop button; after it, the exit exists but the
sign-in record itself still never expires, so it is there again on every reopen).

A second, related complaint was folded into the same "done when" list from a duplicate card
(#897, closed): a REAL successful authorize also left "Enter the code from your email" on
screen with no success confirmation, rolling back to a plain sign-in state later even though
the account had actually been added in the background.

## Root cause, read directly from `engine/connect.js`'s sign-in driver

Two separate, adjacent gaps in the same state machine (`tick()` / `tickBody()`, the
`awaiting-code` / `browser-open` cases of the `switch (seen.kind)` block):

1. **No expiry, by design, and that design is now wrong for one case.** The paste-prompt and
   browser-wait screens are deliberately exempt from every stuck-timeout in this file (the
   existing comment at the top of the switch says so explicitly: "the paste prompt and the
   browser wait legitimately sit unchanged for as long as a person dawdles"). That was correct
   until the flow can be abandoned in a way that leaves the SAME pane text on screen forever --
   `classifyPane()` reads pane text only, so an abandoned browser leg and a person still
   reading their email produce an identical `awaiting-code`/`browser-open` classification.
   Nothing in this file currently distinguishes them.

2. **"The config outranks the screen" is wired to the wrong set of screens.** This file
   already has the right principle, applied in exactly one place: the `unknown`-classification
   escalation (around the existing `unknownTicks` grace) calls `subscription.check()` before
   giving up, specifically so a login that actually landed is never reported as failed just
   because the CLI's wording drifted. The `login-done`/`press-enter`/`repl` case also checks
   it, every tick. But `browser-open` and `awaiting-code` -- the two screens a completed
   sign-in is MOST likely to still be showing, because the CLI's own post-login repaint can lag
   or (per #897) apparently sometimes never lands within this driver's own window -- never
   check it at all. A sign-in that finished on Anthropic's side while the pane still shows the
   paste prompt is invisible to this driver until (if ever) the pane text itself changes.

Both gaps are adjacent code in the same two `switch` cases, and the same generous, minimal fix
closes both: check the config FIRST, on every tick where the pane shows `browser-open` or
`awaiting-code`, before anything else runs; only if it disagrees with the screen does a
time-based expiry apply at all.

## Fix

`engine/connect.js`:

1. **Config-outranks-screen check, extended.** Before the `switch (seen.kind)` block, when
   `seen.kind` is `browser-open` or `awaiting-code`: call `subscription.check()` (scoped to
   `owner.configDir` exactly like every other call site in this file) and `finishConnected()`
   immediately if it reports connected -- mirroring the exact pattern and reasoning the
   `unknown`-escalation arm already uses, just applied to the two screens that needed it. This
   alone fixes #897's silent-background-success case: the account shows Connected on this
   screen the moment the config flips, regardless of what the terminal is doing.

2. **A generous, resettable expiry for the abandoned-leg case.** A new `ABANDONED_SIGNIN_MS`
   (default 15 minutes -- this same file's own existing `FRESH_BOUND_MS` is already this
   codebase's definition of "dead" for a parked flow, reused here for consistency rather than
   inventing a second number). Tracked as `owner.browserWaitSince`, set the first tick a
   `browser-open`/`awaiting-code` screen is seen and cleared the moment the flow moves past it
   (any other kind, or a config-outranks-screen connect). **Reset on every code actually
   submitted** (`submitCode()` clears it the moment `pendingCode` is set) so a person actively
   retrying wrong codes for longer than the bound is never punished for staying engaged --
   only a flow with no forward evidence AND no activity for the whole window is called
   abandoned. Exceeding the bound calls the existing `becomeStuck()` -- no new phase, no new
   frontend state: it already kills the session, clears the driver, and writes an honest
   `because` the compact renderer (`acctFlowPaint`) already displays via its stuck/interrupted
   path ("Nothing changed; you can try again").
3. `setAbandonedSigninMs(ms)` test seam, matching the existing `setTickInterval` /
   `setUnknownGrace` / `setFreshnessForTests` convention, exported for `connect.test.js`.

## Explicitly not changed

- No new PHASE, no new frontend copy, no new UI state. `STUCK` already has a proven, tested,
  honest rendering path; reusing it is the smaller, better-reviewed change.
- The `theme` / `login-method` / `press-enter` (pre-login) screens are NOT given the
  config-outranks-screen check -- a stale CONNECTED reading there would belong to a
  wholly separate already-connected account, not this flow's own progress, and adding it
  there answers a question nobody asked.
- Not touching `#821`'s frontend work (items 1-3) -- confirmed live and correct by Mona Lisa
  already; this plan is engine-only, per the card's own split.

## Test plan

`engine/connect.test.js`, extending the existing `driverTest` fixture (`fakeTerminal()`,
`SCREEN_PASTE`/`SCREEN_SPINNER` fixtures, `until()`):

- A sign-in whose pane stays on `browser-open` (never advances, no code ever typed) still
  reaches `CONNECTED` the moment the sandboxed Claude config flips -- proves the
  config-outranks-screen check actually applies to `browser-open`, mirroring the existing
  "browser flow completes on its own" test but WITHOUT the pane ever showing `login-done`.
- Same, parked at `awaiting-code` after a code was already submitted and rejected once.
- An abandoned flow (parked at `awaiting-code`, config never flips, no code ever submitted)
  past `ABANDONED_SIGNIN_MS` becomes `STUCK` with an honest `because`, and the session is
  killed -- the actual bug reproduction.
- A flow that submits a rejected code just before the bound is NOT declared stuck at the
  original bound's real-clock time -- proves the reset genuinely re-arms the window rather
  than being a no-op.
- Control: parked well within the bound, never connects -- NOT stuck. This is the regression
  guard for the existing "sits unchanged as long as a person dawdles" behavior for durations
  that are actually plausible.

Full suite: `bash tools/run-tests.sh`, 0 failures required before PR.

## Challenge-loop

Standard `/challenge-loop` to convergence before `/create-pr`, per house process.

## Deferred design tradeoffs, surfaced by challenge-loop, not code defects

Two things a fresh review named that are real product judgment calls rather than bugs, both
addressed by leaving `ABANDONED_SIGNIN_MS` a single, easily-raised constant rather than by a
code change:

- **One combined 15-minute budget for the whole browser wait, not 15 minutes at each stage.**
  `browserWaitSince` is set once, the first tick either `browser-open` or `awaiting-code` is
  seen, and is not restarted when the screen advances from one to the other. Someone who
  spends 10 minutes on a slow OAuth/2FA leg has 5 minutes left once they reach the paste-code
  screen. The alternative (two independent 15-minute clocks) would let a person legitimately
  sit for up to 30 minutes total; a single shared budget matching this file's own existing
  15-minute "dead" convention was judged the better default. Covered by a dedicated test
  (`the abandonment clock survives the real-world browser-open -> awaiting-code transition,
  not restarted`).
- **15 minutes may be tight specifically for a delayed one-time code.** The only way to keep
  the clock alive while parked at `awaiting-code` is `submitCode()` actually being called; a
  person genuinely waiting on a slow-to-arrive code (spam filtering, provider queuing) has no
  way to signal "still here" until the code shows up, and could be declared expired through no
  fault of their own.

Both are worth a look after this ships in practice; if either turns out wrong, the fix is a
one-line change to `ABANDONED_SIGNIN_MS`'s default, not a redesign.
