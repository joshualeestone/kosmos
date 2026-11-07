# whatsnew-0796: What's New for 0.7.96

Pool PR before the 0.7.96 staging cut (release.sh step 1b-ii checks it). Branch from origin/main 2d09239de3.

## Prod check
`node tools/whats-new-pool.js prod-check`: the pool records prod 0.7.94 and Mac prod serves 0.7.94. So lastProd stays
0.7.94 and nothing is marked shown. If Josh promotes 0.7.95 before the cut, this is rebuilt against lastProd 0.7.95.

Windows prod serves 0.7.94 (latest-win.json read 11-07 ~03:00). The only pending Windows-only item, "Kosmos says when
others can change its folder", is since 0.7.95, so the 0.7.94 window cannot have shown it: no hand retirement.

## New items (since 0.7.96)
Read from the first-parent commits 74773b2338 (the 0.7.95 bump)..2d09239de3. Josh-asked cards ranked first.

| rank | title | from | platforms |
|---|---|---|---|
| 6 | Spreadsheets open in the file viewer | #8122 (parser f0b9f2b96f, viewer #8174), wired via pvSheetLoad | all |
| 8 | Always Allow for downloads from your computers | #8121 (b923d98e03, native-app/main.swift) | mac |
| 17 | A little more space in project rooms | #8160 (Josh picked 1.6) | all |
| 17.5 | Shared tasks say who has finished | #8137 | all |
| 18 | Agents that answer you elsewhere say so | #8141 | all |
| 19 | Old sign-ins say since when they are unconfirmed | #8159 (Grok), #8173 (Muse) | all |

Left out on purpose: iPhone-only changes (ff0d16da29, #8146): the iPhone app is not in this cut. Fixes with no
visible change a person would name (#8112, #8165, #7420, #8036, #8140's chip gap), and #4926 (visible, an agent
listing fix, but low value beside the six), and release machinery
(#8167, #8172). #8140's other pieces since 0.7.95 (04f6f8b63e, the hold lines offer closing a hold no longer needed;
3dc7a74dd6, the nudge names held subtasks) are agent-facing nudge wording, so they are left out too.

## Build
`node tools/whats-new-pool.js build 0.7.96`, output committed unedited. The window: Spreadsheets, The KOSMOS orb,
Always Allow (mac), Kosmos says when others can change its folder (windows), Gemini agents stop updating gemini (mac).
Mac sees 4, Windows 3, Linux 2 (countsByPlatform: mac 4, windows 3).

Commit carries the #1720 Browser-check trailer (data only).

## Review round 1
- Always Allow was never in a release (#8130 landed after 0.7.94 and was reverted before the 0.7.95 cut), so the item
  now says it can be set, not that it "now lasts". Title and line rewritten; the line had to fit 140 characters.
- "the iPhone" removed from the shared-tasks line: its iPhone half is Swift and ships with the iPhone app, not this cut.
- Line spacing 1.55 to 1.6 is a small change: ranked 17 (below the 16.x items) and worded as a small one. Josh asking
  for the change is a reason to make it, not to give it a window slot.
- The quoted app words in the answers-elsewhere line are in quotes.

## Review round 2
- Grok's date is when its key ran out, not when it last worked (Muse's is when it was last seen working), so the
  title and line now say "not renewed or seen working" and "since when they are unconfirmed".
- The line-spacing line drops the number for plain words.
