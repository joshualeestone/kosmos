# gaterange-3893

The #2518 surface gate (and the #1720 coarse gate) read the file list from base...HEAD and the trailers from
base..HEAD. When a PR is merged into base before its CI checks out, base and HEAD have two merge bases, ... picks
the PR head, and main's own trailer-excused change reads as the PR's while its trailer is never seen (#3893,
fed-msg-3311). Fix: one merge base anchors the diff, the file list and the trailers in both gates. Real-git
criss-cross fixtures in both gate tests, red on the old libs and green on the new, with positive controls.
