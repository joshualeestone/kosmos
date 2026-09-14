---
pre_challenge: true
method: challenge-loop
branch: terminal-automation-2810
diff_hash: 29e3098d4b4ac8072a3e509e1729d9a4f4aeff0285b4a619eb9655b7fd6f7999
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T20:04:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 4 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs)
**Fixed:** 3 | **Deferred:** 1 | **Asked (awaiting user):** 0

kosmos #2810: "Open Terminal" fails for every agent with osascript -1743 (macOS
Automation/TCC denial). The fix adds NSAppleEventsUsageDescription to the app
bundle Info.plist that install/setup.sh generates, plus install-gate assertions
and an extended plist-heredoc guard. The loop caught em dashes in the plan file
and strengthened the install-gate assertion; the one WARNING is the documented,
deferred residual (real-Mac verification, parked needs-operator). Convergence was
witnessed by two models (opus + sonnet), the second of which empirically injected
synthetic regressions to confirm every guard arm is red-capable.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (6.0 passed clean, so ITER_COMMITS was empty at this review)
- [WARNING] install/setup.sh:3009 - -1743 efficacy rests on macOS treating the Kosmos bundle as the responsible process for the osascript-subprocess Apple event (via the board LaunchAgent's AssociatedBundleIdentifiers) --> DEFERRED: the plan's named weakest premise; additive and cannot regress anything; real-Mac verification parked needs-operator, not skipped.
- [CONVENTION] plan file - four em dashes (U+2014) --> FIXED (e387a460, replaced with hyphens)
- [NIT] tools/test-install.sh - assertion checked key presence, not a non-empty value --> FIXED (e387a460, plutil -extract non-empty; an empty usage string can suppress the prompt)
- [NIT] tools/test-plist-heredoc-clean.sh - doubled "plist" in the app-arm label --> FIXED (e387a460, label "app")

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged** - no issues found. Seven STRENGTHs: the plist round-trips (plutil -lint + extract), the nested-eval quoting matches a proven pattern, all four guard arms are red-capable (verified by synthetic injection), the tests are wired into test:shell, the app Info.plist has a single source of truth, no em dashes in any spelling, and the plan is honest about its weakest premise.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/setup.sh:3009 | BRANCH | -1743 efficacy unverifiable headless (responsible-process premise) | DEFERRED | documented weakest premise; real-Mac verification parked needs-operator |
| 2 | 1 | CONVENTION | plan:3,30,41,54 | BRANCH | four em dashes | FIXED | e387a460 |
| 3 | 1 | NIT | tools/test-install.sh | BRANCH | presence-not-value assertion | FIXED | e387a460 |
| 4 | 1 | NIT | tools/test-plist-heredoc-clean.sh | BRANCH | doubled label | FIXED | e387a460 |

### Outstanding questions (ASKED)
None.

### Deferred (for the operator to know)
- The -1743 resolution is unverifiable in a headless session. It needs a real Mac: install the next build, click Open Terminal for an agent, expect the "Kosmos wants to control Terminal" prompt, Allow, and Terminal should attach the tmux session. This card is being parked needs-operator for that verification, not closed.

### Strengths (across all iterations)
- Root cause correctly diagnosed; the apple-events entitlement correctly rejected (the sender is the Apple-signed osascript subprocess, so the gap is the missing usage description on the responsible bundle).
- The added plist content is safe in the unquoted heredoc (no $ or backtick that would expand while written); verified by rendering + plutil -lint + extract.
- The test-plist-heredoc-clean refactor keeps the board-plist coverage and adds real, non-vacuous, red-capable app-heredoc coverage (verified by synthetic injection on all four arms).
- Both install-gate assertions are unconditionally wired and red-capable (missing key, empty value, and malformed XML all fail).
- Single source of truth preserved: install/setup.sh is the only place the app Info.plist is generated.
