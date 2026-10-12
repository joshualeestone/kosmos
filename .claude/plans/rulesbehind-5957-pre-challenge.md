---
pre_challenge: true
method: challenge-loop
branch: rulesbehind-5957
diff_hash: 15109671ecf6afddcf296771cd21b5750eab3f39a6941c916c4606cc6105feec
validation: Mortals full validation CLEAN at 7ecef5f79 (2026-10-12T23:36:34Z; node 19624 tests, 19381 pass, 0 fail, 0 cancelled, 243 skipped; shell 230/230). Mortals hash c9acbc8c2f45 is the SAME diff at core.abbrev=9; locally git abbreviates at 10, giving this hash (measured: git -c core.abbrev=9 diff 1c9092737 HEAD | shasum hashes to c9acbc8c2f45, abbrev 10 to 15109671ecf6; see #6002).
subdir_audit: passed
timestamp: 2026-10-12T23:37:22Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 blind reviews.
**Converged:** Yes, at iteration 10: no new findings, so no commit follows iteration 9's fixes (only the browser-check surface trailers, which change no code).
**Hand-written:** this proof is written from the branch's own ledger, the commit messages "address challenge-loop iteration N findings". Which model ran each review is not recorded on the branch, so it is not stated here.

## Findings and dispositions, by iteration
### rulesbehind-5957 -- address challenge-loop iteration 1 findings
- The sentence is for CARDS only (card() and lrow() pass card: true; the agent's own page has the update note) and calm
  states only (idle, working, stopped): never in the slot a needs-you or question card is read by (#986/#2833).
- Test: unchanged polls read the instructions file once (the cache saves work, not only invalidates).
- Comments say the real cost and why entries are not pruned; taskLine's list of speaking states names #5957.

### rulesbehind-5957 -- address challenge-loop iteration 2 findings
- Test: status.snapshot() carries rulesBehind on a real fleet card (13 far behind, null recent).
- Plan: the Not now condition, the real per-poll cost, and the card-only calm-state rule.

### rulesbehind-5957 -- address challenge-loop iteration 3 findings
- Only idle or stopped cards say it: the update restarts the agent, so a working agent is not pointed at it mid-task.
- Test: the profile alone moving recomputes (13 behind becomes 6), then the file changing does.
- The cache key includes the file's path (CLAUDE.md or AGENTS.md by runner).

### rulesbehind-5957 -- plan: idle or stopped only

### rulesbehind-5957 -- address challenge-loop iteration 4 findings
- A STOPPED agent (the offline row server.js builds) and a paneless card carry rulesBehind too: the likeliest stale agent
  is one that is not running. Test through the real /api/status route (13 far behind, null recent).
- The cache key drops updatedAt (status() reads only the version and Not now from the profile), so an unrelated profile
  write keeps the answer. Test: a Not now said after an answer was kept takes the sentence away.

### rulesbehind-5957 -- plan: tests as built, with the mutants run

### rulesbehind-5957 -- address challenge-loop iteration 5 finding (the offline card and row draw it)
The offline row carried rulesBehind but card() and lrow() return early for a not-running agent with no task line, so the
likeliest stale agent still said nothing. One helper (rulesBehindLine) now says it: stateReason on a running card, the
offline card's atask line (only when there is something to say) and the offline list row's ltask cell. Test through
the real renderers with the route's own offline row.

### rulesbehind-5957 -- the offline card's line uses the note class (as the needs-trust offline card), so #855's card order holds; the #5314 test lifts the new helper

### rulesbehind-5957 -- address challenge-loop iteration 6 findings
- The offline card's line is the small muted ameta style, not the padded note box, so the card's look is unchanged.
- Not on the could-not-check split (a process may be running; the update restarts it), card or list row; tested.
- panelessCard passes its own profile read. Plan: the real cache key, rooms not covered, two deferrals with reasons.

### rulesbehind-5957 -- address challenge-loop iteration 7 findings
- Two more tests lift card()/lrow() and threw on the new helper (trust-wait-card-3013, socket-split): they lift it now;
  every test that lifts a renderer was found by name and run, 650 pass.
- The offline card's note has its own small muted class (arules), not ameta, which is the bold role line.
- rulesBehind's comment says the number is the recorded gap and can overstate after a hand edit. Plan: phone list, offline.

### rulesbehind-5957 -- address challenge-loop iteration 8 finding: a running card and list row draw it, through the real renderers
Mutant: card: true dropped at both call sites turns both cases red (0 pass 2 fail).

### rulesbehind-5957 -- address challenge-loop iteration 9 findings
- The not-running card and row state the fact only: the page's update is refused for an agent not in the roster (a
  stopped Windows agent or a leftover), so they promise no action. A stopped Mac agent (panelessCard) keeps the full line.
- Test: panelessCard (a created agent with no pane) carries it, 13 and null.

### Iteration 10
No new findings. Converged.
