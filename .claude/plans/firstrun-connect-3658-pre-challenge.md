---
pre_challenge: true
method: challenge-loop
branch: firstrun-connect-3658
diff_hash: a13b7bfb1a46e37e398674ec5ca583bec2cf85615a22f43617004ea19570ee74
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T23:50:46Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet)
**Converged:** Yes, pass 4: 0 BLOCKERs, 0 WARNINGs, 1 NIT
**Fixed:** 2 BLOCKERs, 5 WARNINGs, 2 NITs | **Recorded:** 1 NIT, 4 accepted choices

### Validation

Full suite on head 95459087 (rebased twice; the second rebase took in #3661, the Grok
subscription engine, which touched web/index.html and server.provider-accounts-3296.test.js),
hash a13b7bfb1a46: 8760 pass, 0 fail, validation log clean (2026-09-24T23:50:46Z). The earlier run on b2b6672a
had 0 test fails but the #2518 surface gate refused: render-agentdm-3414 ('msg') and
render-gemini-logo-3422 (the Gemini pmark). Both were run and pass unchanged (40 and 14
PASS), so the branch carries two per-check Browser-check-surface trailers; the gate alone then returns 0.
render-firstrun-keyed-connect-3658.js 20/20; each fix below was perturbed and went red, with
the perturbation asserted applied.

### Iteration 1 (opus)
- [BLOCKER] dead end on a fresh computer (key asked for before learning the runner is
  missing) --> Connect probes the key route with {} first and names the tool
- [BLOCKER] provider switch mid-Add left Add disabled --> reset on open
- stale success dropped silently --> repaints; aria-expanded and focus fixed after Add
- accepted: one shared box under Grok's row; unused .smore-t rule left

### Iteration 2 (sonnet)
- probe premise pinned server-side (empty body writes nothing, runner present or missing,
  with a control); an Add landing after close+reopen closes the reopened box
- recorded: probe fails open on a network error; Settings still says "a xAI"

### Iteration 3 (opus)
- [WARNING] x5 --> fixed, each with a browser arm: seq token on frPaintKeyed; unknown add
  shows disabled "Key saved"; closing clears the pending message; Enter adds without
  bubbling to Next; accessible name follows Connected
- [NIT] backticks in the missing-runner text; stale Settings pointer --> fixed

### Iteration 4 (sonnet)
- [NIT] frPaintKeyed's known parameter is only used on the Add path; parity wording with
  frPaintOpenai --> recorded, no change
