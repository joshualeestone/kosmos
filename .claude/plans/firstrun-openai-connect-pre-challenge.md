---
pre_challenge: true
method: challenge-loop
branch: firstrun-openai-connect
diff_hash: c83f4a4727070533dd114c22c4e8ada0c73f063f8b5c73d23bfdef31e185785d
subdir_audit: passed
timestamp: 2026-08-26T14:19:48Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (iteration 1 ran in the pre-migration session, its findings fixed in cd3fc32; iterations 2-6 ran fresh in this session after Josh's ship decision)
**Converged:** Yes (iteration 6: zero BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 3 BLOCKER-free WARNINGs fixed at iteration 2, 2 at iteration 4, 1 WARNING + 1 CONVENTION at iteration 5, plus iteration 1's original findings; 0 deferred without record
**Fixed:** 10 | **Deferred:** 2 (both recorded in the plan with rationale)

### Per-Iteration Breakdown

#### Iteration 1 (pre-migration session)
- Findings on the initial build (action-vs-state message split among them) --> FIXED (cd3fc32). Josh's two live tweaks followed (4e68f6f): Show/Hide removed, OpenAI icon 50% larger.

#### Iteration 2
**New findings:** 2 WARNINGs, 2 CONVENTIONs, 2 NITs
- [WARNING] connected outcome written into #fr-openai-msg INSIDE #fr-openai-flow, which the same paint hides: success message + aria-live landed in a display:none subtree --> FIXED (7be4816): message moved outside the flow, structural div-balance test added, proven to fail on the old markup
- [WARNING] pane-entry read of /api/accounts (slow, #960 live verification) resolving after a fast Add could repaint a just-connected row to Connect, inviting a duplicate-key paste --> FIXED (7be4816): supersession token; Add handler bumps at start; gated-fetch race test
- [CONVENTION] em dashes introduced by the diff --> FIXED (7be4816), house `--`
- [CONVENTION] stale .pmark six-logos comment --> FIXED (7be4816), two live marks
- [CONVENTION] plan drift (Show/Hide, three-vs-four paths) --> FIXED (7be4816)
- [NIT] GPT-row test's 6000-char window cleared Claude's row by ~100 chars --> FIXED (7be4816), re-anchored on data-pmark="openai"

#### Iteration 3
**New findings:** 0 actionable, 5 NITs
- Twice-flagged NITs acted on (396ea4b): Enter in the key field submits; aria-expanded/aria-controls on the disclosure; "mirrors verbatim" comment corrected; seq-bump comment scoped to what the guard really shields

#### Iteration 4
**New findings:** 2 WARNINGs, 2 NITs
- [WARNING] aria-expanded set true on reveal and never reset: the connected paint hid the flow while the disclosure claimed expanded forever after --> FIXED (276abaf): aria-expanded tracks flow.hidden at the end of every paint, asserted with attribute-capturing fakes
- [WARNING] Claude's "works today" tag beside an untagged OpenAI row quietly implied OpenAI does not work, a softer form of the false claim this branch removes --> FIXED (276abaf): both live rows tagged
- [NIT] cold-read connected path parked a half-typed key in the hidden field --> FIXED (276abaf), cleared + asserted
- (One transient harness failure, caught before push: later test blocks replaced the fake button with objects lacking setAttribute; fixed by mutating the makeEls fake)

#### Iteration 5
**New findings:** 1 WARNING, 1 CONVENTION, 4 NITs
- [WARNING] a row is not a connection: the cold read painted Connected off row presence, ignoring the per-account connection.state verdict; a revoked key wore Connected with the form hidden and no path to a fresh key --> FIXED (c3e7835): 'connected' means connected, 'none' paints Connect + surfaces its because, 'unknown'/verdict-less rows are honest-unknown both directions; three new tests, existing fake given a real verdict
- [CONVENTION] /api/accounts caller-inventory comment stale (claimed Settings-only) --> FIXED (c3e7835): both callers named, cost rationale re-argued
- [NIT] copy pairing unguarded --> FIXED (c3e7835): test holds Settings/first-run hint byte-identical
- [NIT] autocomplete="off" weaker than "new-password" --> FIXED (c3e7835) on both fields together
- [NIT] Settings' key field lacks Enter submit --> DEFERRED, recorded in plan (belongs with the #977/#978 Settings batch)
- [NIT] Add handler's pre-POST seq bump untested --> DEFERRED, recorded in plan (transient, self-correcting)

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs (two are the recorded deferrals, two marginal hardening notes: handler-path coverage, e.isComposing on Enter)
**Converged** -- reviewer's verdict: "mergeable as-is". Independently re-ran: 9/9 target file, adjacent suites green, sync-forced-theme --check clean, no em dashes in the diff, worktree clean.

### Final Ledger (fixed items)

| # | Iter | Category | Area | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | (batch) | wizard pane 3 | initial-build findings incl. action-vs-state message split | FIXED | cd3fc32 |
| 2 | 2 | WARNING | web/index.html | success message hidden with the form it reports on | FIXED | 7be4816 |
| 3 | 2 | WARNING | web/index.html | slow-read-after-fast-Add repaint race (duplicate-key invite) | FIXED | 7be4816 |
| 4 | 2 | CONVENTION | diff-wide | em dashes; stale .pmark comment; plan drift | FIXED | 7be4816 |
| 5 | 3 | NIT x2 | web/index.html | Enter-to-submit; aria-expanded/controls; comment accuracy | FIXED | 396ea4b |
| 6 | 4 | WARNING | web/index.html | aria-expanded never reset over a hidden flow | FIXED | 276abaf |
| 7 | 4 | WARNING | web/index.html | asymmetric "works today" tag implied OpenAI broken | FIXED | 276abaf |
| 8 | 4 | NIT | web/index.html | half-typed key parked in hidden field on cold read | FIXED | 276abaf |
| 9 | 5 | WARNING | web/index.html | row-presence read as Connected over a revoked key | FIXED | c3e7835 |
| 10 | 5 | CONVENTION | server.js | /api/accounts caller inventory stale | FIXED | c3e7835 |
| 11 | 5 | NIT x2 | both screens | copy-pairing test; autocomplete=new-password | FIXED | c3e7835 |

### Deferred (recorded in the plan, not dropped)
- Settings' #acct-openai-key lacks the Enter gesture first-run gained (with the #977/#978 Settings batch)
- The Add handler's pre-POST seq bump is comment-only-protected (transient, self-correcting failure)

### Strengths (across iterations)
- Three-valued honest-unknown contract, tested in both directions on every path (iterations 5, 6)
- Supersession token exercised by a genuine gated-fetch race test sharing one extraction scope, not a string assertion (iterations 4, 6)
- Message placement guaranteed by structure (div-balance test that provably fails on the old markup), not prose (iterations 4, 6)
- Security posture: same endpoint, key never echoed/logged, cleared from the field on success and on hide, textContent-only rendering, autocomplete=new-password on both screens (iterations 5, 6)
- Deliberate divergences from Settings and deliberate deferrals named in the plan rather than discovered (iterations 5, 6)

### Validation
Full suite green at each fix round (2453 checks incl. shell suites); validation-log PASSED for the final committed state (hash c83f4a472707); jargon check 0 new hits (plan); eyes-on render of the pane was part of the original build session.
