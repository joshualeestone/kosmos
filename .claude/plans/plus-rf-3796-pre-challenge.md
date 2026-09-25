---
pre_challenge: true
method: challenge-loop
branch: plus-rf-3796
diff_hash: 84355c40f9688b60417fcb9c6cab1263d61d30bea3aefd708833e130dfe57f50
subdir_audit: passed
timestamp: 2026-09-25T22:44:18Z
converged: true
---

## Challenge loop: plus-rf-3796 (render-fields and the #3808 Kosmos+ wizard; blocked the 0.6.95 re-cut)

Five blind reviews, sonnet and opus alternating. Review 5 returned no BLOCKER, WARNING or
CONVENTION (one NIT: "1 button" is singular if the set grows; not acted on). Converged.

## Findings and dispositions
- [BLOCKER] (1) the first version's premise was wrong: render-fields never sets body.plus-active,
  so both failures were the wizard measured on the bare page ground, not a design choice or a
  real defect --> FIXED: the CSS change was reverted (web/index.html unchanged); the fields and
  the button are skipped by name with the true reason.
- [WARNING] (1) plan stale; [WARNING] (1) primary blue on a secondary border --> moot after revert.
- [CONVENTION] (1) const between a comment and its target --> FIXED.
- [WARNING] (2) render-plus-signin-3478 does not measure border or stroke contrast on the card, and
  is chromium only --> DISCLOSED in the comment and plan; filed kosmos#3841.
- [WARNING] (2) weakest premise stale --> FIXED. [CONVENTION] (2) one set, two key formats -->
  FIXED: PLUS_WIZARD_FIELDS ('#') and PLUS_WIZARD_BUTTONS (bare).
- [WARNING] (3) the same-fill check and the .uprime buttons also run off-ground --> DISCLOSED
  (they pass by margin), added to #3841. [CONVENTION] (3) wording --> FIXED.
- [CONVENTION] (4) skips were silent --> FIXED: printed per engine and scheme; a listed id no
  longer on the page fails.

## Proof
- Red: render-fields on main 0da7100a4 (Mortals): the 7 flips + the enrol-sms boundary.
- Green: render-fields and render-plus-signin-3478 on 7adfc0517 (Mortals): PASS, skips printed,
  the stale-id guard quiet (every listed id measured).
- browser-checks indexed/selectors/reason-grep: 10/10.
