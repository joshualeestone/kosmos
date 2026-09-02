# Plan: talk-scroll-1926 -- the conversation view jumps every 5s when scrolled back (#1926)

## Report (Josh, via Splinter)
The conversation view flashes and jumps every 5 seconds, but only when the reader has
scrolled back. "if I scroll back in time, then it will sort of jump around weird. It'll
flash and it'll jump to different spots." Fixed cadence (a poll), only when scrolled
back (masked at the bottom), jumps to different spots (not a flicker in place).

## Diagnosis (measured)
- The 5s poll is `setInterval(tick, 5000)` (web/index.html:35142); it repaints the talk
  thread on the detail poll.
- `setThread` (web/index.html) does `el.innerHTML = html` whenever the html string
  differs by one byte (its guard is byte-identity, not a structural diff).
- The html churns even sitting idle because `pjWhen` renders RELATIVE time ("a minute
  ago" -> "2 minutes ago"), and every new message from the other agent changes it too.
- The JUMP: after the full replace, setThread restored a PIXEL offset (`__heldTop`), not
  an element anchor. When content ABOVE the viewport changed height -- a timestamp
  ticked, or an image reloaded to height 0 during the full node replacement -- the same
  scrollTop pointed at a different message. At the floor an auto-scroll-to-latest masks
  it, so it is invisible unless scrolled back. Matches Splinter's hypothesis (nodes
  replaced, offset restored into changed content).

## Fix
- `dmRow` stamps each row with `data-mid` (message `id`, or `at` as the fallback the
  thread key already trusts).
- `setThread`, for a scrolled-back reader (`__heldAtBottom === false`), captures WHICH
  message is at the top of the viewport and its offset below the fold (`threadAnchor`)
  BEFORE the rewrite, and restores that message to the same offset AFTER
  (`restoreThreadAnchor`). Falls back to the old pixel restore when there is no anchor
  (a first list paint, or a row whose id changed), so that path is no worse than before.
  A reader at the floor is still pinned to the floor.

## Test
`web.talk-scroll-1926.test.js` models real rows (data-mid + per-row offsets, a row that
grows) and drives setThread through a poll where a row ABOVE the reader grows; asserts
the anchored message stays at the same viewport offset. Control 1: the old pixel-hold
DOES drift (so the fixture can return the dangerous answer). Control 2: a reader at the
floor still follows the newest message. The existing web.thread-scroll.test.js keeps its
arithmetic cases (its stub box returns no rows, so setThread takes the pixel fallback)
with the two new helpers wired into its loader.

## Decisions / scope
- Element-anchor restore, NOT a full in-place DOM reconciliation. The anchor restore
  directly fixes the reported jump and Splinter's control (anchored message stays
  anchored) with a localized change, no render-interface refactor. A full keyed
  reconcile would additionally stop the node replacement itself (killing any residual
  image-reload flash), but is a large change to a delicate shared function; recorded as
  the follow-up if an image-heavy history scrolled past still shows a residual flash.
- Residual: after the rewrite, images ABOVE the anchor that reload from the full replace
  are momentarily height-0, so the anchor offset can be briefly short until they load.
  The existing pinToBottom has an image-completion re-pin for the floor case; extending
  that re-anchor to the scrolled-back case is the follow-up if needed. For a TEXT
  conversation (the reported case) there are no images above and the restore is exact.
- Scoped to the talk thread (`#d-dmthread`, paintTalkThread), the surface Josh reported.
  The project room (`#pj-post`, setLive) likely shares the class; not touched here --
  flag for a follow-up rather than widen scope unverified.
- "again" in the report: #1037 fixed the note-flap (a different instance of the same 5s
  poll churn); this is the scrolled-back height-change instance, not a regression of that
  fix (the note-flap tests still pass).
