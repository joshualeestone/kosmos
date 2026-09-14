---
pre_challenge: true
method: challenge-loop
branch: room-idreject-2702
diff_hash: 0cf08a5b9c3287dadd58f141c02f76e83685373ec34ce38ad21758e76768b2d8
validation: passed
subdir_audit: passed
timestamp: 2026-09-14T15:48:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind reviews; 6.0 initial validation passed clean, so iteration 1 was the first reviewer)
**Converged:** Yes (iteration 2 found no actionable findings; convergence witnessed by two models, opus + sonnet)
**Total findings:** 5 NITs (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs)
**Fixed:** 1 (a NIT, comment accuracy) | **Deferred:** 4 (NITs) | **Asked (awaiting user):** 0

The change: install/kosmos REJECTS a project id carrying a disallowed character (via a shared
`require_valid_project_id` helper) instead of STRIPPING it, in cmd_room (read), cmd_room
(reopen), and cmd_task -- closing a PRIVACY leak (a garbled id like `qakosmos663!!!` was
stripped to the real `qakosmos663` and opened its room). Both blind passes found no
correctness, security, or convention issue; the bash semantics, URL-safety, and the
red-capable test were independently validated by both.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty at iteration 1)
- [NIT] install/kosmos:1061 -- the helper comment overstated "the same sentence the board's 404 uses" (the reopen path's 404 is worded differently) --> FIXED (3f45610da): reworded to "there is no project by that name -- the room-read route's own 404 wording".
- [NIT] install/kosmos:1066 -- an all-dots id (`..`) passes the slug check (dots are allowed) --> DEFERRED: not a regression (the old sed also preserved dots), low-risk against a local board with fixed routes, and path-traversal hardening is a separate concern out of this fix's scope.
- [NIT] cli.room-idreject-2702.test.js:83 -- only the `task list` reject arm is directly tested --> DEFERRED: all four task subcommands read the single `esc_project` validated once, so they are covered by construction; a direct write-arm assertion would only make it explicit.

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per kosmos#2032)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (both NITs are on pre-existing BRANCH lines, not the iteration-1 comment fix)
**Duplicates of prior findings (confirmed resolved):** the iteration-1 comment-wording NIT was independently confirmed resolved (iteration 2 flagged the reopen 404 wording as pre-existing and noted the room-read path already matches the helper).
- [NIT] install/kosmos:1546 -- cmd_room reopen's server-404 branch is worded/capitalized differently from the helper's rejection --> DEFERRED: pre-existing (not introduced by this diff); the plain room-read 404 body DOES match the helper; aligning reopen's server-side sentence is a separate wording cleanup.
- [NIT] install/kosmos:1563 (and 1531, 1857) -- the `esc_project`/`esc_rproj` names are now cosmetically stale (nothing is escaped; `esc_project="$project"` is a pass-through after validation) --> DEFERRED: harmless per the reviewer; the variable's role (the id placed in the URL) is unchanged, and renaming across the URL call sites is churn with miss-risk disproportionate to a cosmetic prefix connotation.
**Converged** -- no actionable findings from a second, different model.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | install/kosmos:1061 | BRANCH | Comment overstated "same sentence the board's 404 uses" | FIXED | 3f45610da |
| 2 | 1 | NIT | install/kosmos:1066 | BRANCH | `..` id passes the slug check (dots allowed) | DEFERRED | not a regression; path-traversal hardening out of scope |
| 3 | 1 | NIT | cli.room-idreject-2702.test.js:83 | BRANCH | Only task-list reject arm directly tested | DEFERRED | covered by construction (single validated esc_project) |
| 4 | 2 | NIT | install/kosmos:1546 | BRANCH | reopen 404 wording differs from the helper | DEFERRED | pre-existing; room-read already matches |
| 5 | 2 | NIT | install/kosmos:1563 | BRANCH | `esc_` variable names now cosmetically stale | DEFERRED | harmless; rename churn/risk disproportionate |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Listed in the ledger above (5 total: 1 fixed, 4 deferred with reasoning).

### Strengths (across all iterations)
- The `case "$1" in *[!A-Za-z0-9._-]*)` reject uses the exact allowed set the old sed used, so no previously-valid id is newly rejected; only a disallowed id changes from silent truncation to an explicit refusal (verified in both passes: bad id rejected, valid id passes, empty id passes to the caller's own guard).
- Removing the sed strip is URL-safe: the validated slug set contains no `/ ? & = # %` or whitespace, so the raw id into the URL path/query cannot inject or break; all six id-in-URL sites funnel through the three helper calls, no call site missed (cmd_post/cmd_react send the id in a JSON body, so they were never exposed and correctly untouched).
- The four-test suite is genuinely red-capable: the stub board returns success for ANY id, so a still-stripping CLI would exit 0 on the bad id; the fix rejects it client-side (board never hit, asserted via hits.length === 0), and the CONTROL proves the valid id reaches the board unstripped. `bash -n install/kosmos` clean; 4/4 node tests.
- No em dashes anywhere in the diff (house style clean).
