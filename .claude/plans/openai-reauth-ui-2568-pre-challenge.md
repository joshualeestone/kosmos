---
pre_challenge: true
method: challenge-loop
branch: openai-reauth-ui-2568
diff_hash: e78ee6b2b949e57ff0bb2d66e87dc9ae882a7e210a065af77c17be3cb50fccc4
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T19:13:37Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Fixed:** 1 WARNING | **Deferred:** 3 NITs | **Asked:** 0

Reviews the #2568 OpenAI "Sign in again" affordance wired to the #2584 reauth-in-place
driver. Cross-model: Sonnet (iter 2) + Opus (iter 3).

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** n/a (orchestrator validate pass)
**New findings:** 0. Full suite + browser-check gate green on the branch baseline (no contention).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 NIT
- [WARNING] docs/browser-checks/render-account-badge-1921.js -- the fixture had no api-key rows, so the "reauth withheld from api-key rows" half was proven only by the source-pattern test, not in rendered DOM (the exact guard-green-while-page-breaks gap this check exists to close) --> FIXED (c44313cb): added a Claude api-key row (a.apiKey true) and an OpenAI api-key row (authMode apikey); both now assert claudeReauth=false AND openaiReauth=false in the real DOM. All four row shapes covered; ran headless, passes.
- [NIT] openAcctReauthOpenai has no synchronous focus fallback (focus lands inside acctOpenaiChoose after the async runner look), unlike the Claude reauth --> DEFERRED: inherited from the pre-existing non-reauth OpenAI picker's async-focus design; named as the plan's weakest premise; not introduced here.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** -- no new actionable findings.
- [NIT] the two reauth openers do not clear each OTHER's dir, and closeAcctAdd clears neither --> DEFERRED: safe as built (a fresh add only ever enters via openAcctAdd, which clears BOTH; each provider's start-POST reads only its own dir; #2584's server-side identity-match is a second backstop). A future hardening could clear both in each opener to make the invariant local rather than emergent; not a live bug.
- [NIT] on a reauth where the OpenAI runner is missing, the person meets the picker once before the sub step (the reauth intent still survives -- reauthDir is still threaded) --> DEFERRED: rare and correct, one extra click.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 2 | WARNING | docs/browser-checks/render-account-badge-1921.js | BRANCH | fixture lacked api-key rows (withholding only source-tested) | FIXED | c44313cb |
| 2 | 2 | NIT | web/index.html openAcctReauthOpenai | BRANCH | no synchronous focus fallback | DEFERRED | pre-existing async-focus design |
| 3 | 3 | NIT | web/index.html reauth openers | BRANCH | cross-provider dir non-clearing (emergent invariant) | DEFERRED | safe as built |
| 4 | 3 | NIT | web/index.html acctPick reauth routing | BRANCH | runner-missing reauth shows picker once | DEFERRED | rare, correct |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- The render ternary is mutually exclusive and correct for all four row shapes (Claude sub -> data-reauth, Claude api-key -> none, OpenAI chatgpt -> data-openai-reauth, OpenAI api-key -> none); no path renders both buttons; the new attributes are esc'd/injection-safe (iters 2, 3).
- The stale-ACCT_OPENAI_REAUTH_DIR hazard (the #1492 mirror) does not reproduce: openAcctAdd clears both dirs, acctReauthChrome hides the provider picker during a reauth, and each provider's POST reads only its own dir; #2584's identity-match is a second backstop (iters 2, 3).
- The reauth-routing line fires before the focus:false early-return and reuses the single acctOpenaiChoose('sub') call site, so there is no divergent reauth-vs-add path (iter 2).
- Tests are behavioral and non-vacuous: the browser check renders all four shapes in real DOM and asserts the two reauth buttons never cross; the reauth source test reds on a revert; the api-key fixtures are keyed by the exact label acctPrimaryName produces (iters 2, 3).
- No em dashes anywhere in the diff (all five spellings), every iteration.
