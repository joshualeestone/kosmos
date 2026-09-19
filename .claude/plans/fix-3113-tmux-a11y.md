# Plan: #3113 - onboarding tmux Accessibility row stuck on CHECKING with no Allow-access button

## The bug (Josh, 2026-09-15 screenshot, "Automation: Kosmos never sleeps" step)
On the S3 Automation step, the Accessibility ("control your computer") panel lists Kosmos and tmux.
Kosmos resolves to "ACTIVATED" but the tmux row sits forever on "Checking..." with NO Turn On /
Allow-access affordance, so the user cannot grant tmux Accessibility from onboarding.

## Root cause (measured from code)
- The tmux row (`data-gate="tmux-a11y"`) reads `/api/tmux-a11y-status`, served by `a11ystatus.tmuxGrant()`,
  which keys on the bundled tmux binary's own Accessibility TCC row.
- On a fresh install nothing registers tmux in Accessibility, so `tmuxGrant` returns `present:false`.
  The route maps that to `checkable:false` (uncheckable), which the poll paints as "Checking...".
- The Turn On button lives only in the `blocked` (red) render state; an uncheckable row shows the
  spinner with no button. So a never-registering tmux row is a permanent dead "Checking...".
- Why Kosmos differs: the Kosmos app registers its own Accessibility row on launch (it has a row at
  auth 0), so its row paints "Not activated" + Turn On. tmux never runs an AX op until an agent
  drives Terminal, so it has no row -> present:false -> Checking forever.

## The remove-vs-keep-vs-port decision (was parked on a fresh-Mac TCC read)
My parked #3113 protocol needed a clean-Mac TCC.db read to decide. **That measurement already exists**
in the unmerged commit `ca850d0ee` (branch `a11y-both-2911`): *"Empirically confirmed on this Mac's
TCC db: tmux granted accessibility, AEServer granted, com.chaoskosmos.kosmos NOT granted."*
=> tmux DOES acquire its own `kTCCServiceAccessibility` row. Decision map result: **KEEP the row +
PORT the up-front trigger**, NOT remove. Josh also ruled it explicitly ("add the tmux accessibility
one as well ... get both in the next build"; owner -> Angel; do not block on a Josh observation).

## What finished looks like
On the S3 Automation step, the tmux Accessibility row shows a real, actionable "Not activated" +
Turn On affordance (never a dead "Checking..." spinner) when tmux is not yet listed. Turn On fires a
native prompt attributed to tmux (registering tmux's own Accessibility row) and opens the
Accessibility pane. Once granted, the poll flips the row to "Activated". A browser / no-FDA box still
shows the honest "Checking..." (nothing to grant there) and Next is never trapped.

## Approach (two coordinated halves)

### 1. Port the trigger mechanism (from ca850d0ee, adapted to current main's two-row markup)
Current main has TWO separate rows since #3075 (`tmux` = app, `tmux-a11y` = tmux), so the port gives
the `tmux-a11y` row its OWN trigger rather than the old commit's "fire both from the tmux row":
- `engine/promptrequest.js`: new request kind `tmux-a11y` -> `tmux-a11y-prompt-request`.
- `server.js`: `POST /api/tmux-a11y-prompt` mirroring `/api/a11y-prompt`.
- `native-app/main.swift`: `spawnTmuxAutomationPrompt` runs `osascript` (a read-only System Events
  probe) DIRECTLY under the bundled tmux, so macOS attributes the prompt to the responsible process
  (tmux); wired into the `checkPromptRequests` watcher + the `names` array.
- `web/index.html` `s3PermissionTargets`: `gate === 'tmux-a11y' ? '/api/tmux-a11y-prompt'` trigger,
  keeping the shared open-accessibility-settings fallback.

### 2. Make the not-yet-listed state ACTIONABLE (the actual "no button" fix)
Rather than fire a prompt on S3 entry (rejected below), render the row so the user always has an
affordance:
- `server.js` route: `present:false` -> `{ checkable:false, actionable:true, because:... }`. Stays
  NON-blocking (the #2912 no-trap invariant) but is now distinguishable from a browser's plain
  uncheckable (which has no `present` field, so no `actionable`).
- `web/index.html` `frReadGate`: carry `actionable` off the reading (uncheckable branch).
- `web/index.html` `frPollGates`: an uncheckable-but-actionable row paints the DEFAULT
  "Not activated" + Turn On state (not `data-checking`) and STILL never sets `anyBlocked`.

## Why NOT fire the trigger up front on S3 entry (rejected alternative)
My first cut fired `/api/tmux-a11y-prompt` in `frGateStart` on S3 entry. Measured: a fire-and-forget
POST issued during the `?fr-step=3` navigation is orphaned by Playwright (`requestfinished` never
fires), so `render-gated-next`'s `networkidle` wait never settled -> 30s timeout. (Proven: an awaited
in-page fetch to the same route completes in 3ms; the entry-fire hangs. MAIN passes 2/2, the entry-fire
WT fails.) The actionable-render approach is deterministic, needs no entry-fire, and better matches
Josh's literal complaint (an affordance now, not a spinner that may or may not resolve).

> SUPERSEDED FOR #3221 (2026-09-18, Ice Cream Kitty): Josh's 0.6.78 fresh box found the Turn-On
> fire surfaces the wrong (System Events / Open Terminal) Automation prompt, so #3221 moves the
> register back to S3 entry and makes Turn On a clean deep-link. The entry-fire hang recorded above
> was re-measured and does NOT reproduce on current code (`render-gated-next` 3/3 + render-permission-
> slider 1/1 green with the entry-fire, because the served endpoint answers fast and networkidle
> settles); those two S3-gate checks additionally now mock `/api/tmux-a11y-prompt` so it can never
> orphan during their goto. See `.claude/plans/ick-3221-tmux-a11y.md`.

## Verification
- Node: full `tools/run-tests.sh` green; `web.firstrun-a11y-1214` gains a 3-layer #3113 test
  (route flags actionable + non-blocking; frReadGate carries it; frPollGates paints Turn On, still
  never gates).
- Browser (via pw-runtime): `render-gated-next` all clear incl. a new positive arm (actionable ->
  Turn On shown, not green, not spinner, Next enabled) AND a negative control (plain uncheckable ->
  Checking, no Turn On). `render-permission-slider-2620` all good.

## Weakest premises (named, per the standing chunk shape)
1. **tmux's registration is attributed to the bundled tmux binary.** ca850d0ee measured the HOMEBREW
   tmux granted on this dev Mac; a fresh install runs the BUNDLED tmux (a different binary). The
   osascript probe string is the one verify-pinned string (native comment marks it a one-line
   retarget if macOS names a different binary/service). This does NOT gate the UX fix: the actionable
   render + open-settings fallback give the user a working path even if the native prompt attribution
   needs a retarget. Josh eyeballs on staging.
2. **The read-only `System Events` probe raises the Accessibility prompt.** It may instead (or also)
   raise Automation/AppleEvents; the fallback opens the Accessibility pane regardless, and the probe
   is the retarget seam.
3. **`actionable` render never traps.** Verified: it stays `checkable:false`, so `anyBlocked` is only
   set by a definite `blocked`; the negative-control browser arm proves a non-actionable uncheckable
   still shows Checking with no button.

## Not done / deferred
- No new browser-check FILE added (the S3 gate is already covered by `render-gated-next`, which I
  extended in place); so no `tools/browser-checks.sh` wiring / README row is needed.
- The native Swift change cannot be compiled/run on the night-shift board; it is a mechanical mirror
  of the existing `spawnAxHatchUnderTmux` and is covered by the cross-language contract node test.
