---
pre_challenge: true
method: challenge-loop
branch: pjmsg-prewrap-2294
diff_hash: 15d21eb1b8ed440d8491b43345f55cedb77b8da1d9d4e68fac1d35f571517b80
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T20:56:48Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (converged; iteration 2 returned zero BLOCKER/WARNING/CONVENTION)
**Converged:** Yes
**Total findings:** 2 WARNINGs + 1 CONVENTION (iter 1) + several NITs (iter 1-2)
**Fixed:** 5 | **Deferred:** 2 (both NITs) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
- [WARNING] web/index.html:31888 (pjRich Rule 2) still said `.pj-msg-text` is NOT pre-wrap --> FIXED (b6df83fd).
- [WARNING] web/index.html:31900 (pjRich Rule 4) still said `.pj-msg-text` keeps collapsing newlines --> FIXED (b6df83fd).
- [CONVENTION] em dashes in the plan file --> FIXED (b6df83fd).
- [NIT] pre-wrap preserves space runs --> DEFERRED: harmless, storeText collapses space runs server-side for both message surfaces (web/index.html:4003), the same reason the `.dm-b` precedent is safe.
- 4 STRENGTHs (slow-path safety, `.dm-b` precedent match, non-vacuous check + control, tight scope).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** — no new actionable findings.
- [NIT] the "slow path carries no literal `\n`" phrasing overlooked the `.mdcb` fenced-code case --> FIXED (8f7f4e80): tightened the CSS + pjRich comments and README, AND added a fenced-code arm to the browser check proving the `.mdcb` newlines render via their own pre-wrap, unaffected by the parent.
- [NIT] the #2239 markdown-treatments comment singled out `.dm-b` --> FIXED (both surfaces now pre-wrap).
- [NIT] README grammar "the page's own pjRich" --> FIXED.
- [NIT] Renet's historical richtext-render-2067.md plan still calls `.pj-msg-text` not-pre-wrap --> DEFERRED: a point-in-time completed-ticket record, not this branch's to rewrite.
- 3 STRENGTHs (tight scope, non-vacuous check arms, storeText normalizes the risky whitespace edges).

### Final validation (6j)

Full node suite green on the final HEAD (0 failures, 253s full run, exit 0). Render check
green (plain two-line renders breaks; markdown two-line not doubled; fenced code renders via
its own `.mdcb` pre-wrap) with a control-verified red.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:31888 | pjRich Rule 2 stale (not-pre-wrap) | FIXED | b6df83fd |
| 2 | 1 | WARNING | web/index.html:31900 | pjRich Rule 4 stale (collapsing) | FIXED | b6df83fd |
| 3 | 1 | CONVENTION | plan file | em dashes | FIXED | b6df83fd |
| 4 | 1 | NIT | web/index.html:4564 | pre-wrap preserves space runs | DEFERRED | storeText collapses server-side |
| 5 | 2 | NIT | web/index.html:32010 | "no literal \n" overlooked .mdcb | FIXED | 8f7f4e80 (+ check arm) |
| 6 | 2 | NIT | web/index.html:4014 | comment singled out .dm-b | FIXED | 8f7f4e80 |
| 7 | 2 | NIT | README:150 | grammar | FIXED | 8f7f4e80 |
| 8 | 2 | NIT | richtext-render-2067.md | historical plan stale | DEFERRED | point-in-time record |

### Strengths
- Slow-path safety holds under scrutiny: `out.join('<br>')` introduces no inter-line literal `\n`; the only literal `\n` is inside `.mdcb`, which has its own pre-wrap (now proven by a check arm).
- Change tightly scoped to `.pj-msg .pj-msg-text`; `.dm-b` and `.msg-b` untouched.
- Browser check non-vacuous, control-verified; server-side storeText normalizes whitespace-only / ragged-newline edges before pre-wrap renders.
- No em dashes; reason-grep count bumps (63->64, 38->39) correct.
