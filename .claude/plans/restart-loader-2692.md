# Plan: #2692 branded K-dots loader in the agent-restart interstitial

## The card

Josh, design channel 2026-09-10 (kosmos#2692). Exact words:

> When we are restarting an agent I want to show our nice big K that is made of
> dots and that animates into a circle. I'd like it to show for at least a
> minimum of 2 full seconds, or at least as long as a single animation of the K
> animating into the circle is.

He flagged the small "pulsing icon" shown during a restart as the wrong asset.
Screenshot: the "Change Scorpion to Claude Opus 4.8?" dialog with a small gold
rounded-square K over "Restarting the agent".

## What was there

- The restart interstitial (the change-model dialog's in-flight state) rendered
  `.kspin` - the small breathing Kosmos MARK (`@keyframes kbreathe`, a static
  `<img>` of `/icons/kosmos-48.png` at 44x44). Its own comment says it is the
  MARK, deliberately not a loader. That is the pulsing icon Josh flagged.
- The branded loader already exists: `startKLoader(canvas)` - the K's 155 dots
  scatter from a ring, gather into the K, hold, and open back out to the ring, on
  a 4400ms loop. Already reused at two mounts (the update overlay `.upd-k` and the
  make-an-agent `#made-mark`). Honors reduced-motion internally.
- The interstitial markup is built by `chgBusyHtml(line)` and injected via
  `msg.innerHTML` in the shared `changeDialog`. `RESTART_HOLD_MS = 2000` is the
  success hold floor (via `minBusyMs`). The provider switch shares this markup
  ("Setting up OpenAI" / "Setting up Anthropic").

## The approach

Reuse `startKLoader` in the interstitial rather than build a second loader (a
second copy would drift the first time the mark changes - the same rule the
loader's own comment states for its existing two mounts).

1. `chgBusyHtml` emits a `<canvas class="chg-restart-k">` instead of the static
   `.kspin img`. Decorative (`aria-hidden`) because `line` is the announced text.
2. `changeDialog`, after injecting `busyHtml`, mounts `startKLoader` on that
   canvas (it must be in the document first, which it is - the modal is open).
3. Raise the hold floor to `max(2000, K_LOADER_CYCLE_MS)` = 4400ms, so a fast
   restart still shows one whole K-into-circle animation. `K_LOADER_CYCLE_MS`
   (the loop length) is extracted as the single source, shared by the loader and
   the floor so they cannot drift.
4. CSS: `.chg-restart-k` sized 88x103 (the "big K", 176x206 bitmap at 2x for
   crispness, the same proportions the update overlay uses); the dead
   `.chg-restart .kspin img` rule removed.

## The lifecycle trap (the load-bearing correctness fix)

`startKLoader`'s rAF loop never stops on its own - its two existing mounts exit
by a page reload, so the loop dies with the document. The restart interstitial
HIDES WITHOUT A RELOAD (changeDialog replaces the modal's content on
success/failure, removing the canvas), so a naive reuse would leak an rAF loop
drawing to a detached canvas forever.

Fix: the frame loop self-terminates when its canvas leaves the DOM
(`!cv.isConnected`). This is benign for the two reload-exit mounts (their canvas
stays connected until the reload). It is what lets the interstitial tear down
cleanly with no external stop handle.

## Requirement interpretation (the decision)

"at least 2 full seconds, OR at least as long as a single animation ... whichever
is longer." One full loop of the loader is 4400ms > 2000ms, so the effective
floor is 4400ms. Decided: floor = `max(2000, K_LOADER_CYCLE_MS)`. Rejected:
keeping 2000, which no longer covers one full animation once the loader (not the
2.4s breathe) is the mark. Consequence Josh asked for explicitly: a fast restart
now holds ~4.4s so the whole animation plays.

## Scope decision: both model AND provider switch get the loader

The card's screenshot is the model switch, but the provider switch shares
`chgBusyHtml` and is also a restart (#2463 deliberately unified them). Changing
`chgBusyHtml` gives both the branded loader, keeping them consistent. Rejected
narrowing to the model switch only, which would reintroduce the two-copies drift.

## Verification

Extended the existing `render-model-restart-interstitial` browser-check (rather
than a new check, avoiding the 3-place registration): branded canvas present and
actually painting, the pulsing `.kspin` gone, the floor covers one full cycle
(read from the live consts, which also proves no scope/TDZ error), plus a
detached-canvas negative control proving the loop self-terminates. The 2019
status-card check (unrelated `.kspin`) still passes, confirming the page loads
clean and the status-card mark is untouched.

## Weakest premise

That "a single animation of the K animating into the circle" means one full
4400ms loop rather than a shorter directional sub-phase. If Josh meant a shorter
unit, the 4.4s hold is longer than he wanted; it is one constant to tune
(`K_LOADER_CYCLE_MS` / the `max(2000, ...)`). Left josh-review so he can adjust.

## Not done

- No success "finish" tick (K -> green check). Josh did not ask for it, and the
  interstitial's success is the outcome sentence + Done, which the finish would
  fight. Out of scope.
