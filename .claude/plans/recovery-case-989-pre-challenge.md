---
pre_challenge: true
method: challenge-loop
branch: recovery-case-989
diff_hash: 7c97da038df60a26fe9fd01bbdaa26831274be54d191551a6f553412fb23bbf1
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T18:05:22Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 returned zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 5 NITs (+ many STRENGTHs)
**Fixed:** 1 BLOCKER + 3 WARNINGs + 2 NITs | **Deferred:** 1 WARNING + 3 NITs | **Asked:** 0

This loop earned its keep: iteration 1 caught a real BLOCKER (a security-contract
break) that my own "no regression" claim had missed.

Diff base note: local `main` is stale, so reviewers and the hash used `origin/main`.
Reviewed diff: engine/chat.js, server.js, chat.resolvecard-989.test.js, the plan.
No web/ change (engine only) -> #1720 browser gate not triggered.

### Verification (measured, with controls)

- engine/chat.test.js 114/114 (the suite whose :181 security test iter 1's BLOCKER
  broke -- I now run it), chat.resolvecard-989.test.js 6/6, server.test.js
  reply/thread/trust + name-resolution 14/14 (incl. #18 safeKey claimantFor).
- Two perturbation controls, both proven to red: reverting addressable to the bare
  exact match reds the case-fix arm (Casey refused, the reported bug); reintroducing
  safeKey in resolveCard reds the send-stays-stricter arm (Ca.sey would resolve).

### Per-Iteration Breakdown

#### Iteration 1
**New:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTION, 1 NIT
- [BLOCKER] engine/chat.test.js:181 red -- my first cut used store.safeKey (strips),
  so deliver('Ca.sey') resolved to casey and SENT, breaking the security contract
  that the send refuses a sanitise-only name --> FIXED (case-fold only, not safeKey)
- [WARNING] scope over-reach: safeKey strip-tolerance on the send --> FIXED (same)
- [WARNING] test had no strip-dimension arm --> FIXED (added send-stays-stricter arm)
- [NIT] (from a later pass) --> see below

#### Iteration 2
**New:** 0 BLOCKER, 2 WARNINGs, 0 CONVENTION, 2 NITs
- [WARNING] server.js reply/thread routes bare-matched card/askingCard, so a
  mis-cased name skipped the route-level fresh trust-dialog hold + showed presence
  with no question --> FIXED (resolve via chat.resolveCard, case-fold, isNamedOurs kept)
- [WARNING] test docblock still described the rejected safeKey/unified design --> FIXED
- [NIT] resolveCard didn't guard a non-string key --> FIXED
- [NIT] refusal text "by exactly this name" reads odd post-case-fold --> DEFERRED
  (chat.test.js:181 pins it; only fires on a genuine no-case-match; defensible)

#### Iteration 3
**New:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 1 NIT
- [WARNING] a mis-cased name delivers but the thread does not record it
  (appendMessage->threadFile throws when safeKey(name)!==name) --> DEFERRED: PRE-EXISTING
  thread-keying (not diff-introduced; before the fix the send failed outright), client
  told via recorded:false, #989 core (reachable) met; thread-key canonicalisation is a
  scoped follow-up. Documented on the card + plan (team awareness, as the reviewer asked)
- [NIT] the two route resolutions duplicated the resolve-then-require-ours IIFE -->
  FIXED (extracted server.js ourCardByName)

#### Iteration 4
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT
- [NIT] two skills routes (DELETE/POST /api/agent/:name/skills) still bare-match -->
  DEFERRED: out of scope (worker-folder WRITES keyed on the raw name; their strictness
  is deliberate; not diff-introduced). Noted for whoever revisits name resolution.
- **Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/chat.test.js:181 | safeKey strip broke the send security contract | FIXED | case-fold only |
| 2 | 1 | WARNING | engine/chat.js resolveCard | scope over-reach (strip on send) | FIXED | case-fold only |
| 3 | 1 | WARNING | chat.resolvecard-989.test.js | no strip-dimension control | FIXED | added arm |
| 4 | 2 | WARNING | server.js reply/thread | route trust-hold skipped for mis-cased | FIXED | ourCardByName resolve |
| 5 | 2 | WARNING | test docblock | described rejected design | FIXED | rewritten |
| 6 | 2 | NIT | engine/chat.js resolveCard | unguarded non-string key | FIXED | String() guard |
| 7 | 2 | NIT | chat.js addressable/viewport | refusal text "exactly" | DEFERRED | test-pinned; defensible |
| 8 | 3 | WARNING | server.js appendMessage | delivered-but-not-recorded (mis-cased) | DEFERRED | pre-existing thread-keying; follow-up |
| 9 | 3 | NIT | server.js routes | duplicated resolve IIFE | FIXED | ourCardByName |
| 10 | 4 | NIT | server.js:2242,2270 | skills routes bare-match | DEFERRED | out of scope (worker-folder writes) |

### Outstanding questions (ASKED, still unresolved)
None.

### Deferred (surfaced, not dropped)
- Delivered-but-not-recorded for a mis-cased name (iter 3 WARNING) -- pre-existing
  thread-keying; documented on the card as a scoped follow-up.
- Refusal text "by exactly this name" (iter 2 NIT) -- test-pinned, defensible.
- Skills routes bare-match (iter 4 NIT) -- out of scope (worker-folder writes).
- Josh's wake-message suggestion -- a separate enhancement, on the card.

### Strengths (across all iterations)
- Case-fold only, never strip: send stays stricter than the safeKey read gate;
  chat.test.js:181 holds; both dimensions control-proven.
- Send/gate split preserved deliberately (claimantFor NOT unified); the two now agree
  on case and differ on strip, on purpose.
- No wrong-pane action reachable: exact-first + isNamedOurs preference + create.js:413
  lowercasing + the caller's isNamedOurs/isAgentPane gates on the returned card.
- Route card/askingCard/deliver/viewport/paneTarget all resolve through the same
  case-fold, so presence/asking/reach/view/target agree on which card they describe.
- ourCardByName single-sources the route resolution (this PR's own "one derivation" theme).
- The deferred thread-record item is correctly characterised as pre-existing and surfaced.
