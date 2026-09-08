---
pre_challenge: true
method: challenge-loop
branch: task-duedate-768
diff_hash: 371cfeeec171e5f1aa5ad4b6a0e421d7e0324a53fb5b491983ce63a11d6a2dbe
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T14:09:14Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (the first blind review produced zero BLOCKER/WARNING/CONVENTION findings; only two non-blocking NITs)
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 0 | **Deferred:** 2 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no actionable findings.
- [NIT] engine/tasks.js dueProblem — the UTC round-trip rejects an absurd year <1000 (e.g. `0026-12-25`, where Date.UTC maps 0-99 to 1900-1999) --> DEFERRED (the reviewer agrees rejecting a nonsense year is arguably correct; all real due dates are 4-digit >= 1000, so this is correct behavior, not a defect)
- [NIT] server.js due route — a parseable body that omits `dueDate` (e.g. `{}`) resolves to undefined -> treated as "clear" -> 200 --> DEFERRED (defensible "missing = clear" convention; the frontend always sends the key `{ dueDate: value || null }`, so it never hits this; the reviewer rated it low value)
- 5 STRENGTHs: robust TZ-safe date validation (rejects malformed AND impossible dates via a UTC round-trip with no local-time conversion anywhere); XSS closed twice over (esc() at the render site + DUE_RE constrains the stored value to digits/dashes; the picker uses .value); refused writes provably leave stored state untouched (both engine and server tests assert the known-good baseline survives), setDue no-op-safe; the guard reversal is clean and honest (the "NO DUE DATE FIELD" comment fully removed, the flipped test pins presence + comment-absence, a new paint test added); scope matches #768 exactly (no create-modal field, no scheduler, no stale "no due date" references anywhere in the tree).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | engine/tasks.js dueProblem | rejects year <1000 via UTC round-trip | DEFERRED | correct behavior (nonsense year); real dates are 4-digit |
| 2 | 1 | NIT | server.js due route | missing `dueDate` key treated as clear | DEFERRED | defensible convention; frontend always sends the key |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking)
- dueProblem year<1000 rejection (iter 1) — DEFERRED
- due route missing-key = clear (iter 1) — DEFERRED

### Strengths
- The date validation is genuinely robust and timezone-safe (constructs and reads back via UTC; stores/renders the raw YYYY-MM-DD string with no local-time Date conversion).
- XSS surface closed twice over: escaped at the render site, and DUE_RE constrains the value to digits/dashes before storage.
- Refused/invalid writes provably leave stored state untouched (asserted with a known-good baseline control); setDue is no-op-safe.
- The design reversal (adding a due date, flipping the guard) is done cleanly and on Josh's documented #768 authorization, with the stale comment removed and the test flipped to pin the new behavior.
- The browser check drives the real board and round-trips the date (fill -> save -> reload -> repaint -> "Due date set to 2026-12-25" in the Activity list) — a real failable proof, not a client-only echo.
