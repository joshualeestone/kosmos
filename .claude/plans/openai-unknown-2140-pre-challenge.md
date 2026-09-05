---
pre_challenge: true
method: challenge-loop
branch: openai-unknown-2140
diff_hash: c35bc5492769940483232609a879380b59e0f08e202e98773084d501e7674920
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T07:16:45Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 actionable (0 BLOCKERs, 0 WARNINGs, 1 CONVENTION-class dead-code NIT), plus 3 later NITs, 11 STRENGTHs across both passes
**Fixed:** 1 | **Deferred:** 0 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 dead-code NIT (acted on).
- [NIT] engine/openaiaccounts.js — `openaiFamilyOf` became dead code once both its callers
  (`chatModelsFromList`, `chatRunnableIds`) migrated to the new `openaiModelClass`; it was never
  exported, so zero call sites remained. --> FIXED (commit 3e495e19): removed the function and
  pointed its ordering-note comment at `openaiModelClass`; corrected the plan's "callers unchanged"
  line. Engine tests 76/76 still pass; a full worktree grep confirms zero remaining references.
- 5 STRENGTHs: three-way split correct and well-guarded; collapse/#2191 cannot mix a chat and an
  unknown row or lose the unverified flag; default selection cannot pick an unverified model and
  cannot crash on undefined; no #1026 regression and no runnable-set hole; no em-dash violations.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (2 NITs).
**Converged** — a fresh blind reviewer on the post-removal code found no actionable issues and
independently confirmed: the `openaiFamilyOf` removal is complete and safe (full-worktree grep
returns zero references, exit 1); denylist-before-family ordering is sound (`o5-audio` control);
no `.default`-on-undefined crash across empty / all-unknown / all-lite lists; #2191 collapse cannot
mix classes; #1026 preserved with no runnable-set hole; no em-dash violations.
- [NIT] the all-lite-verified default fallback and mixed lite+unknown default case are correct but
  lack a dedicated test (coverage-only; behavior is right). Documented, not acted on.
- [NIT] `OPENAI_UNKNOWN_RANK = 999` is a hardcoded sentinel that only stays last while family ranks
  stay well below it (currently 0-7, a 992 margin). Fine today; reviewer said "not required".
  Documented, not acted on — acting would change the diff for zero behavioral benefit.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | dead-code | engine/openaiaccounts.js | `openaiFamilyOf` unused after migration to `openaiModelClass` | FIXED | 3e495e19 |

No BLOCKER / WARNING / CONVENTION findings survived.

### NITs (non-blocking)
- [NIT] engine/openaiaccounts.js — all-lite-verified / mixed-default fallback has no dedicated test (coverage-only) (iteration 2)
- [NIT] engine/openaiaccounts.js — `OPENAI_UNKNOWN_RANK = 999` sentinel margin (iteration 2)

### Strengths
- The chat / nonchat / unknown split is correct; denylist checked before family match (iterations 1 and 2)
- #2191 collapse cannot merge a chat row with an unknown row or lose the unverified flag (iterations 1 and 2)
- Default selection is confined to verified rows and guarded against undefined; an unverified model is never default (iterations 1 and 2)
- #1026 preserved (nonchat always dropped, even beside an unknown id); no validation hole in the runnable set (iterations 1 and 2)
- No em-dash violations in the new user-facing strings; the marker rides in the label so the dropdown shows it (iterations 1 and 2)
- The dead-code removal is complete and safe (zero remaining references) (iteration 2)

### Validation
Full suite ran clean on a freed box: `tests 4552 / pass 4552 / fail 0`, `Done in 252.21s`,
`validation-log: validation PASSED`. Earlier runs were blocked by a release machine-claim (Baron's
0.6.32 cut) and by a dirty-worktree flag caused by editing during a run; the final run was on the
clean committed tree after the release cut cleared. No `web/` change, so the browser-check gate does
not apply.
