---
pre_challenge: true
method: challenge-loop
branch: wiz-contrast-3841
diff_hash: d3949b586a04099ba3c91b7085eb583f53fae3f048ceee7dde272d241cf75729
subdir_audit: passed
timestamp: 2026-09-25T23:44:51Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 blind review pass (sonnet), which ran live mutations.
**Converged:** Yes. 0 blockers, 2 warnings (both taken), 0 nits.

## Iteration 1 (sonnet)
- [WARNING] max(fill, edge) for primaries masked a card-coloured face behind a good 1px edge (demonstrated live). Taken: the face and the edge are separate arms, and the reviewer's mutation now fails in both engines.
- [WARNING] The check was Chromium only, although the card asked for both engines; gradient serialisation can differ. Taken: a WebKit pass runs the same in-page WIZ_SEP in both themes.
- [STRENGTH] The reviewer verified live:
  - the parser (comma and space/slash syntax), the compositing, and the WCAG maths;
  - that worst() returns 0 on an unparseable colour, so the arm fails loudly;
  - the field set is 7, and the primaries are the card's 7 plus Start over and Done.

## Measured
- Each arm perturbed red:
  - a field border set to the card's colour: 1.00;
  - the secondary stroke made transparent: 1.00;
  - the primary fill and edge set to the card's colour: 1.00;
  - the face alone set to the card's colour, in Chromium and WebKit.
- render-plus-signin-3478 passes in full. The reason-grep and selectors guards are green.

## Weakest premise
- 1.1:1 is render-fields' bar and the card's floor, far below WCAG's 3:1 for non-text. Today the fields measure 3.08 to 3.74, the stroke 2.22 and the primaries well above, so a regression toward invisible is caught, but a slide from 3:1 to 1.2:1 is not.
