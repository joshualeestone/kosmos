# swarm-copy-3946: Josh's swarm create-screen feedback and one swarm avatar everywhere (phase A)

Addresses #3946 (Josh, #admin, 2026-09-26 07:24, 07:28, 07:33, 07:43, verbatim on the card).

## In this PR (items 1-8, 11, 12, 15, and 13's Paused hint)
1. No "0/N" badge on the Swarm tile (swarmCluster gains `badge: false`).
2. Both tiles show the identity avatar as the name is typed: the generated mark (or chosen picture),
   read from the identity canvas so the three cannot disagree. No name: empty, like the ring (the
   Agent tile showed "S", from the fallback word "Swarm").
3. One circle per helper, up to 10 (was capped at 7), on the tile, cards and page.
4. Whole circles at every count: swarmLayout is rebuilt in radius units with a real gap (a ring's
   spacing from its chord) and scaled into the box, so no overlap is possible. The old table overlapped
   from 5 up. S3b measures 2..10: inside the box, no two circles overlapping.
5. The normal model picker for a swarm; every non-Claude provider greyed with "Swarms run on Claude
   for now" (not hidden). One gate (swarmProviderGate) that the menu's other painters call last, so
   their newer answer is restored when the form goes back to Agent. The request sends provider
   anthropic plus the chosen model and account.
6. "Most helpers at once" -> "Maximum helpers" (create form and the swarm page).
7. Josh's explainer; "up to N" follows the slider.
8. Josh's warning; N and N+1 follow the slider.
11. Josh's pause text.
12. The instructions line in swarm wording when Swarm is chosen.
13. Only the Paused hint ("finishes what it is doing, then takes nothing new"), beside Stop now's, and the
    page's "Maximum helpers". The panel MOVE is not here: built, it collapsed the phone's chat-first
    thread to zero (render-dm-chatfirst-718, whose header relies on the panel being there), and item 14
    (07:33, a Swarm Settings view) replaces that arrangement anyway, so the layout goes with 14.
15. One swarm avatar everywhere (Josh 07:43): swarmCircles is the ONE drawing (an SVG fragment) used by
    the grid card's face and, through swarmCluster, by the list, the org chart, the create tile, the
    swarm's page and project faces. No "0/N" badge anywhere. A round avatar box no longer clips the
    cluster (.lav / .onode .face hold it unclipped). The avatar-URL pin moves 23 -> 22 (two sites became
    one).

## Not in this PR, on purpose
- Items 9 and 10 (daily limit as % of weekly allowance): decided on the card; they ship together in
  phase B so the "weekly allowance" words never sit over a token slider.
- Item 14 (Josh 07:33: a Swarm Settings button and view with a three-state picker, Mona's design on
  the card) carries item 13's layout too; its own phase, with shots to Mona.

## Check
docs/browser-checks/render-swarm-ui-3564.js (gated): S2 (items 1, 5, 6, 12), S2b (item 2), S3 (3, 7,
8), S3b (4, geometry 2..10), S4 (provider, and the picker's model/account as an Agent sends them), S4c
(greying undone on Agent), S5/S15 (no badge, light and dark), S30 (the Paused hint), S31 (15: list and
org chart draw exactly what the grid draws, unclipped). Green through tools/browser-checks.sh, with
render-dm-chatfirst-718, render-dm-badges-2863 and render-fields; the new check fails on origin/main.

## Review round 1 (fixed)
- resetCreateProvider set the provider without the gate: it now calls it.
- S4 asserts the model/account travel as an Agent's.
- Duplicate check ids: mine are S30/S31.
- The tile mark is encoded once per canvas change (TILE_MARK), not per slider tick.
- The gate's forced move to Claude no longer counts as a person's pick (CREATE_PROVIDER_TOUCHED is kept),
  and going back to Agent restores the provider they had.

## Weakest premise
Item 2 reads the identity canvas with toDataURL on each repaint: fine for a 144px canvas, but a chosen
picture of a different origin would taint it (it is a local file, same origin, so it does not).
