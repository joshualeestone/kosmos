---
pre_challenge: true
method: challenge-loop
branch: firstrun-namestep-1994wiz
diff_hash: 2571fdeb12817453ba65ed9914545d7ddeaef5418eea6b703a300a546bc9fc9d
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T17:27:29Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (1 initial-validation baseline + 5 pre-rebase blind passes + 1 post-rebase blind pass)
**Converged:** Yes (both the 5th pre-rebase pass and the post-rebase pass surfaced zero new BLOCKER/WARNING/CONVENTION findings)

**Rebase note:** after the pre-rebase loop converged, `origin/main` had advanced 7 commits and a
conflict was predicted in `tools/browser-checks.sh` (other agents appended their own checks to the
same batch list). The branch was rebased onto `origin/main`, the list-merge conflict resolved by
keeping all entries (my `render-firstrun-namestep-1994wiz` plus the siblings
`render-firstrun-model-continue-2134` and `render-subprojects-1994`), post-rebase validation re-run
green, and a fresh blind pass run on the rebased diff — it confirmed zero actionable findings and that
the merge is clean (my check present exactly once, no markers, `bash -n` OK). This proof's `diff_hash`
is the post-rebase hash.
**Total findings:** 4 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, 7 NITs
**Fixed:** 3 WARNINGs + 3 NITs | **Deferred:** 1 WARNING (superseded) + 4 NITs | **Asked:** 0

Each blind agent diffed against `origin/main` (the local `main` ref is stale on this machine, so
`main...HEAD` would have shown ~40 files of already-merged work; `origin/main...HEAD` is this branch's
true 9-file scope). Validation ran green on every code-changing iteration; a one-time RED on the
release cut-guard tests was confirmed to be machine contention from a concurrent suite's install
harness (both files pass alone), not this change.

### Per-Iteration Breakdown

#### Iteration 1 — initial validation baseline (6.0)
Full `run-tests.sh` + subdir-CLAUDE.md audit both green on the branch's committed state (the 3 fixes,
their two updated tests, the browser-check, and the plan). Clean baseline; no synthetic finding.

