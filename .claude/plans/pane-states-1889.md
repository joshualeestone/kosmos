# Plan: pin live 2.1.263 captures for three pane-scraper reader states (kosmos#1889)

## Context
Card #1889 (filed from #1884, at Splinter's ask) asks to sweep `engine/status.js`'s
pane-state readers against a LIVE Claude Code capture, not a static grep. #1884 proved a
version bump can silently retire a reader (auth: JSON envelope -> friendly line, classify()
fell through to idle over a blocked agent, no red). Mikey's `panefixtures-1889` plan noted me
by name on THREE states his pass did not capture live; they are mine as their own fixtures on
origin/main: the permission prompt, the trust/folder-safety dialog, and the usage/rate-limit
line. (The other two card checklist items, the working line and auth, are pinned elsewhere.)

## Approach
For each state, drive a real Claude Code pane into it and capture VERBATIM with the reader's
OWN command, `tmux capture-pane -p -J` (no `-e`) -- the exact byte stream status.js:1330
consumes. Then assert the real reader path (`classify`, `trustPrompt`) classifies it, plus
pin the specific matchers the card says only a render can settle, against the captured bytes.

- Isolated throwaway tmux session per state, torn down after; never interrupt a working agent.
- Capture at wide (120) and narrow (46) widths; `-J` normalizes soft-wraps so the matchable
  rows are width-stable and one fixture per state suffices.
- Model the PRINTED line the reader receives, not the string the terminal drew.

## Decisions
- **Version drift:** card targets 2.1.258; installed is 2.1.263. Capture against what is
  installed and say so. Static-sweep the 2.1.263 binary for every reader key string (all
  present -> none silently retired in the drift).
- **Trust dialog:** reproduce by launching claude in a never-trusted folder (dialog at
  startup, no tokens spent). classify() -> needs_you, plus a direct trustPrompt() assertion
  under blank pane padding to exercise the #1155 trailing-strip.
- **Permission prompt:** the machine's global settings allow `Bash(*)`, so nothing prompts;
  force a prompt with a throwaway `--settings` `ask` rule (ask overrides allow) in default
  ("manual") mode. Pin the composed `❯ 1. Yes` row against OPTION_LINE and the
  `/❯\s*1\.\s*Yes/` marker individually (classify() alone is carried by the proceed phrase, so
  a retired option-row matcher would ship green).
- **Usage limit:** NOT reproducible on demand (the account cannot be forced to its limit), so
  no live pane capture. Pin from the vendor's own strings extracted verbatim from the 2.1.263
  binary; assert EACH RATE_LIMIT_MARKER individually so a retired phrasing cannot false-pass on
  the survivor. Replace with a real capture if one becomes available (card's own instruction).
- **Environment:** the pre-PR validation gate collided with release 0.6.47's machine claim
  (box reserved until ~16:08 CDT). Did not override with KOSMOS_IGNORE_MACHINE_CLAIM (a release
  touches delivery); waited for the box to free, then validated.

## What I deliberately did not do
- Did NOT touch Mikey's `panefixtures-1889` branch. Built on origin/main.
- Did NOT fabricate the rate-limit live capture; documented it as binary-extracted.
- Did NOT change `engine/status.js`; all three readers are correct against live 2.1.263, so
  this is a regression-pin, not a fix.

## Deliverable
`engine/status.pane-states-1889.test.js` -- 7 tests, drives the real reader path, every
assertion perturbation-verified load-bearing, with a negative control.

## Scope note
This is one of three #1889 states carded to me; Mikey's panefixtures-1889 and Ice Cream Kitty's
#2414 (location reach) also feed #1889, so the PR references it non-closing (Addresses #1889).
