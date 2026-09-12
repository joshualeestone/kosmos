---
pre_challenge: true
method: challenge-loop
branch: codex-home-strip-2858
diff_hash: 5c466b961290d0044bf09b521bcd94efe9f05936138958c546e60cef5cac8818
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T01:31:34Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 4 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs)
**Fixed:** 2 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (general-purpose default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [NIT] tools/test-run-tests-codexhome-2858.sh — order-check matched a bare `node --test`, latently fragile if a future comment contained that literal above the strip. --> FIXED (b48e7439): pinned to `node --test.*KOSMOS_TEST_FILES`.
- [NIT] tools/test-run-tests-codexhome-2858.sh — precedence checked before `node --test` only, not `yarn test:shell`. --> FIXED (b48e7439): assert precedes the node suite, which runs before test:shell (covers both). Note: my first fix at this NIT added a separate `yarn test:shell` match that matched run-tests.sh's own #2858 comment and false-failed; I caught it via a control and simplified to the node-suite check.
- [STRENGTH] Core `unset` correctly placed before both `node --test` (236) and `yarn -s test:shell` (239); nothing reads the stripped vars.
- [STRENGTH] Stripping AGENT_WORKFORCE_CODEX_HOME breaks no test (every test deletes or sets its own sandbox value; runner strip is a superset).
- [STRENGTH] Guard grep patterns discriminate correctly + BSD-portable; guard ran, 4 legs pass.

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per kosmos#2032)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings (confirmed resolved):** 0
**Converged** — no BLOCKER/WARNING/CONVENTION. Reviewer re-implemented the discriminating regex in Python (matches both-names, rejects AGENT-only), confirmed the pinned node pattern hits exactly one line, verified `unset` under `set -u` is a no-op, that the behavioral leg cannot mask a source-leg failure (`fails` is monotonic), and ran the guard (ALL PASS).
- [NIT] tools/test-run-tests-codexhome-2858.sh — `uln` uses the looser `unset.*CODEX_HOME` pattern while the two checks above discriminate. --> DEFERRED: harmless. The two discriminating checks independently verify the strip is PRESENT (they do not depend on `uln`), so a removed strip still reds; only the order assertion's line number could be fooled, and only by a contrived future `unset ...CODEX_HOME...` line added above the strip. Not a live bug.
- [NIT] tools/test-run-tests-codexhome-2858.sh:1 — shebang `#!/bin/bash` vs run-tests.sh's `#!/usr/bin/env bash`. --> DEFERRED: within existing repo convention (49 vs 27 among tools/test-*.sh).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | tools/test-run-tests-codexhome-2858.sh | BRANCH | bare `node --test` match fragile to a comment | FIXED | b48e7439 |
| 2 | 1 | NIT | tools/test-run-tests-codexhome-2858.sh | BRANCH | precedence check narrower than comment's claim | FIXED | b48e7439 |
| 3 | 2 | NIT | tools/test-run-tests-codexhome-2858.sh | BRANCH | `uln` grep looser than the discriminating checks | DEFERRED | harmless; present-checks independent of uln |
| 4 | 2 | NIT | tools/test-run-tests-codexhome-2858.sh:1 | BRANCH | shebang style | DEFERRED | within repo convention |

### Outstanding questions (ASKED, still unresolved when the run ended)

None.

### NITs (non-blocking, across all iterations)
- All four NITs are above (2 fixed, 2 deferred with reasoning).

### Strengths (across all iterations)
- The `unset` is a single early strip at the one runner every `yarn test` / the validation gate routes through, isolating both the node suite and `yarn test:shell` from ambient Codex-home state; nothing downstream reads the stripped vars (iter 1, iter 2).
- Behavior-preserving: stripping AGENT_WORKFORCE_CODEX_HOME breaks no test; the 3 named tests already self-defend, so the runner strip is a layer, not a replacement (iter 1, iter 2).
- The guard is wired into `test:shell` (an unwired guard runs nothing), reds if the strip is removed/moved (verified by a proper negative control deleting the strip line), and its behavioral leg cannot mask a source-leg failure (iter 2).
- Discriminating regex correctly requires a bare `CODEX_HOME` token and rejects the AGENT-only case; BSD/macOS portable (iter 1, iter 2).
- Card location correction: the card proposed `test-runner-reexec-1818.sh` (a browser-checks test), but `yarn test` runs `run-tests.sh -> node --test`; the strip had to live in run-tests.sh. Independently confirmed by PigeonPete.
