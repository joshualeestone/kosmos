# whatsnew-0827: What's New for 0.8.27

The gap alarm (kosmos#1050), 2026-11-26 20:25 CST: main 67 commits past staging 0.8.26.

## The change
- Adds Ice Cream Kitty's line for #9142 (PR #9151, shipped in 0.8.26 without one): "A repeating task lists its runs
  and misses", pending, rank 10.7, since 0.8.26, untagged. Her wording, with her lengths checked (title 42, line 137).
  It is on the board page and in `kosmos task activity`, on every platform.
- Builds the 0.8.27 window: `tools/whats-new-pool.js build 0.8.27` read prod 0.8.26 and marked its two highlights shown
  (#9093 and #9094). The window is the two pending lines, both untagged:
  - "Words you were typing are kept" (#9132; Mona Lisa's line from #9182). #9150 changed web/index.html, the board
    page every platform serves, so untagged is right, even though its PR title says "Mac app".
  - "A repeating task lists its runs and misses" (#9142).
- whats-new-check 0.8.27: mac 2, windows 2.

## Weakest premise
That #9142's runs view reads the same on Windows as on the Mac. It is the board page and the CLI, both shared, but no
Windows run of it is recorded on the card.
