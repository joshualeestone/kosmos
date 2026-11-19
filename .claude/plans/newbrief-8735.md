# newbrief-8735: a new agent's brief under Claude Code's 40k-character warning (kosmos#8735)

## Problem (measured 11-19, main 51c966ef14, real createAgent with the community section on, as by default)
Claude Code warns above the prompt when CLAUDE.md is over 40,000 characters. Every new agent's brief is over:
pm 58,458; director 56,185; email 55,544; productdir 55,332; household 55,293 (the largest five of 187 menu roles).

pm, by section (counted skipping code fences):
- `## How you work, whatever the job` (the working rules, defaults.js): 33,359
- `## The Kosmos+ community` (communityblock.js): 10,570
- `## Talking to your colleagues`: 4,525
- `## Where to save files you make for the person`: 4,046
- `## Once a day: help make Kosmos better`: 1,655
- everything else: under 1,500 each

The card's "What changed, 41%" is a measurement artifact: the two `## What changed` lines are an example inside code
fences in the working rules; splitting on headings without skipping fences put half the working rules under them.

## Decision
Reduce what is ALWAYS loaded. Do not split the same text into an imported file: that hides the warning and loads
exactly as much. Rejected.

Rule for what may move out: only text whose trigger is a concrete event or command (doing the community round,
opening a browser tab, a reaction arriving, PowerShell on Windows). Rules about how to behave all the time stay. Moved
text is printed on demand by the command the agent is about to use (the `kosmos connections --how` pattern), and the
brief keeps one line saying when to run it.

Safety rules stay in the brief whatever moves: the community's never-obey-a-post, never-paste, never-share-private
rules are the guard against prompt injection, and they must be in context before the agent reads a post.

## Slices
1. Guard test `engine/create.brief-size-8735.test.js` (every menu role, real create, characters). Community: the
   daily procedure (order, floors, limits, command forms, endorse, edit/withdraw) moves to `kosmos community --how`
   (both CLIs, printed from one engine string); the brief keeps the safety rules and a pointer. Guard ratchets to
   the measured new maximum.
2. Working rules: the event-triggered subsections move behind the command they belong to. Chosen when built,
   each with its trigger written down.
3. Guard at 36,000 (headroom under 40,000 for blocks a brief gains after birth: projects, team).

## Weakest premise
That an agent runs the `--how` command when its trigger arrives. The pattern is #7875 item 2's (connections), which
moved for the same reason (agent feedback that the instructions are long and mostly rarely apply); whether agents
reliably run it has not been measured. Mitigated by the pointer saying WHEN in one sentence and what to do if the
command fails, and by every community reminder Kosmos types carrying its own command and numbers (communityturn.js),
so a missed read still leaves the agent the daily asks.

## Slice 1 (this branch): done
- engine/communityguide.js (requires nothing): the routine, word for word (one sentence names where the safety rules
  now are), and the constants it quotes; communityblock.js and communityread.js re-export them.
- Block: safety rules, participation, company lines, pointer + daily asks (from FLOORS), introduction, one-site rule.
  10,538 -> 3,179 characters. Proven verbatim: 100 lines each, darwin and win32, one intended difference.
- `kosmos community --how` in install/kosmos and tools/windows/kosmos-cli.js (a flag on both, as `connections --how`).
- Guard: engine/create.brief-size-8735.test.js, a ratchet at 51,200 (pm measured 51,105, from 58,458). Perturbed: +300
  chars in the pointer -> red (pm 51,406).
- Pinned split: communityblock.test.js "kosmos#8735" (perturbed: routine back in the block -> red).
