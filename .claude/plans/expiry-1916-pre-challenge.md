---
pre_challenge: true
method: challenge-loop
branch: expiry-1916
diff_hash: 835eb0853d39fa60fb9bb02857931a3f87d5489c471e6b4d27e334c928001c66
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T23:30:59Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (converged — iteration 6 a clean pass, 0 BLOCKER/WARNING/CONVENTION)
**Total findings:** 7 WARNINGs, 2 CONVENTIONs, ~9 NITs (0 BLOCKERs). Every WARNING fixed; NITs cosmetic or pinned.
Each of iterations 1–5 found and fixed a real auth-critical issue; iteration 6 was clean.

Validation: `node --test engine/*.test.js server.create-live-1903.test.js` = 1983 pass / 0 fail. Every fix perturbation-verified (each reds its target test when reverted).

### Per-iteration (findings → resolution)
- **Iter 1:** [W] exit-code trusted over content; [W→caught] a `ReferenceError` inside claudeAccountLive was swallowed by the fail-open catch and accepted dead accounts (subscription required in-scope; tests assert the REFUSAL). [C/N] stale comments/imports.
- **Iter 2:** [W] `Please run /login` in the JSON path was too broad → false-refusal risk; [W] capacity-precedence asserted only in prose. Fixed + a capacity+auth co-occurrence test + a false-refusal guard.
- **Iter 3:** [W] narrowed regex missed a non-JSON `authentication_error`; broadened to the bare string (safe — never in a "reply ok" success); the bare-`/login`-only dead form pinned as a deliberate KNOWN GAP (fails open; must not reintroduce the bare marker).
- **Iter 4:** [W] a broken MCP CONNECTOR's auth diagnostics could false-refuse a LIVE account → `claude -p --strict-mcp-config` isolates the probe; flag asserted by a fake-bin test.
- **Iter 5:** [W] the truthy-configDir branch of defaultClaudeProbe had no real-probe coverage → added labelled-dir + default-DELETES-CLAUDE_CONFIG_DIR-even-when-parent-set (April's env-leak point) tests.
- **Iter 6:** clean. 1 cosmetic NIT (resolveBin `.present` intent — behavior correct + tested).

## The fix
`subscription.checkLive` (built on `claude auth status`) reports a STORED login, not a working token — a fully-expired Claude OAuth token badges "Signed in", so #1903's create gate accepted a dead account (Ben's fresh agent 401'd on turn 1). #1315's `/v1/models` shape does not translate (OAuth subscription token ≠ API key). `create.claudeAccountLive(configDir)` makes a real `claude -p --strict-mcp-config` call, classified by OUTPUT CONTENT (CLAUDE_CAPACITY → CLAUDE_DEAD_AUTH → exit-0 → UNKNOWN): NONE only on a genuine auth failure; capacity/rate/usage/overload/network/unrunnable all FAIL OPEN (an account at its weekly cap is live+paid and must never be refused). accountConnectable's Claude arm uses it; the OpenAI arm and the badge/`subscription.checkLive` path are unchanged.

## Fail-open CLASS (named)
Every environmental case returns a STATE and never throws, so a throw reaching a catch is OUR code crashing. All four catches log the crash distinctly (`failOpen`) and still fail open — a validator bug is visible, never silently impersonating a restricted network (the swallowed-ReferenceError hole that let the original gate accept dead accounts).

## Scope (stated so sequencing is unambiguous)
#1916 fixes the CREATE gate only. It does NOT change `subscription.checkLive`, so the badge and #1560's CONNECTED early-exit remain credulous for a dead token — #1922 (re-auth) and #1921 (observed-outcomes badge) own the READ path. `claudeAccountLive` is reusable there.

### KNOWN GAP (pinned)
A dead sign-in printing ONLY a bare "Please run /login" with no auth string fails OPEN (accepted at create, caught later by #1884). Deliberate — a bare remedy phrase is not a genuine auth failure and re-adding it false-refuses live accounts. Self-flipping KNOWN-GAP test.

## Weakest premise
`claude -p`'s exact dead-token output is inferred from #874 + 2.1.258's strings, not reproduced locally (all four accounts here are live). Classification is conservative (only positive auth strings → NONE; everything else fails open), so a wording mismatch errs toward accepting, never false-refusing. Confirm against Ben's dead account when available.

## After merge
Cut 0.6.23 (supersedes 0.6.22's insufficient #1903 gate; only a cut reaches Ben). Verify served both arms; budget for stale browser-gate checks.
