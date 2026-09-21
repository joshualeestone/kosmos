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
- CSS (web/index.html, after the base `.composerbox` rule): `.pjmid .composer .composerbox, .pj-say.composerbox { border: 0; background: var(--k-sunk); }`. This drops the resting 1px `--k-rule` stroke on both project composers in both layouts and both themes, and replaces it with a recessed `--k-sunk` fill.
- WHY the fill, not just border:0 (caught in review): the base composerbox fill is `--k-surface`, which in the LIGHT theme is the same white as the composer bar behind it (`.pjmid .composer`), and for plus-active subscribers the bar's dark override does not apply either. So border:0 alone left the field with NO visible boundary in light/plus (verified by rendering: box bg == container bg == white). `--k-sunk` is a translucent overlay, so it ALWAYS reads as a subtle recessed field distinct from whatever bar is behind it, in light, dark and plus. No stroke, still clearly an input, room around it. Verified by rendering all three.
- Scoped deliberately: the agent-dialogue composer keeps its border (verified as a rendered control), and the base `.composerbox` rule is untouched so web.focus-ring-1303d still passes.

## Decision on the "weird spaces above and below" (reversible, documented)
The stroke was the visible cause of the boxy/broken look; replacing it with a recessed `--k-sunk` fill gives a clean filled field, verified by rendering tab AND consolidated views in light, dark and plus-active (an earlier border:0-only version was invisible in light, caught in review). I did NOT alter the sticky `.pjmid .composer` container padding (8px/4px), because it is tuned for the "composer always fully visible" sticky behavior (#761) and the fill change already achieves the clean look. Weakest premise: the dark recessed fill is subtler than the pre-change bordered box Josh saw in his dark reference; chosen for cross-theme robustness (one rule handles light/dark/plus). Reversible: if Josh wants it more prominent, dial the fill token up.

## Test
- New browser-check `render-composer-stroke.js`: renders a seeded project one-view, asserts `#pj-post` and `#pj-say` composerbox border-width is 0 AND that each keeps a visible boundary (a non-transparent fill DECLARED-distinct from the bar behind it, the #3369 lesson) across light, dark AND plus-active, in tab AND consolidated layouts; self-verifies the consolidated and plus-active states actually activated; CONTROL asserts `#d-say` (agent dialogue) keeps its border, proving the scoping. Reds on origin/main. 41 assertions pass. Known limit (accepted): the boundary check is a declared-value inequality, so it catches the exact regression (box fill == container fill) but not a hypothetical near-zero-alpha fill; the fill token is design-owned.
- Wired into the runner (tools/browser-checks.sh hermetic loop, #1387), README row added (parity), and the emit-site/catch counts bumped (+2/+2, structural clone of render-user-menu-3051).
- web.focus-ring-1303d still passes (base rule untouched).
- The #2518 surface gate scans the web/index.html diff AS TEXT, so the CSS comment must not name a surface id another check owns (an early draft named the agent-dialogue and post-box ids and the gate flagged the checks that own them). The comment was reworded to describe them in prose; after that the full suite (including both browser-check gates) is green.

Ships staged for the next build.
