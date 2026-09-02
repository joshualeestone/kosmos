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
Validation: `node --test engine/*.test.js server.create-live-1903.test.js` = 1983 pass / 0 fail. Every fix perturbation-verified.

### The fix
`subscription.checkLive` (built on `claude auth status`) reports a STORED login, not a working token — a fully-expired Claude OAuth token badges "Signed in", so #1903's create gate accepted a dead account. #1315's `/v1/models` shape does not translate (OAuth subscription token ≠ API key). `create.claudeAccountLive(configDir)` makes a real `claude -p --strict-mcp-config` call, classified by OUTPUT CONTENT (CLAUDE_CAPACITY → CLAUDE_DEAD_AUTH → exit-0 → UNKNOWN): NONE only on a genuine auth failure; capacity/rate/usage/overload/network/unrunnable FAIL OPEN. accountConnectable's Claude arm uses it; the OpenAI arm and the badge/`subscription.checkLive` path are unchanged.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] engine/create.js — exit code trusted over output content --> FIXED (content-first ordering).
- [WARNING] engine/create.js — a ReferenceError inside claudeAccountLive was swallowed by the fail-open catch and accepted dead accounts --> FIXED (require subscription in-scope; tests assert the REFUSAL, not just no-throw).
- [CONVENTION] server.js / test headers — stale "claude auth status" wording --> FIXED.
- [NIT] unused imports --> FIXED.

#### Iteration 2
- [WARNING] engine/create.js — bare "Please run /login" too broad → false-refusal risk --> FIXED (dropped; specific dead strings kept).
- [WARNING] test — capacity-before-dead precedence asserted only in prose --> FIXED (co-occurrence fixture; perturbation-verified).
- [NIT] false-refusal guard added; probe env cleanup.

#### Iteration 3
- [WARNING] engine/create.js — non-JSON `authentication_error` missed --> FIXED (bare `authentication_error` marker, safe). Bare-`/login`-only dead form pinned as a deliberate KNOWN GAP (fails open).
- [NIT] cosmetic (resolveBin .present; 15s ceiling) --> noted.

#### Iteration 4
- [WARNING] engine/create.js — a broken MCP CONNECTOR's auth diagnostics could false-refuse a LIVE account --> FIXED (`claude -p --strict-mcp-config`; flag asserted by a fake-bin test).
- [NIT] duplicate subscription require (module-cached) --> noted.

#### Iteration 5
- [WARNING] test — the truthy-configDir real-probe branch had no coverage --> FIXED (labelled-dir + default-DELETES-CLAUDE_CONFIG_DIR-when-parent-set tests; April's env-leak point).
- [NIT] exit-0-empty infers CONNECTED (accepts either way); timeout env; duplicate require --> noted.

#### Iteration 6
- Clean pass. [NIT] resolveBin `.present` intent (behavior correct + tested) --> noted.
- **Converged** — no actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | engine/create.js | exit-code over content | FIXED |
| 2 | 1 | WARNING | engine/create.js | swallowed ReferenceError accepted dead accounts | FIXED (subscription in-scope) |
| 3 | 2 | WARNING | engine/create.js | bare /login too broad (false-refusal) | FIXED |
| 4 | 2 | WARNING | test | capacity precedence untested | FIXED (co-occurrence test) |
| 5 | 3 | WARNING | engine/create.js | non-JSON authentication_error missed | FIXED |
| 6 | 4 | WARNING | engine/create.js | broken MCP connector false-refuses live account | FIXED (--strict-mcp-config) |
| 7 | 5 | WARNING | test | truthy-configDir real-probe uncovered | FIXED (configDir + env-leak tests) |

### KNOWN GAP (pinned)
A dead sign-in printing ONLY a bare "Please run /login" with no auth string fails OPEN (accepted at create, caught later by #1884). Deliberate — a bare remedy phrase is not a genuine auth failure and re-adding it false-refuses live accounts. Self-flipping KNOWN-GAP test.

### Scope
Fixes the CREATE gate only. Does NOT change `subscription.checkLive`, so the badge and #1560's CONNECTED early-exit stay credulous for a dead token — #1922 (re-auth) and #1921 (observed-outcomes badge) own the READ path; `claudeAccountLive` is reusable there.

### NITs (non-blocking)
- [NIT] resolveBin `.present` not consulted (ENOENT → UNKNOWN, fail-open, tested) — cosmetic.
- [NIT] exit-0 with empty output infers CONNECTED (accepts either way).
- [NIT] AGENT_WORKFORCE_CLAUDE_PROBE_TIMEOUT_MS readable in prod (fails safe).
- [NIT] duplicate `require('./subscription')` (module-cached).

### Strengths (across iterations)
- [STRENGTH] Content-before-exit-code classification with capacity-before-dead precedence, both proven by non-vacuous tests (a dead token exiting 0 with a 401 is still caught; a capped-but-live account fails open).
- [STRENGTH] The fail-open CLASS is named and airtight: every environmental case → UNKNOWN → accepted; only a positive auth string → NONE; crashes logged distinctly and still fail open, so a validator bug can never silently impersonate a restricted network.
- [STRENGTH] `--strict-mcp-config` isolates the probe from the account's MCP connectors; the real subprocess path is exercised via a fake bin (exit codes, SIGKILL-at-timeout + partial-output survival, the flag, configDir pass-through, and DELETE-not-omit of CLAUDE_CONFIG_DIR).
- [STRENGTH] No credential value written or logged anywhere; the OpenAI arm and the badge path are untouched; createAgent stays sync.

### Weakest premise
`claude -p`'s exact dead-token output is inferred from #874 + 2.1.258's strings, not reproduced locally (all four accounts here are live). Classification is conservative (only positive auth strings → NONE; everything else fails open), so a wording mismatch errs toward accepting, never false-refusing. Confirm against Ben's dead account when available.
