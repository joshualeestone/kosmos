---
pre_challenge: true
method: challenge-loop
branch: acctname-2095
diff_hash: 9a46a11ba545d6eef9eff52d045fe93af6d8ec7bd0bccfcd908a89bfae837634
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T09:43:52Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 yielded zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 5 BLOCKER/WARNING, 6 CONVENTION/NIT (across all passes), plus 3 caught by the full-suite validation gate
**Fixed:** all actionable findings | **Deferred:** 2 (documented) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] web/index.html fillSwitchAccounts -- leading with the name removed the inherently-unique keyTail that kept the move/switch picker's options distinct, reintroducing the #1917 pick-the-dead-one ambiguity on a name axis --> FIXED (added accountQualifiers/qualOf, commit ec2f4125)
- [WARNING] web/index.html confirmation toasts still show only the key --> DEFERRED then partially FIXED in iter 3
- [NIT] accountQualifiers key duplicated the name-selection inline --> FIXED (extracted shared acctChosenName)
- [NIT] test comment inaccuracy --> FIXED
- (Self-surfaced on re-run) the keyDetail reused .acct-org, breaking #1393's "acct-org exactly once" invariant --> FIXED (dedicated .acct-keytail class)

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
- [CONVENTION] em dashes in the plan file --> FIXED (rewrote plan, commit 22d0ffba)
- [NIT] browser-check prose + README said .acct-org, code uses .acct-keytail --> FIXED
- [NIT] browser-check field named `orgs` populated from .acct-keytail --> FIXED (renamed to keytails)

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] the Settings add-a-provider "Added" toast (re-raised across three passes) shows the key while the adjacent list now shows the name, and the entered name is in scope one line away --> FIXED (leads with enteredLabel; source-pin test added; commit 1be3ad7d)
- [NIT] acctChosenName not provider-gated (asymmetry with acctHasChosenName) --> FIXED (clarifying comment: intentional, correct)

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] two more account-identity surfaces still on the old email||label||dir chain: the Move-to picker (paintAccountPicker) and the agent-detail "runs on" line --> Move-to picker FIXED (same #1917 picker class, name available via ACCOUNTS/acctLive; source-pin test added); agent-detail line DEFERRED with documentation (launch-file-derived a.account has no name; needs an ACCOUNTS-by-dir lookup on a line with subtle Move-window semantics). commit f499c315
- [NIT] stale line-number reference in the toast comment --> FIXED

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- no new actionable findings. An independent whole-file sweep confirmed all account-label surfaces are covered or documented-deferred, and verified both deferrals are sound (accountForAgent returns no `name`; the first-run form has no name field).
- [NIT] the qualifier tooltip assumed an email collision, but the widened trigger can now fire on a name collision --> FIXED (copy made accurate for both cases; commit e69e16d9)

### Findings caught by the full-suite validation gate (not visible to a diff-only review)
- #1864 (browser-checks-reason-grep): the new browser-check adds one finding-emit + one launch-catch site; EXPECTED_SITES 41->42, EXPECTED_CATCH_SITES 23->24, documented. FIXED (commit 9625f4a1)
- #1387 (tools.browser-checks-wired): the new browser-check must be wired into the runner; added its stem to the no-URL render loop. FIXED (commit 73c8c318)
- #1881 (no-brand-refs): a sample email used stuff.io; changed to example.com. FIXED (commit 73c8c318)

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html fillSwitchAccounts | same-named accounts collide (missing qualifier) | FIXED | ec2f4125 |
| 2 | 1 | NIT | web/index.html accountQualifiers | inline name-selection duplicated | FIXED | ec2f4125 |
| 3 | 1 | (regress) | web/index.html acctRowHtml | keyDetail reused .acct-org (#1393) | FIXED | ec2f4125 |
| 4 | 2 | CONVENTION | .claude/plans/acctname-2095.md | em dashes | FIXED | 22d0ffba |
| 5 | 2 | NIT | docs/browser-checks/* | .acct-org prose vs .acct-keytail code | FIXED | 22d0ffba |
| 6 | 3 | WARNING | web/index.html:15839 | add-toast showed key not name | FIXED | 1be3ad7d |
| 7 | 4 | WARNING | web/index.html paintAccountPicker | Move-to picker on old chain | FIXED | f499c315 |
| 8 | 4 | WARNING | web/index.html:19511 | agent-detail line on old chain | DEFERRED | launch-file account has no name; documented follow-up |
| 9 | - | (valgate) | browser-checks-reason-grep.test.js | emit-count guard (#1864) | FIXED | 9625f4a1 |
| 10 | - | (valgate) | tools/browser-checks.sh | check not wired (#1387) | FIXED | 73c8c318 |
| 11 | - | (valgate) | render-account-name-2095.js | stuff.io brand ref (#1881) | FIXED | 73c8c318 |
| 12 | 5 | NIT | web/index.html:14627 | qualifier tooltip copy vs widened trigger | FIXED | e69e16d9 |

### Deferred (documented in the plan, follow-up warranted)
- The FIRST-RUN "Added" toast (~36368): separate flow, the entered name is not in scope (the first-run form has no name field).
- The agent-detail "runs on" line (~19511): a.account is launch-file-derived (no `name`); showing the chosen name needs an ACCOUNTS-by-dir lookup on a line with subtle saved-but-not-restarted Move-window semantics. It is a status line, not an account picker.

### Strengths (across all iterations)
- Single shared helper (acctChosenName / acctPrimaryName / acctHasChosenName) at all four render sites + the qualifier key (the #1834 "name it once" rule); every unnamed-fallback chain preserved byte-for-byte, so Claude and unnamed-OpenAI rows are unchanged.
- XSS handled at every DOM sink (esc() everywhere), proven in a real DOM by the browser check (childElementCount === 0 for an x<b>y name).
- The accountQualifiers name-aware key closes the function's own deferred finding 8; red-capable controls for same-name-disambiguated and unique-name-no-noise.
- .acct-keytail inherits every theme/contrast treatment from the single base .acct-org rule; a dedicated class avoids the #1393 collision.
- Independent whole-file sweep (iter 5) confirmed complete coverage and sound deferrals.
