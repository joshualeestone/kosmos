---
pre_challenge: true
method: challenge-loop
branch: connect-picker-2338
diff_hash: 6a40ee0af857e6f61bfefb859ec081c62fcc708e1a11aec483e5e240c0e4bdee
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T21:39:01Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 12 (0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 6 NITs)
**Fixed:** 10 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
Initial validation (6.0) failed the #1720 browser-check gate (a rendered web/ change
with no docs/browser-checks assertion), and the first blind review found two real
WARNINGs.
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs, + 1 synthetic (browser-check gate)
- [BLOCKER-synthetic] browser-check gate: a web/ change needs a docs/browser-checks assertion --> FIXED (updated render-accounts-openai.js to route through the picker) (9b5cfab0)
- [WARNING] web/index.html — poll treated a 404 (terminal per contract) as a transient skip, so an expired session polled forever behind a stuck message --> FIXED (9b5cfab0)
- [WARNING] web/index.html — a 2xx start with no sessionId stranded a disabled button behind "Starting the sign-in…" (no finally like the key path) --> FIXED (9b5cfab0)
- [NIT] redundant second msg set on terminal failure --> FIXED (9b5cfab0)
- [NIT] acctOpenaiChoose set keys.hidden without the early guard acctOpenaiStep uses --> FIXED (9b5cfab0)
- [NIT] provider switch-away did not clear ACCT_OPENAI_SUB_SESSION --> FIXED (9b5cfab0)

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs
- [WARNING] web/index.html — the terminal error/cancelled poll branch did not reset affordances or null the session like the 404 branch (stale open-page link to a torn-down authUrl; lingering dead session) --> FIXED (3379300e)
- [WARNING] web/index.html — acctOpenaiChoose('sub') did not reset affordances on entry, so a prior aborted sign-in left stale rows on re-entry (not idempotent) --> FIXED (3379300e)
- [NIT] acctIsOpenaiSubscription defined + tested but unused --> FIXED by removal (dead code; discriminator stays documented; a subscription badge is a deferred Josh UX call) (3379300e)
- [NIT] two aria-live regions (#acct-openai-sub-code + #acct-openai-msg) can both announce in one tick --> DEFERRED: the device code MUST be announced for screen readers; the one-time overlap is complementary (instruction + code) and the key path has no code to announce.

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
- [WARNING] web/index.html — the Sign-in button could stick disabled after a needsRunner reroute or a provider switch-away-and-back, because re-enable was not centralized --> FIXED (centralized re-enable into acctOpenaiSubReset; removed redundant per-caller re-enables) (a41b1cf1)
- [CONVENTION] plan file listed the removed acctIsOpenaiSubscription among extracted functions (plan-vs-code drift) --> FIXED (a41b1cf1)
- [NIT] acctOpenaiChoose did not clear the shared #acct-openai-msg, so a prior error lingered on re-entry --> FIXED (a41b1cf1)
- [NIT] setInterval async callback could overlap and double-invoke acctOpenaiSubConnected on connected --> FIXED (null the session synchronously before the awaited call) (a41b1cf1)
- [NIT] no in-flow "back to picker" affordance --> DEFERRED: close/reopen works, symmetric with the pre-existing flow; noted as a follow-up, out of scope for this picker.

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no new actionable findings.
- [NIT] no client-side poll ceiling (a host session that never reaches a terminal state and never 404s would poll forever while the dialog is open) --> DEFERRED: bounded in practice by user cancel/close (both tear down cleanly) and host session expiry (404 is terminal); the reviewer rated it a robustness nit, not a correctness bug. Recorded as a follow-up (a defensive max-elapsed cap).
- [NIT] acctShowSuccess ignores the accountLabel arg when a goldBox is passed --> DEFERRED (non-defect): a faithful mirror of the existing key path; intentional consistency.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER(synthetic) | browser-check gate | web/ change lacked a docs/browser-checks assertion | FIXED | 9b5cfab0 |
| 2 | 1 | WARNING | web/index.html | 404 treated as transient, polled forever | FIXED | 9b5cfab0 |
| 3 | 1 | WARNING | web/index.html | sessionless 2xx start stranded a disabled button | FIXED | 9b5cfab0 |
| 4 | 1 | NIT | web/index.html | redundant terminal-failure msg set | FIXED | 9b5cfab0 |
| 5 | 1 | NIT | web/index.html | acctOpenaiChoose missing keys guard | FIXED | 9b5cfab0 |
| 6 | 1 | NIT | web/index.html | switch-away did not clear session | FIXED | 9b5cfab0 |
| 7 | 2 | WARNING | web/index.html | error/cancel branch lacked reset+null | FIXED | 3379300e |
| 8 | 2 | WARNING | web/index.html | sub-entry not idempotent | FIXED | 3379300e |
| 9 | 2 | NIT | web/index.html | acctIsOpenaiSubscription dead code | FIXED (removed) | 3379300e |
| 10 | 2 | NIT | web/index.html | two aria-live regions overlap | DEFERRED | code must be announced; one-time, complementary |
| 11 | 3 | WARNING | web/index.html | Sign-in button could stick disabled | FIXED | a41b1cf1 |
| 12 | 3 | CONVENTION | .claude/plans/connect-picker-2338.md | plan listed removed function | FIXED | a41b1cf1 |
| 13 | 3 | NIT | web/index.html | acctOpenaiChoose did not clear msg | FIXED | a41b1cf1 |
| 14 | 3 | NIT | web/index.html | setInterval overlap double-connect | FIXED | a41b1cf1 |
| 15 | 3 | NIT | web/index.html | no back-to-picker affordance | DEFERRED | close/reopen works; follow-up |
| 16 | 4 | NIT | web/index.html | no client-side poll ceiling | DEFERRED | bounded by cancel/close + host 404; follow-up |
| 17 | 4 | NIT | web/index.html | goldBox path ignores accountLabel | DEFERRED | non-defect; mirrors the key path |

### NITs (non-blocking)
- aria-live overlap (deferred, iter 2), no back-to-picker (deferred, iter 3), no poll ceiling (deferred follow-up, iter 4), goldBox label non-defect (iter 4).

### Strengths (across iterations)
- Pure, extract-and-run state machine (acctOpenaiSubView) with a safe default arm.
- Complete, centralized teardown symmetry across 404 / error / cancel / close / needsRunner / switch-away (the button cannot stick disabled).
- The double-connect guard also collapses a connected tick that resolves after cancel/close (no success paint into a torn-down modal).
- Correct HTML nesting + aria-live ordering; no em dashes in Josh-facing copy.
- The browser check was updated to route through the interposed picker, so the existing API-key walk stays valid without claiming subscription e2e coverage (which the release gate owns).

### Note on scope / verification
The subscription flow's end-to-end sign-in cannot be verified without a real ChatGPT
subscription (the release gate, Pete's Phase 5). What is verified: render/toggle, the
exact contract route shapes, the poll state machine, teardown/lifecycle, and safe
concurrency. This PR is the Settings connect surface only; the first-run wizard picker
is a documented follow-up to coordinate with Renet after the setup-flow rebuild settles.
