# Plan: create-project-avatars-859

Josh, #chaoskosmos-design, 2026-08-25 10:34.

His words: "let's add in their avatars too and space those out just a
little bit taller (so we get a nice little avatar and it looks like
we're adding people to this project)."

## Changes

1. **`addAgentsHtml()` (the "New project" picked-agents list) now draws
   each row's face.** Reused `pjMember()`'s exact face markup rather
   than inventing new logic: the photograph when the agent has one
   (gated on `hasAvatar`, tied in the engine, same as everywhere else),
   otherwise tinted initials via the existing `discTint`/`discInk`/
   `initials` helpers. One identity mark across the card, the list, the
   room, and now this row too.
2. **`.pj-picked` row padding bumped** from `var(--space-3)` (6px) to
   `var(--space-4)` (8px) top/bottom, giving the 34px `.pj-face` room
   to breathe. `align-items: center` was already on the rule.

## Verification

- [x] `npm test` (full suite) -- one test broke as expected
      (`addAgentsHtml` now calls `discTint`/`discInk`/`initials`, which
      the lifted-function test didn't inject), fixed by adding them as
      stand-ins alongside the existing `esc`/`roleLine` ones, matching
      the file's own established minimal-fixture convention. 0 failures
      after the fix.
- [x] Real live-server Playwright verification (fixture built with
      `test-support/fleet.js`, never hand-typed): opened New project,
      added an agent, confirmed the row shows a tinted avatar circle,
      name, and role, with visibly more row height than before.
- [x] `bash tools/browser-checks.sh` (full suite) -- see pre-challenge
      proof.
