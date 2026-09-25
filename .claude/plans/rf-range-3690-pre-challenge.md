---
pre_challenge: true
method: challenge-loop
branch: rf-range-3690
diff_hash: 03142c01acd2781d0a8fd214eb5bd4618b26a0fac72711a0b6e191c4272f707d
subdir_audit: passed
timestamp: 2026-09-25T20:55:22Z
converged: true
---

## Challenge loop: rf-range-3690 (render-fields and #3690's swarm sliders; blocked the 0.6.95 cut)

Seven blind reviews, sonnet and opus alternating. Review 7 returned no BLOCKER or WARNING; its
one CONVENTION is deferred with the reason below. Converged.

## Findings and dispositions
- [WARNING] (1) the proof counted two sliders where four exist --> FIXED: measured 89 to 85
  fields, exactly the four swarm sliders.
- [CONVENTION] (1) the comment named two of four sliders --> FIXED.
- [WARNING] (2) "a slider paints no fill" was argued, not measured --> FIXED: MEASURED on a test
  page in chromium and webkit with a positive control (appearance:none + white reads white; a
  native slider with an explicit white background reads the card colour).
- [WARNING] (3) a blanket type=range exclusion would stay silent if a slider were restyled to
  paint --> FIXED: only NATIVE sliders (appearance not none) are skipped, as the select check
  conditions on appearance.
- [WARNING] (4) plan and README described the replaced design; the count only printed -->
  FIXED: plan rewritten, sliders listed by id, one pass, unknown appearance is measured.
- [WARNING] (5) the skip had no enforced denominator --> FIXED: a skipped slider not in
  KNOWN_NATIVE_SLIDERS fails the check; red-checked on Mortals (removing one id gives rc=1 with
  the message in every engine and scheme).
- [WARNING] (6) docs predated the allowlist --> FIXED; an id-less slider's message says to give
  it an id.
- [CONVENTION] (7) a listed slider that is deleted leaves a dead entry with no signal -->
  DEFERRED: a rename is caught (the new id is not listed); a deleted entry is inert and cannot
  hide a field. The reviewer rated it low and did not ask for a fix.

## Proof
- Red: render-fields alone on da343bae1 (Mortals): 8 FAIL, the two .swbox sliders, both engines.
- Green on this branch (Mortals), at every design step through e350916f0: 85 fields, the four
  sliders listed by id, PASS. Allowlist red arm as above.
- browser-checks indexed, selectors and reason-grep tests: 10/10 at c537ebe3d.
- Full yarn test at 2f4b34f80 (later commits touch only render-fields.js, its README row and
  the plan): 9525 tests, 0 fail.
