# dmbox-ground-3414 — dialogue-area ground pure white/black (Josh #3414-followup)

## Ask (Josh, #chaoskosmos-design 2026-09-23)
"the dialogue background colors are missing.. should be ffffff on the light and 000000 on the
dark ... only on the dialogue area, not the whole screen.. like the mock had".

## Cause
My #3414 set `#d-talk-box { background: var(--k-bg) }`. --k-bg is the theme off-white/near-black
(#faf9f7 light / #0c0d0f dark), which reads as "no colour" against the surrounding --k-surface.

## Change (web/index.html, scoped to #d-talk-box only)
- Base: `#d-talk-box { background: var(--k-surface) }` (= #ffffff on light; navy/plus keep their
  own --k-surface, mirroring the room's thread ground). The prior --k-bg is replaced.
- Dark: a non-light override (auto `@media (prefers-color-scheme: dark)` + explicit
  `[data-theme="dark"]`, `body:not(.plus-active)`, mirroring the room's #000 grounds) sets
  `#d-talk-box` to #000000.
- The bubble-tail ground-mask `#d-dmthread .msg-bd::after` moves with the box ground (var(--k-surface)
  base + the same #000 dark override) so no tail seam shows against the new ground.

## Decisions
- var(--k-surface) base rather than a hardcoded #ffffff: it is #ffffff on light (Josh's value) and
  keeps navy/plus consistent with the room, which uses this exact pattern. Dark cannot use
  --k-surface (that token is #17191c on dark), so a #000 override is needed regardless.
- Mirrors the room's `body:not(.plus-active)` exclusion so the Kosmos+ overlay keeps its own look.

## Verification
render-agentdm-3414.js updated: the box arm now asserts pure white on light / pure black on dark
(was: equals --k-bg). Confirmed rgb(255,255,255) light / rgb(0,0,0) dark. render-talk +
render-composer-stroke green.
