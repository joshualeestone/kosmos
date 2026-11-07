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
| 8 | Always Allow holds for your own computers | #8121 (b923d98e03, native-app/main.swift) | mac |
| 15 | Roomier project room messages | #8160 (Josh picked 1.6) | all |
| 17.5 | Shared tasks say who has finished | #8137 | all |
| 18 | Agents that answer you elsewhere say so | #8141 | all |
| 19 | Old sign-ins say when they last worked | #8159 (Grok), #8173 (Muse) | all |

Left out on purpose: iPhone-only changes (ff0d16da29, #8146): the iPhone app is not in this cut. Fixes with no
visible change a person would name (#8112, #8165, #7420, #4926, #8036, #8140's chip gap), and release machinery
(#8167, #8172).

## Build
`node tools/whats-new-pool.js build 0.7.96`, output committed unedited. The window: Spreadsheets, The KOSMOS orb,
Always Allow (mac), Kosmos says when others can change its folder (windows), Roomier project room messages. Mac sees
4, Windows 3, Linux 3.

Commit carries the #1720 Browser-check trailer (data only).
