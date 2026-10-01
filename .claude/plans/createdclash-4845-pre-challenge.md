---
pre_challenge: true
method: challenge-loop
branch: createdclash-4845
diff_hash: 70ec3fef91ac1fa29c50554b4aed0eb321819828b7a4b06a35dcd8dc01cdd9ff
validation: focused at this head on origin/main b6effce46: createdroster, server.remote-bind-1112, server.test.js, sendertoken, status and the #4796 guard, 646 pass, 0 fail; CI runs the full suite on the merge ref (Mortals is held for the 0.7.15 cut)
subdir_audit: passed
timestamp: 2026-10-01T05:50:59Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind rounds, 2026-10-01
**Converged:** Yes (round 2: no blocker, no should-fix; four mutants on copies all red)
**Findings:** 0 BLOCKER; 1 SHOULD-FIX (round 1, taken); nits taken. Details in `.claude/plans/createdclash-4845.md`.

### Measurement that set the fix
The board keys an agent's identity by its safeKey on purpose (status.js readIdentity), so the card's first idea
(re-keying paneless rows by a real name) was rejected; the fix prevents two agents sharing a key at issuance.

### Iteration 1: 0 BLOCKER, 1 SHOULD-FIX
- [SHOULD-FIX] engine/createdroster.js - a REMOVED agent keeps its plist and folder for Restore, and the created list skipped it, so a remote token could be issued under its key and Restore would merge them --> FIXED: an includeRemoved option, used only by createdKeys(); tests on both layers
- [NIT] the #4763 comment, the fail-open list, createdroster's docblock --> FIXED

### Iteration 2: 0 BLOCKER, 0 SHOULD-FIX (CONVERGED)
- Mutants red: the server check, the option forced off, the removed list read under the option, the board's removed skip bypassed
- The board's own list unchanged; a full delete frees the key
- [NIT] sendertoken.js comment; Windows in the fail-open list; the refusal says how to free the name; the test's restore note --> FIXED
