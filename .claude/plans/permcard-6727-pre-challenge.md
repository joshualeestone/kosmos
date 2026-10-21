---
method: challenge-loop
branch: permcard-6727
diff_hash: 2d04ea724017227dabcbe6cd8d4b14846ac47b8e1be2043fa66b3c7e5ea82562
timestamp: 2026-10-20T17:11:43Z
subdir_audit: passed
iterations: 5
converged: true
---

# Challenge-loop proof: permcard-6727 (kosmos#6727: a permission prompt is a short card in chat)

Five blind iterations (Sonnet, Opus, Sonnet, Opus, Sonnet) and a design review (Mona Lisa: approved, three notes, all
taken). Iteration 5 returned no BLOCKER or WARNING.

## Iteration 1
[WARNING] the card was attached without the buttons' conditions (now only where `pressable`; the page falls back while the composer is closed)
[WARNING] the setup guide's masked thread would get the screen unmasked (excluded through `pressable`; route test with the guide marker, mutant red)
[WARNING] the project room's panel still shows the screen (stated: not covered, it is a screen view with its own answer box)
[WARNING] no test of the buttonless or guide case (two route tests added)
[WARNING] the rm screen is synthetic (stated in the plan)
[NIT] the armed note in the wrong part (fixed); fetch titles unanchored (anchored)

## Iteration 2
[WARNING] an unruled box put the raw request in the headline (only measured shapes reach it)
[NIT] stale "Waiting for you" comments; the file text kept its line-number gutter (both fixed)

## Iteration 3
[WARNING] the visible description is the agent's own words about its command (marked "It says:"; the command stays under Show details as the card asks; weakest premise stated)

## Iteration 4
[BLOCKER] an unruled Bash box made a card with nothing under Show details (only the ruled shape is a card now; mutant red)
[WARNING] a wrapped tip line reached the visible line (an ambiguous head stays under Show details; mutant red)

## Design review (Mona Lisa)
- no repeated name ("Wants to run a command."); Allow and Deny at equal weight; "Allowed." / "Denied." after a press, with shots

## Iteration 5
No new issues at WARNING or above.
[NIT] a card with only one of Allow and Deny (now no card); an unsure press leaves a blank note (left: the existing behaviour for every choice)

## Evidence
- engine/chat.permcard-6727.test.js 7 pass; server.permcard-6727.test.js 4 pass; web.approval-pill-6091 and the
  dealarm check pass with "Needs permission"; render-permcard-6727.js 52 pass (no-card mutant red on every card arm,
  control green). Shots: ~/work/design-shots/kosmos-6727/ (12, 0 overflow, 0 taps under 44 px).
