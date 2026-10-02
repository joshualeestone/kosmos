---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0717
diff_hash: 77baed48ffd80b0418a9672fce324dc52d4ebe1457264cf2548a0ee9bde1e999
subdir_audit: passed
timestamp: 2026-10-02T05:26:05Z
converged: true
---

## Challenge loop: 5 blind rounds, Opus and Sonnet alternating; round 5 found only NITs

Each round verified every highlight against the merged code on origin/main and against the 0.7.16 cut (0c6290975).
Ledger in `.claude/plans/whatsnew-0717.md`.

## [BLOCKER] Round 1 (opus)
FIXED B: line 3 told the person to @-name to reach a teammate, but their own posts are never held; 
rewritten as an agents' change with "Your own posts still reach everyone". FIXED W: line 2's "the task list says 
who added it" was already true in the Tasks tab at 0.7.16 (only the CLI changed); rewritten as what changed. FIXED W: 
the community rename (#4902) is now in line 4. NITs taken: "tinted" not "lights up", "a click on the row", "within 
seconds".

## [WARNING] Round 2 (sonnet)
FIXED W: line 4 hedged as the app's own Settings hint is (a post the safety check holds waits for 
the person): "A post or comment that passes the safety check goes out within seconds". DECIDED W (keep-or-cut, left 
to the release lead's writer): line 3 stays: it is the change in rooms a person can notice (an idle agent no longer 
answering an un-addressed agent post) and it says their own posts still reach everyone; it is the first line to give 
way if #4972 lands. NIT taken: title "Agents give tasks by name". LEFT NIT: the row click is hover devices only (the 
desktop app is one).

## [WARNING] Round 3 (opus)
FIXED W: line 4 said "within seconds" flat; past the daily cap, after a failed send, or while a 
registration is retried it goes on the regular pass: now "usually ... within seconds, not minutes", and it names 
whose posts (your agents'). FIXED W: line 4 names the new address, community.kosmosplus.com. NIT taken: line 2 says 
what an agent can newly do, including handing over a task it has (#4925). LEFT NITs: line 3's "may" stays (the hold 
needs the member's own hook to have written its idle, so "no longer wakes" would overclaim); #4905 portraits stay out 
(whether the served catalogue draws them is not measured; a line about a screen that may look unchanged is worse 
than none).

## [WARNING] Round 4 (sonnet)
FIXED W: line 2's "or hand over a task it already has" came from #4925, which the agents' own 
instructions never teach, so it may never be used; dropped, and the line says what changed (a named teammate instead 
of the Assigner's pick). LEFT NIT: line 4 depends on community.kosmosplus.com serving (it answers 200 now).

## [WARNING] Round 5 (opus)
NITs only. CONVERGED. It confirmed line 2 against 0.7.16 (neither CLI could send who, so an agent's 
task had no owner and the Assigner hands out exactly those). LEFT NITs: the Assigner can be switched off (then such a 
task waited for the person); line 3 understates (a post naming one teammate also leaves the others resting); line 4's 
"usually" covers the switch, the safety check and the caps.

## Checks
engine/whatsnew.js problems() is empty for version 0.7.17; engine/whatsnew.test.js 7 of 7; no em dash in any spelling.
