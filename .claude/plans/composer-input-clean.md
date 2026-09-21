# Project composer: remove the stroke, clean the input

Josh, #chaoskosmos-design 2026-09-21 ~4:09 PM CDT (screenshots: a broken tab-view input with a hard stroke and dead space, and a clean reference). Design/frontend lane (Mona Lisa). Repo joshualeestone/kosmos, web/index.html.

## Ask (Josh, verbatim intent)
- Remove the stroke around the input box on both the tab-view project composer and the consolidated-view project composer.
- The tab-view input looks broken (weird spaces above and below, a hard stroke). It should look clean and have room around it, like the reference.

## What the project composers are
- `#pj-post` (the room post box, "Write something or @name to message someone...") lives in `.pjmid .composer .composerbox`.
- `#pj-say` (the "Talk to one of them" agent box, "Type a message" / Send) lives in `.pj-say.composerbox`.
- Both are project composers. The agent-dialogue composers (`#d-say`, `#d-term`, class `.dmbar composerbox`) are a DIFFERENT surface Josh did not ask to change, and the base `.composerbox` border is guarded by web.focus-ring-1303d, so the removal must be scoped to the project composers only.

## Change
- CSS (web/index.html, after the base `.composerbox` rule): `.pjmid .composer .composerbox, .pj-say.composerbox { border: 0; }`. This drops the resting 1px `--k-rule` stroke on both project composers in both layouts and both themes. The filled `--k-surface` ground plus the 12px radius still marks the box as an input, so it reads as a clean filled field (matching the reference), which also resolves the "boxy / weird spaces" look the stroke created.
- Scoped deliberately: the agent-dialogue composer keeps its border (verified as a rendered control), and the base `.composerbox` rule is untouched so web.focus-ring-1303d still passes.

## Decision on the "weird spaces above and below" (reversible, documented)
The stroke was the visible cause of the boxy/broken look; removing it and letting the box read as a clean filled field matches Josh's reference (verified by rendering both tab and consolidated views in dark mode). I did NOT alter the sticky `.pjmid .composer` container padding (8px/4px), because it is tuned for the "composer always fully visible" sticky behavior (#761) and the stroke removal already achieves the clean look. Weakest premise: if Josh meant a specific extra padding bug rather than the stroke-induced boxiness, the container padding may need evening; reversible, and a quick follow-up if he says so live.

## Test
- New browser-check `render-composer-stroke.js`: renders a seeded project one-view, asserts `#pj-post` and `#pj-say` composerbox border-width is 0 in tab AND consolidated layouts, both themes; CONTROL asserts `#d-say` (agent dialogue) keeps its border, proving the scoping. Reds on origin/main. 16 assertions pass.
- Wired into the runner (tools/browser-checks.sh hermetic loop, #1387), README row added (parity), and the emit-site/catch counts bumped (+2/+2, structural clone of render-user-menu-3051).
- web.focus-ring-1303d still passes (base rule untouched).
- The #2518 surface gate scans the web/index.html diff AS TEXT, so the CSS comment must not name a surface id another check owns (an early draft named the agent-dialogue and post-box ids and the gate flagged the checks that own them). The comment was reworded to describe them in prose; after that the full suite (including both browser-check gates) is green.

Ships staged for the next build.