#### Iteration 2 — review pass 1
**New findings:** 1 WARNING, 2 NITs
- [WARNING] web/index.html — Continue unconditionally POSTs the machine-default tz, so `settings.timezone` is persisted even for a person who never touched the picker (changes the "null until set" contract; the Settings "Save to confirm" hint then vanishes) --> initially DEFERRED as a documented conscious-accept; later SUPERSEDED by the iteration-5 best-effort change (commit 9dc10dc9), which also addressed the "blocking" half.
- [NIT] tz `<select>` carries a redundant `aria-label` alongside `<label for>` --> DEFERRED: it mirrors the Settings tz picker (#you-tz:9303 has the identical pair); dropping it would diverge from the picker it was deliberately mirrored from. Harmless (identical text).
- [NIT] `.fhint` not `aria-describedby`-linked --> DEFERRED: consistent with the existing Settings picker; a cross-picker a11y linkage is a separate scoped pass.

#### Iteration 3 — review pass 2
**New findings:** 1 WARNING, 2 NITs (+1 NIT duplicate of iter 2's aria-label)
- [WARNING] web.firstrun-you.test.js — the same-lineage #1345 static test still titled "exactly two questions" and asserted nothing about the restored tz field, so it passed on a three-question screen while its name claimed two --> FIXED (81af5017): title/docblock updated to the #1994 reversal + added an `id="fr-you-tz"` presence assertion; Josh's verbatim know-box quote preserved.
- [NIT] browser-check screenshot + `no page errors` arm ran AFTER the Continue click (shot captured the next step; a next-step paint error could red the arm) --> FIXED (81af5017): both scoped to the name step before the click.
- [NIT] tz-prefill comment "same draft-safety as the fields above" overstated (a `<select>` always has a value) --> FIXED (81af5017): comment corrected.

#### Iteration 4 — review pass 3
**New findings:** 1 WARNING
- [WARNING] web/index.html — the tz-save error branch parsed `await tzRes.json()` AFTER the FR_YOU_GEN guard, putting an await between the guard and the shared-DOM write (unlike the `/api/you` branch above), so a re-entry during the parse could let a stale closure toggle a newer paint's `#fr-next` --> FIXED (7d76b19b): parse hoisted above the guard, mirroring `/api/you`. (This branch was later removed entirely by the iteration-5 best-effort change.)

#### Iteration 5 — review pass 4
**New findings:** 1 WARNING (re-raise), 2 NITs
- [WARNING] web/index.html — a second independent reviewer flagged that a blocking tz-save gates the whole first-run step on a value the person need not have touched --> DECISION + FIXED (9dc10dc9): changed to BEST-EFFORT (await so it lands normally, advance regardless of outcome; name/does still block on their own failure; the tz picker also lives in Settings). Rejected keeping it blocking (bad failure UX) and fire-and-forget-without-await (no chance to save). Weakest premise: a tz-only failure is rare (same local server, defaulted value can never 400), so best-effort almost never drops the zone.
- [NIT] the first-run tz populate/prefill duplicates Settings `paintYouTz` rather than sharing a helper --> DEFERRED: extracting a shared helper touches the Settings code (broader change, collision risk on the 1.2MB file); low drift risk (both mirror the same simple pattern).
- [NIT] the "timezone always persisted" behavior change --> DEFERRED as conscious-accept (documented in the plan's Key decisions); duplicate of iter-2's WARNING note.

#### Iteration 6 — review pass 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings.
- [NIT] plan Verification section still listed the browser-check/run-tests/loop as TODO --> FIXED (60e14807): marked done with the contention note.
- [NIT] browser-check width-contrast arm's 10px margin is thin if the wizard column ever narrows near ~330px --> DEFERRED: fails safe (would false-FAIL, never false-pass) and the column is 900px-viewport-wide; not worth churning a just-reviewed check.
- [NIT] the test's inverted "describe the bad state" failure message reads slightly awkwardly --> DEFERRED: matches the file's existing convention.

#### Iteration 7 — post-rebase blind pass
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no new actionable findings; confirmed the rebase merge is clean.
- [NIT] server.js:4564 GET-handler comment "timezone is null until the operator sets one" now slightly overstates the contract --> DEFERRED: the comment is in unchanged code this PR does not touch; adding server.js for a one-line comment expands the diff and adds a merge surface for a NIT, and the plan already documents the conscious-accept. Worth a one-line update when server.js is next touched.
- [NIT] the best-effort tz `await` has no timeout, so an indefinitely hung (not rejected) POST would stall Continue --> DEFERRED: identical to the existing /api/you PUT (same local server, no timeout), so matching it is the consistent choice; a timeout only on the tz save would diverge, and a hung local-server POST is not a realistic failure mode (the same server just accepted the PUT).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 2 | WARNING | web/index.html | Unconditional tz POST persists machine default; contract/hint change | DEFERRED->SUPERSEDED | conscious-accept; then 9dc10dc9 |
| 2 | 2 | NIT | web/index.html | Redundant aria-label on tz select | DEFERRED | mirrors Settings #you-tz |
| 3 | 2 | NIT | web/index.html | .fhint not aria-describedby-linked | DEFERRED | consistent w/ Settings; separate pass |
| 4 | 3 | WARNING | web.firstrun-you.test.js | "exactly two questions" title on a 3-field step | FIXED | 81af5017 |
| 5 | 3 | NIT | render-firstrun-namestep-1994wiz.js | screenshot/error arm after the click | FIXED | 81af5017 |
| 6 | 3 | NIT | web/index.html | tz-prefill comment overstated draft-safety | FIXED | 81af5017 |
| 7 | 4 | WARNING | web/index.html | await between FR_YOU_GEN guard and DOM write on tz-error branch | FIXED | 7d76b19b |
| 8 | 5 | WARNING | web/index.html | blocking tz-save gates the whole step | FIXED (best-effort) | 9dc10dc9 |
| 9 | 5 | NIT | web/index.html | tz populate/prefill duplicates Settings paintYouTz | DEFERRED | shared-helper refactor out of scope |
| 10 | 5 | NIT | web/index.html | "timezone always persisted" behavior change | DEFERRED | conscious-accept (plan) |
| 11 | 6 | NIT | plan | stale TODO for committed browser-check | FIXED | 60e14807 |
| 12 | 6 | NIT | render-firstrun-namestep-1994wiz.js | thin 10px width-contrast margin | DEFERRED | fails safe |
| 13 | 6 | NIT | web.firstrun-you.test.js | inverted failure message wording | DEFERRED | matches file convention |

### NITs (non-blocking, deferred)
- Redundant `aria-label` on the tz select (mirrors Settings) — iteration 2
- `.fhint` not `aria-describedby`-linked (consistent with Settings) — iteration 2
- tz populate/prefill duplicates Settings `paintYouTz` (shared-helper refactor is a separate pass) — iteration 5
- browser-check 10px width-contrast margin is thin (fails safe) — iteration 6
- test's inverted failure-message wording (matches file convention) — iteration 6

### Strengths (across all iterations)
- Generation-guard (FR_YOU_GEN) discipline preserved across every new await, with parse-before-guard ordering matching the /api/you branch.
- The browser-check verifies wiring not markup: catches the real POST /api/settings, uses computed max-width with a rendered-width contrast, scopes the screenshot/error arms to the name step, and is proven RED (10/12) on the pre-#1994 page.
- The tz save can never falsely 400 the defaulted zone (validTimeZone round-trips the same Intl that populates the select).
- The three #1345-family tests and the plan are all consistent about the deliberate reversal; the two updated guards were reversed (not weakened) and keep their still-true invariants.
- The server.test.js static-pin widening is body-scoped (not a fixed byte window) and still fails loud if the gate/PUT-order/aria-required is removed.
- No em dashes (all five spellings) in any added line; user-facing copy is in Josh's plain voice.
