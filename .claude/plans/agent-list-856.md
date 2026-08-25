# Plan: agent-list-856

Josh, #chaoskosmos-design, 2026-08-25 10:23, on the agents list view.

His words: "agent name, agent title, its status, whatever text it
reported, its model, its percentage used" -- six named pieces of
information, in that order, in the running list row.

## Changes

1. **`.lrow` widened from five slots to seven** (avatar, name, title,
   status, reported text, model, percentage) so title and model each
   get their own top-level grid cell rather than being nested inside
   `.lname` as `<small>`/`<em>`. Grid items must be direct children of
   the grid container to share column tracks across sibling rows --
   nesting them meant they could never truly align, which is the root
   cause this rewrite fixes, not just a copy change.
2. **Both list-row templates kept in sync**: the off/not-running branch
   gets empty `.ltitle`/`.lmodel` cells (title still shows real content
   even when stopped, mirroring the grid card's `.ameta` precedent --
   only status/task/model/mem go empty on a stopped agent, per the
   existing "cells it cannot answer are empty" test).
3. **Consolidated rail** (`html[data-layout="consolidated"] .lrow`)
   given its own grid-row placement so name/title/status still stack
   in three compact rows in the narrow rail, matching the rail's
   existing pre-#856 intent (a title row was already implied by an old
   comment, never wired up) -- everything else in the row is hidden via
   `:not()`, unchanged in spirit from before, just extended to include
   `.ltitle`.
4. Removed the now-dead `.lname small`/`.lname em` CSS (role/model no
   longer nest inside the name cell) and updated two stale
   "five-slot"/"FIVE SLOTS, ALWAYS" comments to describe the new
   seven-slot shape.

## Verification

- [x] `node --test` / `npm test` (full suite) -- 0 failures, exit 0.
      Two tests added: the running row's six-column order (name, title,
      status, reported, model, percentage), scoped to the running
      branch only after the first draft's `indexOf` collided with the
      off-branch's own occurrences of the same class names; and the
      off-row's slot-existence/emptiness check extended from five to
      seven cells, catching that the first draft silently never
      checked `.ltitle`/`.lmodel` existed at all.
- [x] Real live-server visual verification (Playwright, a fixture
      built with `test-support/fleet.js`'s `agent()`/`line()`, never a
      hand-typed pane line -- fixture-discipline's rule for committed
      tests, applied here too since a hand-typed line is simply the
      wrong tool). Confirmed both:
      - Tab view list: seven columns render in the right order, no
        overlap, real role/model/percentage content shows correctly.
      - Consolidated rail: name/title/status stack in three rows with
        no overlap, task/model/percentage correctly hidden.
- [x] `bash tools/browser-checks.sh` (full suite) -- see pre-challenge
      proof for the run against this exact commit.
