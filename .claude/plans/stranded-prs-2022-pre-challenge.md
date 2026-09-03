---
pre_challenge: true
method: challenge-loop
branch: stranded-prs-2022
diff_hash: 047bace8d652348816b565e97f40a29df6f2c054c40d88af7db973415807f675
subdir_audit: passed
timestamp: 2026-09-03T17:08:25Z
iterations: 8
converged: true
---

# Challenge-loop proof: stranded-prs-2022 (kosmos#2022)

A read-only detector `tools/stranded-prs.sh` that surfaces OPEN, non-draft PRs idle past
a threshold with the fields a PM needs to route them (CI rollup, mergeStateStatus with
CONFLICTING/BLOCKED/BEHIND/UNKNOWN flagged, a mergeable cross-check, an ISSUE-CLOSED
overruled smell, a FALSE-HOLD-SUSPECT backstop). It NEVER merges. Plus a network-free
test (stub gh + fixed clock), wired into test:shell.

Diff: `tools/stranded-prs.sh`, `tools/test-stranded-prs.sh`, `package.json`,
`.claude/plans/stranded-prs-2022.md`. No web/ change, no node engine change.

## Convergence

Converged after 8 iterations. A long loop that earned it: the core merge-safety guarantee
(only CLEAN + MERGEABLE + CI PASS + issue-open + no false-hold reads "safe") was proven
false-safe-proof, and the loop drove out a series of real CI-classification, merge-state,
TSV, and issue-resolution defects. Iteration 8 found zero. `bash -n` clean, 43/43 test,
zero control chars, zero em dashes at convergence.

## Iteration findings (verbatim markers)

#### Iteration 1
- [WARNING] ACTION_REQUIRED conclusion fell through to PASS. FIXED (added ACTION_REQUIRED/STARTUP_FAILURE/STALE to the FAIL set).
- [WARNING] BLOCKED/BEHIND mergeStateStatus never flagged. FIXED (flagged; later generalized to only-CLEAN-is-safe).
- [CONVENTION] max-age validator accepted multi-dot garbage. FIXED.
- [CONVENTION] bare "screenshot" in the false-hold verification regex. FIXED (require the automated browser-check signal).

#### Iteration 2
- [WARNING] StatusContext state EXPECTED fell through to PASS. FIXED (EXPECTED -> PENDING).
- [WARNING] mergeStateStatus UNKNOWN read "safe". FIXED (flagged; mergeable field cross-checked).
- [WARNING] TSV read used IFS=tab (whitespace), folding an empty body into the title. FIXED (@tsv then tr to US 0x1F, IFS=US).
- [CONVENTION] false-hold verification recall. DEFERRED (per "build a clock, not a language model for holds").

#### Iteration 3
- [WARNING] a field containing a literal 0x1F could break the US-delimiter parse. FIXED (jq gsub strips 0x1F from title/body).
- [WARNING] UNSTABLE/HAS_HOOKS mergeStateStatus read "safe". FIXED (only CLEAN is safe + a catch-all).
- [CONVENTION] dead ''-arm in the mergeable cross-check. FIXED (removed).

#### Iteration 4
- [WARNING] CANCELLED conclusion reads CI-FAIL. DEFERRED (safe over-flag direction; the PR still lists and routes to a human; never a false-safe).
- [CONVENTION] no tab-in-field test. FIXED (added #895).

#### Iteration 5
- [WARNING] issue_of body arm greedy sed took the LAST Addresses #N. FIXED (grep -o + head -1, first match).
- [WARNING] issue_of trailing arm matched a mid-branch number and short-circuited before the leading arm. FIXED (each arm returns only on a match).
- [CONVENTION] helper temporaries lacked `local`. FIXED.

#### Iteration 6
- [WARNING] issue_of missed a path-prefixed issue (fix/1951-import-msg). Tried a /NNNN arm...
- [WARNING] body `addresses #N` lacks a leading word boundary (readdresses #77). DEFERRED (contrived, create-pr parity, over-flag safe direction, portable fix disproportionate).

#### Iteration 7
- [WARNING] the /NNNN arm over-resolved throwaway path segments (wip/2 -> 2), drawing spurious ISSUE-CLOSED misroutes. REVERTED the arm (path-prefixed extraction is inherently ambiguous; create-pr does not attempt it). The path-prefixed miss is now a DEFERRED missed-hint.

#### Iteration 8 (converged)
- [BLOCKER] None. [WARNING] None. [CONVENTION] None.
- [STRENGTH] the merge guarantee holds: "safe" requires CLEAN + MERGEABLE + CI PASS + issue-open + no false-hold; every other state fails closed via a named arm or the catch-all. issue_of correct post-revert; TSV/0x1F sound; test non-vacuous.

### Final Ledger

No open BLOCKER/WARNING/CONVENTION. Three deliberate deferrals, each a code-read judgment
and none a false-safe: CANCELLED-reads-CI-FAIL (safe over-flag), the body word-boundary
(contrived, create-pr parity), and a path-prefixed issue number (create-pr scope boundary;
a /NNNN heuristic misroutes more than it helps). Converged.
