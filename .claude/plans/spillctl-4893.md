# spillctl-4893: the code-fit control plants a code that cannot fit

Card: kosmos#4893 (the nightly full browser-check run red on main at f939828c4: mobile-shots-cover-spill).

## Done looks like
The nightly control arm `spill` fails its shot with exit 2 and "the code does not fit its card" again, and the
normal allow-card shot stays green, so the next scheduled night can close #4893.

## Cause
A product change, not a regression: #4805 (#4637 part B) replaced the box-per-character match code with one large
line (.askcodebig). The control's planted '482 913' now wraps at its space and fits at 375px, so the fit check is
right to stay quiet; the control could no longer fire.

## Change
docs/browser-checks/mobile-shots.js: MSHOTS_COVER_CONTROL=spill plants 'K7M3K7M3K7M3K7M3K7M3' (no break point,
wider than the card at every phone size). tools/browser-checks.sh: the comment describing the arm.

## Decisions
- Rejected: deleting the control (nothing would show the fit check can still fire); recording it as runner noise
  (it is deterministic).
- Weakest premise: the relay never issues a 20-character code (real codes are XX-XX), so this only shows the check
  can fire; under the one-line rendering a real code cannot spill at any phone width.

## Validation (headless, pw-runtime, Agent1s, queued turn 16:16)
- spill arm: exit 2, "the code does not fit its card: 1 of 1 codes leave the card, the farthest by 216px".
- normal arm (allow-card at se and desktop): 2 shots, 0 errors, exit 0.
