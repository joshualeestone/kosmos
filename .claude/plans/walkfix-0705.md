# The 0.7.03 design walk: four small fixes for 0.7.05 (#4238 #4239 #4240 #4241)

## Finished looks like
Walked on the SERVED staging bytes (0.7.03, sha 3dba5aa2, app aad0d84cd): What's New, Gemini sign-in and row, Kosmos Plus
(vs Josh's 22:22 mock), Tasks tiles, rings, Token Usage. Four things looked off and are fixed here, each pinned by a check
that fails on main:
- #4238 What's New: an odd last tile spans both columns (no orphan cell with five highlights).
- #4239 Gemini row: with no email the line no longer repeats "Google subscription".
- #4240 Kosmos Plus: the empty status line and device message collapse while connected (gaps 36/39px -> 16/18px).
- #4241 Token Usage: "1 place ... that holds".

## Decided
- Plus: collapse, not hide: both are live regions, and display:none risks losing a later announcement.
- Gemini: with an email the tag keeps "Google subscription, through Antigravity" (it says which subscription).
- Not fixed, not mine: the Token Usage class cards (Cache reads etc.) wrap their titles to three lines; the tiles are
  Renet's #4083, so it is passed to her rather than edited under her.
- Dismissed after re-checking: the settings card's heavy outline (only with programmatic focus; a mouse click shows no
  ring), the board's "No project" 1 (correct: an unattributed needs-you), Token Usage empty (my screenshot came early).
- Weakest premise: the What's New full-width last tile reads as "the headline" by position; it is simply the fifth.
