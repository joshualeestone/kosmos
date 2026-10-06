---
pre_challenge: true
method: challenge-loop
branch: agycap2-4588
diff_hash: 9b9f4168040d47bb6301181eb79849828edc96d8cdeaf1d65514003c56f93d8e
validation: passed (Mortals full suite at 9b66e0654: 15947 tests, 0 fail, 232 skipped, the rebase-review test ran; FULL browser checks at 9b66e0654: EXIT 0, all page checks passed, one retry in render-room-scroll, unrelated)
subdir_audit: passed
timestamp: 2026-10-06T16:01:37Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (1 to 11 the original loop, alternating opus and sonnet, blind; 12 to 16 after the first full run;
17 a blind opus review of the 2026-10-06 rebase onto main; 18 a blind opus review of 17's fix)
**Converged:** Yes, at iteration 18 (no BLOCKER or WARNING). Iteration 17 found one WARNING, fixed in 9b66e0654; 18 reviewed that fix
**Total findings:** 5 BLOCKERs, 12+ WARNINGs, many NITs (each listed per review in .claude/plans/agycap2-4588.md)
**Fixed:** every BLOCKER and WARNING | **Deferred:** NITs and decisions, each recorded in the plan | **Asked (awaiting user):** 0

### Per-Iteration Breakdown
The full per-review record, with what changed and what was decided, is in .claude/plans/agycap2-4588.md
(sections "Review 1" to "Review 11", "After convergence" and "Rebased onto main 2026-10-06"). In brief:

#### Iterations 1 to 11 (opus and sonnet alternating, blind)
- [BLOCKER] a burst from one roster was not capped --> FIXED (reservation at the gate, CAP_STARTS)
- [BLOCKER] the Assigner's fan-out was not capped --> FIXED (givePart reserves after its cap check)
- [BLOCKER] a stale clock deleted fresh reservations --> FIXED (a reservation ahead of now stays active)
- [WARNING] resume sweep uncapped; held plain posts never retried; quota-vs-cap wording; refresh held a slot for good;
  a throwing delivery kept its slot; auto-retell, recommender fan-outs --> FIXED, each with a test that reds without it
- Iteration 11 converged (no BLOCKER, WARNING or CONVENTION)

#### Iterations 12 to 16 (after the first full run, 10-02)
- the #4273 leak gate: five temp dirs left by the new test --> FIXED with test-support/tmpscope (control: 5 vs 0)
- [WARNING] capOn read per member --> FIXED (once per pass)
- [BLOCKER-class WARNING] the capOn bypass woke idle Gemini agents --> FIXED (cap-held posts marked ^, only those retried)
- [WARNING] flushOnIdle put a cap-refused line back unmarked --> FIXED
- [WARNING] the community turn's pre-check asked the quota only --> FIXED (heldForAgy, pinned at >= 2 sites)
- Iteration 16: no code finding; CONVERGED

#### Iteration 17 (opus, blind): the rebase onto main e645859f9
- withoutStale conflict resolution with main's #4926 R2: checked correct (main's old condition reds an existing test)
- [WARNING] main's #5297 instruction reread sender spent a try of its pass on a line the cap held, so held Gemini
  agents could starve the rest --> FIXED 9b66e0654; the new test in engine/instructionreread.test.js reds without it
- [NIT] cosmetic, not taken

#### Iteration 18 (opus, blind): the 9b66e0654 fix; CONVERGED
- the fix is correct: a held verdict (cap or quota, same shape, nothing typed) gives its try back; the agent stays owed
  and is retried next pass; no unbounded sends (one visit per debt per pass)
- no other sender on the branch spends a per-pass try on a held line (communityturn, replynudge, assigner, agentnudge,
  agyquota, handoff pickup each checked)
- the new test reds with the fix removed (checked in a scratch copy) and passes with it; the file is 27/27
- [NIT] each held debt still costs a roster read and a refused deliver per pass --> ACCEPTED: cheap, spends no budget
- [NIT] a busy verdict still spends a try --> NOT TAKEN: true on main before this branch, outside the cap's scope

### Weakest premise
Sends an agent makes itself (task messages, a part one agent gives another) are not capped, by decision (review 3).
What would change it: lockouts in a team that works mostly by agent-to-agent task messages.
