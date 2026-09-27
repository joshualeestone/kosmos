---
pre_challenge: true
method: challenge-loop
branch: sideways-3969
diff_hash: 012aaf48b173ea31fb6d986143053153455949d85aa0587ff9b1984a005ee9bb
subdir_audit: passed
timestamp: 2026-09-27T01:00:39Z
converged: true
---

## Challenge loop: #3969 sideways phone chat (continued from Scorpion's WIP)

#### Iteration 1 (blind, opus)
- [HIGH] reason-grep count not updated --> FIXED (measured 178).
- [MEDIUM] hiding the whole search row left an active filter hidden --> FIXED: only an empty, unfocused box hides.
- [MEDIUM-LOW] a layout-shrinking keyboard could hide the box being typed in --> FIXED (same rule).
- [LOW-MED] the chat heading lost for screen readers --> FIXED (label stays visually hidden).
- [LOW] stale README rows; a third copy of the rule unpinned and a 896px off-by-one; a wrong height comment --> FIXED.
- [LOW] back link's return-to-project lost --> ACCEPTED and documented.

#### Iteration 2 (blind, sonnet)
- [HIGH] #2518 surface gate: four checks flagged --> each RUN on the branch: render-signin-visible-3892 was a real red (its untied fixture's note pushed the now-visible message box off); its sideways arm now uses a tied swarm agent; a 24% sideways floor was tried and reverted (not needed, measured). Trailers for the other three, which pass.
- [MEDIUM] back link and avatar hides not asserted --> FIXED.

#### Iteration 3 (blind, opus)
- [MEDIUM] search unreachable sideways, undocumented --> DOCUMENTED in the rule and both README rows (accepted).
- [LOW] swarm arm did not require the swarm panel or check page errors --> FIXED.
- [LOW] a fixture comment overclaimed --> FIXED.

#### Iteration 4 (blind, sonnet)
No issues found. NO NEW FINDINGS.

## Evidence
- render-dm-sideways-3969.js: ALL PASS (73). Main fails 26.
- Harness at 27939e158: render-talk-fill-2622, render-agentpage-fullwidth-2012, render-signin-visible-3892, render-agentdm-3414, render-dm-sideways-3969, render-dm-chatfirst-718: all page checks passed.
- Full suite at fb1388daa: exit 0, 10171 pass, 0 fail; #1720 and #2518 gates ran inside it.
