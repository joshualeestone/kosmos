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
- Round 5 (opus): 2 BLOCKER, 5 WARNING, 4 NIT.
  - FIXED (both BLOCKERs): the folder the INSTALLED supervisor runs from (create.supervisorPath(), which also holds the
    engine pointer and the bridges) is now covered, and the test names that folder from create rather than repeating the
    code's own expression. A control checks the fixture can tell it from the source tree's bin. Mutation makes it fail.
  - FIXED: a PATH folder reached through a link is named both ways in the file-tool rules (the sandbox keeps the
    resolved one). Test with a control; mutation makes it fail.
  - FIXED: the supervisor's PATH cleaning and the guard now agree. Ancestors of the agent folder leave the pane PATH
    too, and a not-yet entry is resolved through its nearest existing parent. Each comparison has a mutation that fails.
  - FIXED: tests pin the fixed folders and the install's program folders, so they do not depend on the host.
  - FIXED (nits): the cleaned PATH goes only to claude panes (no second PATH key for other runners; a test checks the
    line); comments corrected; a test for the per-pass cache, which fails if a user changes the cached answer.
  - DECIDED: a guard that is not whole because of a launch folder still refuses creating a token-only agent. That is the
    card's rule (an agent that cannot be guarded whole is not created), and the reason names the folder.
    Weakest premise: an odd folder on the board's PATH blocks every token-only creation until it is renamed or removed.
  - DECIDED, a follow-up: deny lists merge and are never pruned, so versioned install folders (a package manager's
    per-version folders) accumulate after upgrades. Not a hole (it only over-denies stale paths), but the settings file
    grows. Pruning needs a record of which rules were launch rules that the agent itself cannot edit; a follow-up card.
  - NOT CHANGED: boardkeychain-4491.test.js does not pin the launch folders (it is the base branch's file; the real
    fixed list has no pattern characters).
- Round 6 (sonnet): 0 BLOCKER, 3 WARNING, 3 NIT.
  - FIXED: the supervisor also drops, from the pane PATH, an entry with a character the permission rules read as a
    pattern (its file-tool rule is left out, so only the shell layer would cover it) and an entry with a . or .. segment
    (resolved differently by the shell and the guard). A dotted name that is not a segment stays (control). Each part
    has a mutation that makes the test fail.
  - DECIDED, residuals added to the card's list (class-only): a folder whose PATH program links into a folder with a
    pattern character keeps only the shell layer (the guard says it is not whole, at launch and at create, where it
    refuses); and replacing an ANCESTOR of a covered folder is not stopped, since ancestors are deliberately not denied.
    "Covered" means the folder's contents, not that its path cannot change.
  - NOT CHANGED (nits): source-text wiring checks, case-insensitive volumes, the deny-list growth follow-up (all
    recorded above).
- Round 7 (opus): 1 BLOCKER, 7 WARNING, 1 CONVENTION, 4 NIT.
  - FIXED (BLOCKER): what every claude pane starts by absolute path through --mcp-config (the browser tool's tree:
    its script, its config and its browser) is covered, and so is the --settings file (a file rule in both layers).
  - FIXED: each hop of a program's link chain is covered, and a dangling link's folder too (whatever is later made
    there runs by that name). A PATH folder that cannot be listed is reported (a missing one is not). The agent-folder
    comparison ignores letter case on macOS and Windows, in the guard and in the supervisor's cleaning. The supervisor
    drops PATH folders not made yet (the guard is written again at the next start). A program that resolves into the
    agent folder now has a test. The two tests that read the host's folders are pinned. The new block sits above the
    #4491 doc comment again, and the header lists everything reported as uncoverable.
  - Each fix has a mutation that makes a test fail (10 mutations, all red).
  - NOT CHANGED (nits): an agent folder of `/` (not a real layout); `set +f` restored unconditionally (runs in a
    subshell); a source checkout without the report hook script (development only).
- Round 8 (sonnet): 0 BLOCKER, 4 WARNING, 3 NIT.
  - FIXED: the claude and tmux programs the supervisor starts by absolute path (from the plist) have their folders
    passed to the guard (KOSMOS_GUARD_RUN_DIRS) and covered, on the PATH or not; a link there is followed like any
    other. Test with a control; a mutation of either side fails.
  - FIXED: the PATH scan is cached once per refresh pass for ALL agents (it no longer includes the agent folder in its
    key); only the agent-folder check runs per agent, and it never writes into the shared scan. One realpath per
    folder, not per program. Tests (a second agent, and an agent with its own notes) fail under each mutation.
  - FIXED: a test checks that no later line gives a claude pane a second PATH key (the one later PATH line is limited
    to codex, gemini and grok).
  - FIXED (nits): the helper is named for what it does (_phys_dir), and the caller's noglob is put back as it was
    (tested both ways).
  - NOT CHANGED (nit): a PATH folder past the scan cap refuses token-only creation (decided in round 5).
- Round 9 (opus): 1 BLOCKER, 4 WARNING, 6 NIT.
  - FIXED (BLOCKER) and FIXED (W, middle links): every path the guard depends on is followed one name at a time. The
    folder holding a link ANYWHERE along it (not only at its end) is covered, and when that folder is inside the agent's
    own, the guard says it cannot cover it. That closes a PATH entry written through a link inside the agent folder, and
    the "opt"-style layout where a program's target passes through a folder link. The supervisor also drops an entry
    whose written path is inside the agent folder. Tests with controls; each part has a mutation that fails. A link held
    in an ANCESTOR of the agent folder (a system link such as /var in /) is the recorded ancestor residual: never denied.
  - FIXED: a launch input whose place cannot be worked out (the installed supervisor, the browser tool, the settings
    file) is said, so the guard is not whole, rather than silently left out. Test with a control.
  - FIXED (nit): a file named on PATH (ENOTDIR) is skipped like a missing folder, not reported. Test.
  - DECIDED, residual: a PROGRAM whose chain is uncoverable (it lands in or passes through the agent folder) stays on
    the pane PATH; the supervisor drops whole entries only. The guard says it is not whole at launch (logged) and at
    create (refused). Rejected for now: having the guard return the entries to drop, which reorders the launch.
  - DECIDED, a later part of #5516 (named in the header and here): programs named in Claude's own config files (MCP
    servers in .claude.json or .mcp.json, hooks named by settings, plugins, the status line). Only the settings files
    themselves are denied today.
  - NOT CHANGED (nits): tr versus toLowerCase on non-ASCII names (they can only disagree toward "not whole"); the
    supervisor's WORKDIR versus create's workerDir (both fail safe if they differ); the unpinned first test checks the
    real fixed list's rules only.
