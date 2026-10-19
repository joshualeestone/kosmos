---
pre_challenge: true
method: challenge-loop
branch: bulkmove-6173
diff_hash: abb766db4edbc11b249c99cf62beabf2908a667daa69fbce2426ac8c757710ea
validation: passed (full tools/run-tests.sh on e4daf1d7c after the rebase onto main 3db9fd64e: rc 0, node 20505 pass 0 fail 252 skipped, shell 236/236; earlier, before the leftover fix and rebase, on 596440e34: rc 0, node 20444 pass 0 fail, shell 236/236; browser check render-account-usage-6108 432 PASS 0 FAIL)
subdir_audit: passed
timestamp: 2026-10-15T06:51:19Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 blind reviews, alternating sonnet and opus (sonnet, opus, sonnet, opus, sonnet, opus, sonnet). Every round and decision is in .claude/plans/bulkmove-6173-20261014T2222Z.md. From round 5 on, Liu Kang's scope line (m5501) applied: only a BLOCKER or a FALSE CLAIM is fixed in this PR; everything else is carded (#6190, #6183).

**Round 1 (sonnet): 0 BLOCKER, 3 WARNING + 4 NIT**
- [WARNING] only the agent restarting right now was guarded, so a sync restart of a queued agent ran and the move restarted it again: fixed (the move holds every agent it will restart).
- [WARNING] the real execFile half of the async driver was untested: fixed (a real process: exit code, output, missing command, time limit).
- [WARNING] timing margins could flake on a loaded box: fixed (1.5 s retry wait, gap under 1 s).
- [NIT] a throwing sentence, an unbounded body: fixed. [NIT] two noted, no change.

**Liu Kang m5486 / m5488:** stopped-while-queued holds from the code (tested); remove mid-move was not provable, so remove is refused while held (tested).

**Round 2 (opus): 0 BLOCKER, 4 WARNING + 5 NIT**
- [WARNING] the real-exec test ran /bin/sh and would go red on Windows: fixed (node itself).
- [WARNING] the class-1 sweep counted refusals and escalated a dialog the move was about to clear: fixed (a held agent is left to the move).
- [WARNING] board restarts could cut a move between bootout and bootstrap: fixed (Kosmos switch, restart button, Update refused; automatic update waits; a move refused while one is on its way).
- [WARNING] no route test: source pins of the wiring added.
- [NIT] hold order, dedupe, tmux binary recorded, poll bound: fixed.

**Liu Kang m5496 / m5499:** bounds added and tested (per restart cap, per agent backstop, 60 min overall; holds released; an update installs after the cap).

**Round 3 (sonnet): 0 BLOCKER, 2 WARNING + 4 NIT**
- [WARNING] a Kosmos switch's pending restart did not stop a new move: fixed (flag until the process ends).
- [NIT] a throw after the cap skipped the abandon check; a throwing sentence or release on the error paths; an overclaiming comment: fixed.

**Round 4 (opus): 0 BLOCKER, 6 WARNING + 1 CONVENTION + 3 NIT**
- [WARNING] the hold dropped at the cap while a command was still in flight, and 180 s could cut a healthy restart: fixed (300 s; the hold lasts until the command ends; board restarts wait for it; the unload wait honours the abandon).
- [WARNING] a switch whose detached restart failed kept moves refused: fixed (90 s watchdog). [WARNING] provider and model wrote a held agent: fixed (refused before the write). [WARNING] rollback restarted the board mid-move: fixed. [WARNING] guard pins checked text, not order: fixed (order per route). [WARNING] abandonment untested in the unload wait: fixed.
- [CONVENTION] test messages said "0 seconds": fixed.

**Round 5 (sonnet): 0 BLOCKER**
- [FALSE CLAIM] "every command is bounded" did not hold for a process ignoring SIGTERM: fixed (SIGKILL at the limit, a last timer at limit plus 5 s; tested with a process ignoring SIGTERM).
- [FALSE CLAIM] a comment said 180 s: fixed.
- [WARNING] carded #6190 (account routes write before the hold check); #6183 comment (Windows/Linux poll can stop early).

**Round 6 (opus): 1 BLOCKER, 3 FALSE CLAIM**
- [BLOCKER] web.gemini-grok-ui-3566.test.js read the moved chat-word line from server.js: fixed (reads engine/accountmove.js).
- [FALSE CLAIM] a test name, an update.test.js comment, "off the board's thread", and a refusal sentence untrue after a move ended: fixed.
- [WARNING] four more carded on #6190.

**Round 7 (sonnet): CONVERGED.** 0 BLOCKER, 0 FALSE CLAIM. Two low-confidence notes taken anyway, inside the scope line, and UNREVIEWED by a round: a command killed at its limit gives no exit code on every platform (Windows reports 1), and the board-busy sentence's wording.

**After convergence:** a queued test set failed 5 move tests (the per-agent cap delayed the first restart by a tick): fixed in the code, 48/48. Rebased onto main (80 commits, no conflicts). The full suite then failed only fixture-discipline (the new page test hand-built roster rows): fixed with real fleet cards, 27/27. Browser check render-account-usage-6108 on the rebased head: 432 PASS, 0 FAIL.

**Weakest premise:** the async driver is proven against a scripted launchd and fake tmux, not a real launchd. The order of calls, the turning timer and the caps are measured; a real launchd's answers are reasoned.

## After the PR opened

**Independent review (Sub-Zero), item B: BLOCKER (Liu Kang m5550).** Deleting a leftover read no move hold, only a live session, so in a move's restart gap a held agent looked like a leftover and its folder could go to the Trash. Fixed: plan() and del() both refuse while the move holds the agent. Its test was RED before the fix (00:12, "the plan offered to delete an agent a move holds") and green after (delete-leftover, web.delete-leftover and remove 148/148). Item A (create's bootouts): safe.

**Rebased onto main after #6191 (#6174) merged.** Two server.js conflicts in the one-agent Move route, both sides kept; every #6191 addition present at the head. Gap closed: a bulk move now writes #6191's note too, with async session reads (Liu Kang m5607). The pin names the three synchronous calls it catches (m5626); Sub-Zero proved it red on each. Sub-Zero re-reviewed the resolved head: clean.

**Validation at e4daf1d7c:** full suite rc 0, node 20505 pass 0 fail, shell 236/236.
