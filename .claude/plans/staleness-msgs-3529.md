# #3529: remove agent staleness / report-status warning messages app-wide (Mac + Windows)

**Branch:** `staleness-msgs-3529` · **Card:** kosmos#3529 (consolidates the closed #3482 and
#3528, both folded into this one).

## What Josh asked for

Josh, 2026-09-23 evening (windows channel), verbatim:

> "i dont want to see any of these messages appearing in the app like 'Its reports stopped
> arriving...' and on the agent page 'Its reports stopped arriving...' and the 'This might not be
> what the agent..' Lets make a card for this and make sure none of this is on PC or Mac."

He does not want users seeing internal telemetry-staleness / "we can't tell" hedging language: it
reads as broken/uncertain to a user. Remove the messages (do not just reword), on BOTH platforms.

## The two message families removed

1. **"Its reports stopped arriving while its screen still shows work, so the reporter may be
   broken."** This is an engine `stateConflict` value produced in `reconcileReport` (rule 5: a
   stale working report meeting a scraped WORKING screen). It renders via `conflictNote(a)` on two
   surfaces: the agent card (`web/index.html`, the `.note` div) and the agent page (`#d-conflict`).

2. **"This might not be what the agent is actually running. Agents read this file when they start.
   We cannot tell when this agent last started."** The `unknown` arm of `renderStale` in
   `web/index.html`. Josh named the shared headline itself, which every `unknown` reason prints, so
   the whole banner goes rather than only the last-start clause.

## Where and how

- **Message 1, removed at the engine SOURCE.** `engine/status.js` `reconcileReport`: the rule-5
  branch now returns `conflict: null` instead of the sentence. Removing at the source (not
  string-suppressing in the render) means every consumer drops it: the card renders no `.note` when
  `conflictNote` is empty, and `#d-conflict` sets `hidden = !textContent`, so no empty placeholder
  is left. This also made the pre-existing `#1889` background-wait exemption redundant (its return
  and the else were byte-identical once the accusation was gone), so the two collapsed into one;
  `backgroundWait` still rides out on `...scraped` for downstream readers.

- **Message 2, removed at the render.** `renderStale`'s `unknown` arm now says nothing: it hides
  and clears THROUGH `setLive` (like the `told` arm), preserving the empty-amber-bar record-safety
  invariant this file guards. The engine's `unknown` verdict is untouched; only its on-screen
  display is dropped.

- **Both platforms.** Mac and Windows both run the same `server.js` serving the single shared
  `web/index.html`, and the engine is shared. There is no separate Windows renderer of these
  strings (verified by full-tree grep). So the engine + web change covers PC and Mac from one place.

## Kept deliberately (not in Josh's list)

- The other `stateConflict` messages: the sign-in rejection loop, and "reported stopping but still
  running". These are genuine actionable conflicts.
- The actionable hand-edited `stale` banner ("X needs to be restarted." + Restart button): a person
  edited the instructions and the agent needs a restart to apply them. Actionable, not hedging.
- The agent-state **badge** / member-row cell ("unknown" / "not yet read" / "We cannot tell whether
  it has this yet"). That is the separate card **#3501** (claimed by PigeonPete). Not touched here.

## Weakest premise

That "make sure none of this is on PC or Mac" and "ALL of these staleness warnings gone app-wide"
scope to the two banner/note messages Josh quoted, and NOT to the agent-state badge / member cell,
which #3501 owns. If Josh wants the member-cell "We cannot tell whether it has this yet" gone too,
#3501 (or a follow-up) covers it; deliberately left to avoid double-fixing a claimed card.

## Tests

- `engine/status.test.js`: the #1889 tests and the "reporter is broken, and says so" test updated to
  assert `conflict: null` (the accusation removed) while state stays working.
- `web.stale-banner.test.js` and `web.told-banner.test.js`: the `unknown`-arm assertions inverted to
  assert the banner is now hidden and the removed headline does not appear, while keeping the
  record-safety and exhaustiveness coverage (`stale`/`told`/`current` arms and member cell/badge
  unchanged).
- Standalone `node --test engine/*.test.js *.test.js`: 8269 pass, 0 fail, 148 skipped.
