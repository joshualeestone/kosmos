---
pre_challenge: true
method: challenge-loop
branch: navgold-4051
diff_hash: 18ba525401e96013a50e3aae17eec006f38c78b340dc1d95e0f3ed31f41ea3bb
subdir_audit: passed
timestamp: 2026-09-26T23:24:55Z
converged: true
---

## Challenge loop: #4051 agent-page tile outline in bright gold

#### Iteration 1 (blind, opus)
- Confirmed: no other rule sets these tiles' border (no forced-theme, Windows, dark or consolidated override); --gold-bright is not redefined per theme, so it matches the Post button everywhere; the check can fail in both themes.
- [LOW] the older hover comment still said the edge was --gold-edge and cleared 3:1 --> FIXED (one accurate comment).
- [LOW] unused/misnamed fields in the new check arm --> FIXED (the ratio is named as edge vs page background).

#### Iteration 2 (blind, sonnet)
No issues found. NO NEW FINDINGS.

## Evidence
- render-agent-nav.js: selected and hover outlines equal the Post button's computed fill, light and dark; resting tile control not gold. Control: on the pre-fix page 4 FAIL (outline #8a6614 light, #d6a62e dark).
- Measured edge vs page background: 1.85:1 light, 9.99:1 dark (owner's call, noted in the rule and on the card).
- Full suite: 1 red (server.doorflight-1618) at load 70, green alone (4/4). #1720 passes; #2518 passes with a trailer for render-dm-chatfirst-718 (geometry only).
