# msg-color-3260 -- agent message bubbles: one fixed background color

Addresses #3260. From Josh in #chaoskosmos-design, 2026-09-18: *"we're still varying message colors and we determined we were only going to have one fixed color for the background message color for agent messages."*

## Intent

Remove the #2947 per-message color variation on agent message bubbles so every agent bubble renders one fixed color (`--agent-msg`, still per-theme).

## Change

- `web/index.html`:
  - Removed the four `[data-am]` color-mix CSS rules and the now-moot `body.plus-active ... [data-am]` flatten rule. Every agent bubble resolves to the flat `--agent-msg` base (`.msg:not(.you) .msg-bd` / `.dm.theirs .dm-b`).
  - Removed the `data-am` attribute emission and the `amShade` (DM `dmRow`) / `amSeed`/`amRoom` (room `pjRoomRow`) hash computations.
  - Updated the stale comments that described the variation.
- `docs/browser-checks/render-agent-msg-gray-2805.js` and `render-room-msgbox-2806.js`: rewrote the assertions that ENFORCED the variation to the new invariant -- the agent bubble carries NO `data-am`, and a `data-am` attribute no longer changes its color (probed by construction: `base === am1 === am3`). Kept the warm-cream / not-blue / not-gray / did-not-dissolve / tail-wing / bottom-aligned-avatar assertions.

## Verification

- Both browser-checks pass locally (pinned PW at `~/work/pw-runtime`, `HEADED=0`), light + dark: agent bubble = flat `rgb(249,247,241)` light / `rgb(34,31,26)` dark; `data-am` has no effect; tail wing + bottom-aligned avatar intact; no double-tint seam.
- These two checks (2805/2806) are the surface coverage for the agent-message bubble render; they were edited directly in this commit, which satisfies the coarse #1720 gate, so they need no trailer. The `Browser-check-surface:` trailer that shipped instead names `render-plus-blue-1615.js`: the #2518 surface gate maps the removed `body.plus-active ... [data-am]` line's `plus-active` token to that check, and the trailer records that the removed rule was dead (data-am no longer emitted) so 1615's Plus-tab-blue assertion is unaffected.

## Deliberate scope (NOT in this PR)

- **Bubble tail + avatar baseline** (Josh's other two message-screen complaints): already fixed in origin/main by #3247 (his approved Option A curved wing) + `.msg{align-items:flex-end}`. Josh's screenshot is a pre-#3247 build (he can't install 0.6.77 per #3254), so those reach him on the next working cut. Not re-doing his approved design.
- **Consolidated dialog background -> white like the tab view**: coupled to the tail `::after` mask (uses `var(--k-bg)`); needs the tab-vs-consolidated layout understood first. Follow-up.

## Tension noted (decided)

Memory `josh-warm-cream-over-flat-grey` records Josh liking subtle per-element variation on large surfaces. His specific, recent ruling here is that agent MESSAGES get one fixed color. The specific recent ruling wins for messages; reversible, he can undo.
