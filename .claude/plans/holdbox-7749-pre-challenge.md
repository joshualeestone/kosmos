---
pre_challenge: true
method: challenge-loop
branch: holdbox-7749
diff_hash: db6c79f20827c69801fe7a6c3ca80e4d4a059cf11227c617a65eb9f6a2628465
subdir_audit: passed
timestamp: 2026-11-02T00:13:47Z
converged: false
---

## Two blind review rounds, findings fixed, not converged

Change: a Why box in the hold form and the reason on the task row. Round 2 had no blocker; no third round on its two fixes.

## Round 1
- [BLOCKER] Save sent the whole form, so a wait or reason changed elsewhere while the form was open was overwritten. FIXED, Save sends only what changed and an untouched field follows what is stored.
- [WARN] a reason could not be saved on a passed time. FIXED, the picker is checked only if changed.
- [WARN] a reason-only Save rewrote a time with seconds and recorded a new hold. FIXED, the stored value is restated exactly.
- [WARN] the check did not test an unsaved reason surviving a refresh. FIXED, tested.
- [NIT] field order. FIXED, Why sits below Until.
- [NIT] box width. FIXED, it fills the row.
- [NIT] a long paste is cut silently by maxlength: left.
- [NIT] focus after Save returns to the Wait for field: left.
- [NIT] the Tasks view row does not show the reason, the project task card does: left, noted.

## Round 2
- [WARN] the choice was read after the options were rebuilt, so a vanished task read as an edit. FIXED.
- [WARN] a time in the repeated autumn hour read as changed. FIXED, compared as the picker shows it. Reasoned for the fix; not tested in that hour.
- No fault in the follow branch, the empty baseline, or the conditions the engine would not restate.

## Measured
render-holduntil-7184 headless, light 1400 and dark 390, all pass. Full suite left to CI. No screenshot taken.
