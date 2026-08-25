# Plan: projects-grid-861

Josh, #chaoskosmos-design, 2026-08-25 10:37.

His words: "I think we could do a lot here to make this a bit more
engaging-looking... these need to be more like the agents grid, where
everything is centered and more stacked so these could be a bit more
boxy. We would then have: The title centered, Probably the status
underneath that, centered, Probably even the same kind of status
bubble if we want, like we do on the agents, The list, or maybe all of
the icons of the agents like we have, Underneath that, say the number
of agents: 5 agents or whatever."

## Changes

Reused the same dissolve-and-order technique #860 used for the list
row: `.pjcard-h` stops being a real box in grid view too, so `.pjname`
and `.pjpill` become independent flex children the card can order and
centre, rather than restructuring the shared markup `projectCard()`
draws for both views.

1. Title centered (`order: 1`).
2. Status pill given the same bubble recipe `.astate` draws on the
   agents grid (pill shape, border, background, centered) -- scoped
   separately rather than sharing the class, since `.astate` carries a
   six-state agent vocabulary that doesn't fit a project's two-state
   pill (`pjPillOf()` only ever returns `attn` or default).
3. Description (`.pc-t`) hidden in grid view. Not in Josh's four-item
   list, and no equivalent exists on `.acard` either -- stays visible,
   unchanged, in the list view (#860).
4. `.pjfaces` becomes a column: the avatar row, then the count as its
   own caption line beneath it, matching "the icons... underneath
   that, the number."

## Verification

- [x] `npm test` (full suite) -- 0 failures. New test added pinning
      the dissolve, the ordering, the bubble shape, the hidden
      description, and (separately) that the grid tile's untouched
      base `.pc-t` rule -- used by the list view and the detail page --
      wasn't disturbed by hiding it here.
- [x] Real live-server Playwright verification, two cases: the worst
      case (five agents, a long title, a long description that's now
      correctly absent from the card) and the plain case (one agent,
      no description). Both render boxy, centered, and stacked exactly
      as described, side by side in the grid with no overlap.
- [x] `bash tools/browser-checks.sh` (full suite, including
      `render-projects`'s description fixture, which the hide-in-grid
      change does not touch since it tests via `textContent`/computed
      style rather than visibility) -- see pre-challenge proof.
