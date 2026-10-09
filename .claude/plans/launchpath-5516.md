# launchpath-5516: the token-only guard also protects the folders on the agent's launch PATH (kosmos#5516, part 1)

Stacked on boardkeychain-4491 (#5122); rebased onto main once that merges. Route detail and measurements are kept in
Angel's private notes; this plan stays at the level of the class.

## Finished looks like
A token-only Claude agent's own file tools and shell cannot write into the folders on the PATH it starts with, or
the folders the programs there live in. Anything that cannot be covered makes the guard say it is not whole, and the
rest of the guard is still written.

## Built
- engine/setup-assistant.js: launchPathDirs (the pane PATH from the supervisor, the board's own PATH, two fixed
  folders, and the folders the programs on them live in); an Edit deny and a sandbox denyWrite for each.
- bin/agent-supervisor.sh: abs_path_only cleans the pane PATH, and the pane and the guard are given the same one.
- engine/launchpath-5516.test.js.

## Decided
- Computed at each refresh (board start, and each launch with the pane's own PATH), not from a fixed list.
- Never a partial write: an uncoverable entry is reported, the rest of the guard is written.
- An ancestor of the agent folder is never denied (it would lock the agent out of its own work).
- Deny lists merge, so a folder once covered stays covered (only narrows what the agent may write).

## Review log
- Round 1 (opus): 2 BLOCKER, 4 WARNING, 2 CONVENTION, 1 NIT. Fixed, or recorded privately for measurement.
- Round 2 (sonnet): 0 BLOCKER, 5 WARNING, 1 CONVENTION, 2 NIT. Fixed (ancestors, an empty cleaned PATH, the board
  PATH held loosely, a runnable test of the cleaning, public text cut back, one scan per refresh pass).
- Round 3 (opus; a fresh review by Renet Tilley, who took the card over, since round 3's own findings were not recorded):
  - FIXED (BLOCKER): a launch folder with a rule-pattern character no longer stops the whole guard from being written.
    Its file-tool rule is left out and the folder reported (the guard says it is not whole), and the shell layer keeps
    its concrete path. Test with a control; the mutation makes it fail.
  - FIXED: PATH entries that do not exist yet resolve through a symlinked parent (realOrLeaf). Test with a control;
    the mutation makes it fail.
  - FIXED: the comments claim only what is covered.
  - FIXED (W3b): programs the supervisor starts by absolute path from folders not on the pane PATH. Measured: the guard
    did not deny the install's own folders. It now covers this install's engine and bin folders and node's folder (the
    guard runs from the same install). Claude's and tmux's folders are on the pane PATH. Test; the mutation makes it fail.
  - DECIDED, a residual: the code a covered program loads from beside its own folder (a package's lib, a keg's
    dylibs, a script's own tree).
    - Rejected: widening every covered `bin` to its parent. That would deny shared trees such as ~/.local or /usr/local
      as a whole, and could break ordinary tools writing their own state there.
    - Rejected: a package-root rule per layout (npm, Homebrew, Python). It is a list of layouts that drifts.
    - Weakest premise: that this part of the guard closes the "place a new program the agent's next start runs" class
      while leaving the "change a library a program loads" class to a later part. It should be named on the card
      (class-only).

- Round 4 (sonnet): 0 BLOCKER, 4 WARNING, 4 NIT.
  - FIXED (W4a): a PATH entry that is the agent's own folder or inside it (as written, not made yet, or through a link)
    is now removed from the pane PATH by the supervisor, so "cannot cover" no longer means "writable and on the PATH".
    Tests with controls (a same-prefix sibling stays; no folder given removes nothing). Each of the two checks has a
    mutation that makes the test fail.
  - DECIDED, residuals of the same class as round 3's (recorded, not fixed here):
    - folders a shell's startup adds to PATH after the pane starts (rc files, version-manager shims, activation hooks):
      the guard covers the PATH the pane starts with, as its comments say;
    - an interpreter named on a covered script's first line, and programs a covered script calls by absolute path,
      when those folders are not on the PATH.
    Rejected: following every script's interpreter line and callees. It is a parser for every script language, and it
    still could not see paths built at run time. Weakest premise: as round 3.
  - FIXED (W4d): the scan-cap note says the unchecked entries are unknown, not "the first N".
  - FIXED (nit): the per-pass cache key includes the own-program folders.
  - NOT CHANGED (nits): case-insensitive volumes (fails toward over-denying, not a leak); the pane PATH is cleaned for
    every token-only agent (harmless; other runners return "unsupported"); the wiring checks read the source text
    (abs_path_only itself is executed).
