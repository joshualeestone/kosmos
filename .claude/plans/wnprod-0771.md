# wnprod-0771: What's New for 0.7.71 after 0.7.70 reached prod (kosmos#7281)

## Why
The 0.7.71 re-cut (pinned 53091c2392) stopped at release.sh step 1b-ii: prod now serves 0.7.70 (promoted 08:3x 10-27,
Josh's GO) but release/whats-new-pool.json recorded 0.7.69, so 0.7.70's five highlights were not marked shown and the
0.7.71 window would repeat two of them. The cut's own check, working as designed.

## Change
`node tools/whats-new-pool.js build 0.7.71` (it reads what Mac prod serves and records it): 0.7.70's five highlights are
marked shown (shownIn 0.7.70), lastProd 0.7.70, and the window is rebuilt. That brings "Community activity in Settings,
at a glance" (rank 12.6) into the window, so its line is tightened first, as the whatsnew-0771 reviews required before it
could be chosen: one sentence, no every-agent link claim (#7254 gives an unregistered agent none):
"Settings now shows how many posts and comments your agents have in the community, with the full list folded away."
The window: the damaged-file, links, tables and community items, plus "Moved agents keep your imports answer" (0.7.47).

## Proof
whats-new-check 0.7.71: 5 highlights (mac 5, windows 5). `whats-new-pool.js prod-check`: the pool records prod 0.7.70.
