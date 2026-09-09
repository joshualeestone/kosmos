---
method: challenge-loop
branch: bc-map-helper
timestamp: 2026-09-09T05:05:25Z
diff_hash: 42a15b95cfc9fed6f6a4779731d9da68e7911a19986523e33ce84ce26fc4b0c9
---

# Challenge-loop proof: bc-map-helper (kosmos#2518 surface-map query helper)

Nine blind, independent iterations, model varied every pass for cross-model independence
(kosmos#2032): iters 1-2 Sonnet, 3 Opus, 4 Sonnet, 5 Opus, 6 Sonnet, 7 Opus, 8 Sonnet, 9 Opus.
The reviewers of the last three passes each mutation-tested the drift arms on a scratch copy and
confirmed them genuinely red-capable. Converged at iteration 9: zero new BLOCKER/WARNING/CONVENTION.

## Scope reviewed
`tools/bc-surface-map.sh` (new), `tools/test-bc-surface-map.sh` (new, 13 arms),
`.claude/plans/bc-map-helper.md` (new), and one `package.json` line wiring `test:shell`. The sibling
gate `tools/lib/browser-check-surface-gate.sh` was read for fidelity but is NOT modified by this branch.

## Per-iteration ledger

#### Iteration 1 (Sonnet)
[WARNING] `covering` was described as agreeing with the gate, but it is a COVERAGE SUPERSET, not a
staleness verdict. FIXED: reworded header + contract; the gate additionally skips updated/overridden checks.

#### Iteration 2 (Sonnet)
[WARNING] The no-drift claim ("cannot disagree / shared byte-for-byte") overstated a byte-COPY as a shared
function. [WARNING] the superset arm was not red-capable. FIXED: corrected the claim to "copied, drift-guarded
by a test"; made the superset arm re-invoke `covering` with the update env, added a drift-detector arm.

#### Iteration 3 (Opus)
[WARNING] source-scope over-report: the gate diffs ONLY web/index.html but `covering` matched all of stdin,
so `git diff | covering` over-reported a mapped token changed in a NON-web file. FIXED: web-scope the diff
input via awk (arm 2b, red-capable). [WARNING] arms 3/3c asserted `-ne 0`, false-green on a gate rc=127
invocation failure. FIXED: assert `-eq 1` (the gate's real refusal code). [NIT] arm 3b comment overstated.

#### Iteration 4 (Sonnet)
[WARNING] a plain id-list line starting with a diff-marker prefix (`--- `/`+++ `/`@@ text`) misclassified
the whole input and silently dropped every id. FIXED: key the headerless-hunk branch on a real hunk header
`^@@ -[0-9]` (arm 6b, red-capable). [WARNING] stale plan claims (a nonexistent shared function, an untrue
"gate suite still green"). FIXED: corrected the plan; verified the gate suite is 12/12 green from repo root.

#### Iteration 5 (Opus)
[WARNING] the drift guard was OVERSTATED: arms 3/3c only exercised plain tokens, so a metachar-escape or
case-key divergence slipped past (mutation-proven). FIXED: added arm 3d (a '.'-metachar token + mixed-case
key), mutation-verified; softened the claim to "strong check, not a proof".

#### Iteration 6 (Sonnet)
[BLOCKER] the drift arms were blind to a whole-token BOUNDARY drift on either side (mutation-proven both
directions). FIXED: added arm 4b (a substring-superset gate cross-check), mutation-verified red-capable BOTH
directions; corrected the docs to name arm 4b for the boundary path.

#### Iteration 7 (Opus)
No BLOCKER, no WARNING. Mutation-proved every match path reds a drift arm on either side. [NIT] usage string
printed a literal `\t` -- FIXED. [NIT] arm 3b half a no-op today -- DEFERRED (honestly disclosed future guard).

#### Iteration 8 (Sonnet)
No BLOCKER, no code WARNING; mutation-proved all six drift/robustness arms. [CONVENTION] a stale plan Step 3
sentence referencing an abandoned gate refactor -- FIXED, Step 3 rewritten to the 13 real arms. [WARNING,
inherited/out-of-scope] a `++`/`--` content line drops as a `+++`/`---` header in BOTH helper and gate (they
miss it identically, no disagreement) -- DISCLOSED in the contract.

#### Iteration 9 (Opus)
[BLOCKER] none. [WARNING] none (hunted for a helper/gate disagreement, could construct none). [CONVENTION]
none. Mutation-tested every load-bearing arm -- all non-vacuous. [NIT] the plan discloses the `diff --git`
id-list pathology but not the symmetric unreachable `@@ -<digit>` one; [NIT] a CRLF-diff edge on the awk
anchor. Both unreachable for real inputs in this unix repo. Verdict: ship.

### Final Ledger
- Code (`tools/*.sh`) converged: clean and mutation-proven across iterations 7 (Opus), 8 (Sonnet), 9 (Opus).
- All 13 test arms pass (0 FAILED); the helper-vs-gate drift arms (3, 3b, 3c, 3d, 4b) and robustness arms
  (2b, 6b) are each mutation-verified red-capable, covering the boundary match, the metachar escape, the
  case-insensitive key, the web-scoping, and the id-list shape classifier.
- Zero em/en dashes on any added line (codepoint scan).
- [NIT] deferred (below convergence bar, genuinely not code issues): the `@@ -<digit>` id-list token and the
  CRLF-diff anchor are both unreachable for real DOM ids/tokens in this unix repo; the `++`/`--` content-line
  drop is an inherited gate limitation (parity is the goal), disclosed in the contract. Extracting one shared
  parse/match function used by both the helper and the gate remains a clean, lower-risk follow-up.
