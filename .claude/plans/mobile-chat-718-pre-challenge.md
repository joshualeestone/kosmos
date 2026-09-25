---
pre_challenge: true
method: challenge-loop
branch: mobile-chat-718
diff_hash: a6a1c99e2cf9491477f372067cce19bc484f997a768cff4f9c67a571ceb5a6a5
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T06:05:02Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

Third proof for this branch, regenerated after a second rebase onto origin/main 293940f6 (conflict
in tools/browser-checks.sh's gated list only, both sides kept). Earlier loops: the pre-rebase loop
converged at iteration 4, the first post-rebase loop converged at its round 4. This loop ran 4 rounds
and converged at round 4.

**Iterations (this run):** 4
**Converged:** Yes
**Total findings (this run):** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 7 NITs
**Fixed:** 4 WARNINGs, 1 CONVENTION (partly: `att` token deferred) | **Deferred:** 1 | **Asked:** 0

Validation on this exact head (75fe6711): tools/run-tests.sh 8931 pass, 0 fail (hash a6a1c99e2cf9,
PASSED read from the log, machine free at the time); subdir audit clean; render-dm-phone-718.js
176 PASS exit 0, Chromium + WebKit. Negative control on origin/main: 17 FAIL (bubbles off-row at
every phone size and at 900, crushed cells at every phone size; 1280 green, as the plan now states).
A 0.6.94 release held the machine from about 00:20 to 00:54 CDT; round 3 was read-only for that
reason and every run above was made after the hold cleared. Origin column: BRANCH throughout.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 recorded (BRANCH fail-safe)
- [WARNING] web/index.html:5280 — the breakable, line-clamped file name was credited with the attachment fix, but the cap on the person's bubble does the work (check green without the name rule) --> FIXED (58a4209f: name rule removed; removing only the cap fails 9 arms)
- [WARNING] render-dm-phone-718.js:118 — no assertion could fail on the name rule --> FIXED by removing the rule
- [NIT] README "previews rendered" overclaim --> FIXED; [NIT] clamp note named the least common break --> moot

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 recorded
- [CONVENTION] render-dm-phone-718.js:1 — surface tokens omit `att` and `att-pic` --> FIXED for `att-pic` (f2214b4b); `att` DEFERRED: as a whole token it matches every JS variable named `att` (an earlier round flagged the same noise for `msg`); the coarse #1720 gate still covers edits
- [NIT] duplicated 28/14 literals uncommented --> FIXED (note added, f2214b4b)

#### Iteration 3
**Reviewer model:** opus (read-only: release hold)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 recorded
- [WARNING] render-dm-phone-718.js:123 — the 1280 fit-its-content assertion measured the agent's row, not the capped person's bubble --> FIXED (75fe6711: a short-named card on the person's row)
- [WARNING] plan Audit 1 — "width-independent" overstated; the 78ch cap already binds at 1280 --> FIXED (reworded; negative control shows red at 900, green at 1280)
- [NIT] preview slots counted, not measured --> FIXED (must sit inside the card; an image slot has no height over file://, stated); [NIT] hidden scrollbars in wide arms --> FIXED (shown in Chromium); [NIT] viewport widths vs mobile emulation --> stated in the header

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged** — "No issues found." The reviewer independently re-ran the check and three mutated
copies (cap removed, table rule removed, gutter de-mirrored); each went red on its own assertion.

### Final Ledger (this run)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:5280 | BRANCH | name rule credited, cap does the work | FIXED | 58a4209f |
| 2 | 1 | WARNING | render-dm-phone-718.js:118 | BRANCH | no assertion guards the name rule | FIXED | 58a4209f |
| 3 | 2 | CONVENTION | render-dm-phone-718.js:1 | BRANCH | surface tokens omit att / att-pic | FIXED (att-pic) / DEFERRED (att) | f2214b4b; `att` too broad |
| 4 | 3 | WARNING | render-dm-phone-718.js:123 | BRANCH | desktop assertion aimed at the wrong row | FIXED | 75fe6711 |
| 5 | 3 | WARNING | plan Audit 1 | BRANCH | width-independence overstated | FIXED | 75fe6711 |

### NITs
- All NITs of this run addressed in 58a4209f, f2214b4b and 75fe6711 (see per-iteration notes)

### Strengths
- The cap on the person's bubble fixes both the file-name and the wide-table overflow at the cause
- Every credited rule has a control that turns its own assertion red when removed alone
- Scoped to #d-dmthread; Kano measured the room independently and adopted the same cap there
