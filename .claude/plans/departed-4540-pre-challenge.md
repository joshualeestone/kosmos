---
pre_challenge: true
method: challenge-loop
branch: departed-4540
diff_hash: f905fc3b48b6a78ed189bfd76885bfb24e1f12e54a1c4e6841b8d156a96687d7
subdir_audit: passed
timestamp: 2026-09-29T16:37:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind review rounds, alternating models (1 sonnet, 2 opus, 3 sonnet, 4 opus, 5 sonnet, 6 opus).
**Converged:** Yes. Round 6 returned no BLOCKER, WARNING or CONVENTION.
Every fix in rounds 1 to 5 landed with its test first measured red against the unfixed code.

## Iteration 1 (sonnet): 2 WARNINGs, fixed in 465bd0060
- [WARNING] Control characters in a reason reached the summary. Fixed: stripped.
- [WARNING] No route-level test for a departed assignee or for a sender who is the only assignee. Added.

## Iteration 2 (opus): 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, NITs, fixed in 31ce6ae10
- [BLOCKER] "Not told:" lines printed chat.js reasons that do not name the agent. Fixed: every line names the agent.
- [WARNING] The route test matched only the departed clause. It now asserts the other assignee is named.
- [WARNING] Lone surrogates survived. Fixed. Round 5 found this fix went too far (below).
- [CONVENTION] The plan promised an Off-swarm test. Added.
- [NIT] A blank reason now falls back to the name, and duplicate names are said once.

## Iteration 3 (sonnet): 1 WARNING, fixed in 22907a8ff
- [WARNING] An unknown delivery state read as "not told". Now only a delivery the board knows failed is "not told". An unconfirmed or missing state reads "may have been told".

## Iteration 4 (opus): 1 WARNING, 1 CONVENTION, fixed in 725d85e27
- [WARNING] C1 controls and U+2028/U+2029 were not stripped. Now stripped.
- [CONVENTION] The plan's wording table did not match the code. Updated.

## Iteration 5 (sonnet): 2 WARNINGs, fixed in d1c5754fa
- [WARNING] The round-2 surrogate strip removed every emoji. Now `toWellFormed` replaces only broken halves.
- [WARNING] An agent listed twice could get two sentences that contradict each other. Now each agent gets one outcome, the worst.

## Iteration 6 (opus): converged
- [STRENGTH] The Mac CLI's sed extraction was run end to end under LC_ALL=C and en_US.UTF-8. The input had hostile reasons, emoji, accents and the real Off-swarm sentence, and the whole summary printed both times.
- [STRENGTH] Reverting the fix would fail every new test. The route test parses `summary`, the Windows tests assert the new sentence, and the Mac tests forbid "were notified".
- [NIT, not taken] Some reasons are multi-sentence and appear inside brackets. A reason naming a display name, not the session name, is double-named.
- [NIT, not taken] An unconfirmed outcome's reason is not shown.
- [NIT, not taken] `plain()` does not strip bidi overrides or zero-width characters. The reasons are board-made strings, so the risk is low.
- [NIT, not taken] The Off-swarm unit case uses a short sentence, not `SWARM_OFF_SENTENCE`.
- [NIT, taken in c3f0a5b85] The plan now states the worst-wins and empty-name rules.

## Disclosures
- Earlier full-validation attempts on this branch were stopped mid-run for edits, so they gave no verdict. The validation recorded below is the only one that counts.
- The card's original premise came from a reviewer and was false: the other task notifications already skip departed assignees. I rescoped the card after measuring this. What was actually false was the CLIs' sentence.

## Weakest premise
- That the Mac CLI's sed read stays safe. That depends on `summary` staying the last key in the compact JSON body. If a later change adds a key after it, the greedy match still lands on `summary`, as long as no later string contains `"summary":"`, which JSON escaping prevents.

## Validation
- Full suite, validation_log_run_or_skip at 2026-09-29T16:36:37Z: clean, 11944 tests, 11778 pass, 0 fail (hash 13366d1e11357b54, the same diff this proof names).
