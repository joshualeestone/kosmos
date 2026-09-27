---
pre_challenge: true
method: challenge-loop
branch: checkgreen-4139
diff_hash: 28785a596198c0212d47733af34ada862c3720812d17aeb8e50ce492141dc5b8
subdir_audit: passed
timestamp: 2026-09-27T09:05:57Z
converged: true
---

## Challenge loop: #4139 a green from a check says a check answered

#### Iteration 1 (blind, opus)
- [LOW] the visible pill still said "Signed in · active <age>" for a check green, the same claim in shorter form --> FIXED: "· checked <age>" when observedFrom is check; pinned in web.badge-observed-1921 (main has no fromCheck, so the pin fails there).
- [LOW] OpenAI rows still show the old sentence for a check green --> out of scope by design: Raiden's unmerged #4064 edits that overlay; the one-line contract is posted on #4064, and the card keeps it as the open part.
- Checked clean: agentObs and checkObs are always distinct objects (readDir returns a fresh object), so obs === checkObs is exact; every write to the check stores is a real check (Claude Check now runs a real request, so "so it is working" is honest); a non-working row's source is never shown.

#### Iteration 2 (blind, sonnet)
No issues found. NO NEW FINDINGS. (A tie at the same millisecond names the check; defensible.)

## Evidence
- server.badge-observed-1921: 16/16; server.livecheck-3997: 15/15; web.badge-observed-1921: 8/8.
- Controls: with main's server.js, both server test files fail the new #4139 arms; with main's page, the page test fails.
- Full suite on the final files: 10607 pass, 1 fail: engine/secretmask.test.js "#3995 gap 4 review round 31", a file this branch does not touch; it passes 3/3 run alone (a load-timing flake, not this change).
- #1720 gate passes by trailer (tooltip string; the page test evaluates the real expression); #2518 gate passes.
