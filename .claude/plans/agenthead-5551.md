# agenthead-5551: the agent page header in the V2 new look (#5551)

**Finished means:** with the new look on, an agent's conversation header reads (round Back) <place> / Direct Message to <agent>, as Josh's 2026-10-09 drawing has it, and on a phone the round Back and <place>; Back always names where it goes, in both looks; with the look off nothing else changes.

## Steps
- [x] Markup in .d-talk-caprow: #d-crumb-back (round, 40px; 44px on a phone) and #d-crumb-root lead (mouse target only, tabindex -1, aria-hidden).
- [x] CSS under `:root[data-look="new"] body:not(.consolidated)` only; #detail-back hidden while Talk is open; phone and short-landscape rules.
- [x] detailBackPaint(): "← <project>" when opened from a project (#2574 went there but said "All agents"), else "← All agents"; repaints when PROJECTS reloads.
- [x] web.agent-head-5551.test.js (5) and render-newlook-4470 agentHeadLook arms (On + Off control).
- [x] Blind review: 0 blockers, 2 warnings + 2 nits fixed.
- [x] render-newlook-4470: 322/322 on c724abbc07 (14:03 CDT).
- [ ] PR, CI green, merge.

## Decided
- The label fix ships in BOTH looks (the old label sent people somewhere it did not say); everything visual is behind the new-look switch.
- Home and Settings drawings not built: Home has no drawing of Josh's; Settings A/B is his brand call (#5097).

## Surface gate (#2518)
- 13 checks share tokens with this diff. Read each: none asserts what changes in the default look (the new row is display:none there; #detail-back text changes only for an agent opened from a project, and these open from the board). Per-check trailers record it; GitHub CI runs the whole browser-checks suite on the PR.
