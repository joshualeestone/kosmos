---
pre_challenge: true
method: challenge-loop
branch: import-addinplace-2419
diff_hash: a24b29e7378843f5a2d1f72fee218e433f583e7935a2c690588d9fa0d99d7b72
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T17:16:03Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 found 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs)
**Total findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 8 NITs (plus 2 synthetic CI-gate BLOCKERs from the initial validation pass)
**Fixed:** 1 BLOCKER + 3 gate/quality items + 2 synthetic | **Deferred:** 2 WARNINGs, 1 CONVENTION-carryover, 8 NITs (with reasoning) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (initial validation pass, 6.0)
**New findings:** 2 synthetic BLOCKERs from the CI gates
- [BLOCKER] initial-validation: browser-checks-wired.test.js (#1387) -- the new check was not wired into the runner --> FIXED (bcad47d3, wired into tools/browser-checks.sh no-URL loop)
- [BLOCKER] initial-validation: browser-checks-reason-grep.test.js -- EXPECTED_SITES count stale --> FIXED (9d2adf1f, 67->68 with a provenance comment; catch-sites unchanged at 42)

#### Iteration 2 (two independent blind reviewers)
**New findings:** 1 WARNING, 3 NITs
- [WARNING] web/index.html -- the Add button's aria-label was never updated on success, so a screen reader still hears "Add to Kosmos" and WCAG 2.5.3 label-in-name breaks (both reviewers) --> FIXED (b21fdffc, aria-label -> "Added to Kosmos, <name>")
- [NIT] web/index.html -- `label` sent only when displayName non-empty; the own-role create refuses without a label --> FIXED (b21fdffc, `label || name` fallback pins the cross-module invariant)
- [NIT] browser-check -- control covered a parse refusal but not a create refusal --> FIXED (b21fdffc, added a create-refusal control)
- [NIT] no Undo on import rows (accidental-press recovery differs from the sibling found rows) --> DEFERRED: Josh's spec for this screen is add + a green check; undoing an imported CREATE is a delete (not the found-row disconnect, which the engine refuses for Kosmos-created folders), a more destructive action he did not ask for; an accidental add is recoverable from the board. Documented in code + on the card.
- [NIT] no live-region success sentence --> DEFERRED: Josh ruled "no sentence on success" for these rows; the aria-label update keeps the static accessible name correct.

#### Iteration 3
**New findings:** 1 BLOCKER, 1 WARNING, 2 NITs, 1 CONVENTION
- [BLOCKER] web/index.html -- create-success was gated NEGATIVELY (fail only on outcome==='refused'), so a PARTIAL (HTTP 200, rolled back, nothing on disk) and any error body (400 {error}, 403, 5xx) rendered a false green "Added to Kosmos" --> FIXED (a42e1634, positive gate `res.ok && out.outcome === 'created'`, mirroring canonical create-go; partial is treated as "not made")
- [WARNING] browser-check never exercised the partial/error path --> FIXED (a42e1634, added PARTIAL and ERROR controls asserting neither goes green)
- [NIT] create stubs used `ok:true`/`ok:false` fields the real route never sends --> FIXED (a42e1634, stub shapes matched to the real route)
- [NIT] parse-error path read only `data.because`, mislabelling a server error --> FIXED (a42e1634, reads `data.because || data.error`)
- [CONVENTION] em dashes in the plan file --> FIXED (a42e1634, replaced with hyphens)

#### Iteration 4
**New findings:** 1 WARNING, 1 NIT
- [WARNING] success disables the button (blurs focus) and the aria-label change on a disabled element is not announced; the inline comment overstated it as "the AT receipt" --> the behavior is DEFERRED (parity with the accepted sibling found/scan rows, which also disable-on-success and emit no success sentence per Josh's ruling; a broader status-announcement change applies to both surfaces and is out of scope), and the inaccurate COMMENT was FIXED (bc581196). The reviewer's premise that the sibling keeps the button enabled was verified inaccurate (the sibling disables too, adding an Undo).
- [NIT] OpenAI-provider imports one-click-fail (no account picker) --> DEFERRED: documented; the reason surfaces on the row; Josh's seed agents are Claude. Flagged on the card for later.

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** -- no new actionable findings.
- [NIT] `.fr-importsaid` carries both role="status" and aria-live="polite" (redundant) --> DEFERRED: harmless and matches the sibling `.fr-foundsaid` convention.
- [NIT] a parsed name/displayName > 80 chars makes the create refuse --> DEFERRED: handled honestly (reason surfaces, button re-enables), consistent with the fail-visibly posture.
- [NIT] the browser-check IIFE has no top-level `.catch()` --> DEFERRED: all work is inside try/catch/finally, matches the sibling self-booting checks.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/browser-checks.sh | new check unwired | FIXED | bcad47d3 |
| 2 | 1 | BLOCKER | browser-checks-reason-grep.test.js | EXPECTED_SITES stale | FIXED | 9d2adf1f |
| 3 | 2 | WARNING | web/index.html | aria-label not updated on success | FIXED | b21fdffc |
| 4 | 2 | NIT | web/index.html | label sent only when displayName set | FIXED | b21fdffc |
| 5 | 2 | NIT | render-import-add-inplace-2419.js | no create-refusal control | FIXED | b21fdffc |
| 6 | 2 | NIT | web/index.html | no Undo on import rows | DEFERRED | Josh spec: add + check; undo = delete |
| 7 | 2 | NIT | web/index.html | no live-region success sentence | DEFERRED | Josh: no success sentence |
| 8 | 3 | BLOCKER | web/index.html | negative create-success gate -> false green | FIXED | a42e1634 |
| 9 | 3 | WARNING | render-import-add-inplace-2419.js | partial/error untested | FIXED | a42e1634 |
| 10 | 3 | NIT | render-import-add-inplace-2419.js | stub `ok` field not in real route | FIXED | a42e1634 |
| 11 | 3 | NIT | web/index.html | parse-error mislabelled | FIXED | a42e1634 |
| 12 | 3 | CONVENTION | plan file | em dashes | FIXED | a42e1634 |
| 13 | 4 | WARNING | web/index.html | disabled-button announce gap + overstated comment | DEFERRED (parity) + comment FIXED | bc581196 |
| 14 | 4 | NIT | web/index.html | OpenAI one-click-fail | DEFERRED | documented, fails visibly |
| 15 | 5 | NIT | web/index.html | redundant role+aria-live | DEFERRED | matches sibling |
| 16 | 5 | NIT | engine boundary | >80-char label refuses | DEFERRED | fails honestly |
| 17 | 5 | NIT | render-import-add-inplace-2419.js | IIFE no top-level catch | DEFERRED | matches siblings |

### NITs (non-blocking, deferred with reasoning above)
- no Undo on import rows (iter 2); no success sentence (iter 2); OpenAI one-click-fail (iter 4); redundant role+aria-live (iter 5); >80-char label (iter 5); IIFE catch (iter 5).

### Strengths (across all iterations)
- The positive create-success gate correctly treats only `res.ok && outcome==='created'` as a receipt (partial/refused/error all fail), verified against engine/create.js OUTCOME values and server.js (iter 3, 4, 5).
- tellKosmos omission is a real fix, not a regression: verified against server.js (`wanted = tellKosmos !== false`) + engine/ping.js (gates on the global setting), so it defers to the person's ping and fixes the old form-path stale-OFF bug (iter 2, 3, 4, 5).
- Create body faithfully mirrors canonical create-go (role='own', label always for own via `label || name`, provider only-non-default), re-entrancy soundly guarded, removed functions leave no dangling refs, paste path untouched, count-guards all updated (iter 3, 4, 5).
- The new browser-check drives the shipped page with four genuinely discriminating controls (parse-refusal, create-refusal, partial, error) that each red on a false success (iter 3, 4, 5).
