# guard-comment-4046: release.sh's line-end guard says what it does

Card #4046 (Baron's ruling, 2026-09-26 17:15: Mac and Windows each take the next free version number, so the next Mac cut is 0.7.01). The card measured that the code already allows 0.7.01 from 0.6.99; only the comment above the guard said "only the next line's first version will do", and the refusal message said "the next version is 0.x.00".

## What finished looks like
- The comment and the refusal message say what the code does: staying on the line is refused, any version on the next line may follow.
- A test pins that 0.7.01 gets through from 0.6.99 (nothing pinned it before; only 0.7.00 was).
- No behaviour change: the code is untouched.

## Decisions
- Comment and message only; the ruling is Baron's and needed no code (measured on the card).
- Landed after the 0.7.01 cut finishes, so nothing moves under a running release.
- Round 1: the comment says only staying on the line is refused (no forward or next-line check exists; a real one would be its own card); the past-the-end message names the next line's .00 or its next free number; the attribution names #4046.
