# launchpath-5516: the token-only guard denies writes to every folder on the agent's PATH (kosmos#5516, part 1)

Stacked on boardkeychain-4491 (#5122); rebased onto main once that merges. Detailed route notes are private (Angel's
notes); this plan stays at the level of the class: a write path outside the guard's deny list.

## Finished looks like
A token-only Claude agent's own file tools and shell cannot write into any folder on the PATH its pane starts with
(Claude Code starts programs from there outside the sandbox). If a PATH entry cannot be denied (empty, relative, or
inside the agent's own folder), the guard reports itself not whole, as it does for its other gaps.

## Built
- engine/setup-assistant.js: launchPathDirs(agentDir, deps): the pane PATH (deps.panePath, else
  KOSMOS_GUARD_PANE_PATH from the supervisor), this process's PATH, and the plist's fixed Homebrew and /usr/local
  folders; real paths, de-duplicated; unsafe entries returned. tokenOnlySettingsRules adds an Edit deny per folder;
  guardTokenOnlyFolder adds each to sandbox denyWrite and returns not-ok on any unsafe entry.
- bin/agent-supervisor.sh: the launch-time guard refresh is given the tmux server's PATH, which the pane takes.
- engine/launchpath-5516.test.js.

## Measured (2026-10-08, Claude Code 2.1.295, throwaway agent, a stand-in folder)
With permissions skipped, the Write tool wrote outside the agent folder without a rule and was refused with an Edit
deny; the sandboxed shell was already refused outside its writable set.

## Decided
- Computed at guard time (board start, and at each launch from the supervisor with the pane's exact PATH), not from a
  fixed list: the pane's PATH is the tmux server's, which is not known when the plist is written. Weakest premise: a
  tmux server restarted between the refresh and the pane start with a different PATH; the refresh runs immediately
  before the pane is made, so the window is that gap.
- An undeniable entry makes the guard not whole rather than being skipped (the launch still goes on, as for the
  guard's other gaps, and the board log names it).

## Review log
- **Round 1 (opus, blind):** 2 BLOCKER, 4 WARNING, 2 CONVENTION, 1 NIT (class-level here; route detail is private).
  - BLOCKER (fixed): coverage missed folders that programs on PATH resolve into; those are covered now (scan capped,
    a reached cap is reported). Tested with a linked program, with a control.
  - BLOCKER (fixed): an odd PATH entry made the guard write nothing at all. The guard now always writes in full and
    reports "not whole" for what it could not cover; the supervisor also hands the pane a cleaned PATH (absolute
    entries only, never globbed) and gives the guard the same one. Tested: the token deny is present in that case.
  - WARNING (fixed): the supervisor change had no test; a script assertion now covers the cleaned PATH reaching both.
  - WARNING (open, to measure on a throwaway agent before deciding): one more PATH source, how Claude Code finds the
    programs it starts, and two path-matching cases. Recorded privately; each ends as a fix or a named residual.
  - CONVENTION (fixed): public comments cut to class level. CONVENTION (decided): denied folders accumulate (deny lists
    merge); a folder once on PATH stays denied, which only narrows what the agent may write.
  - NIT (kept): the dropped-rule message names "the agent, its home or Kosmos"; a PATH folder with a pattern
    character also lands there.
