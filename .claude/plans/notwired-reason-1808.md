# Plan: real cost on the five NOT_WIRED browser checks (#1808)

## Problem

All five entries in the `NOT_WIRED` allowlist in `tools.browser-checks-wired.test.js`
gave their reason as the string `never wired.` -- a tautology, true of every
entry by definition. So an oversight and a deliberate deferral read identically,
and neither can be reviewed. The guard's own failure message already asks for
"a reason that is a real cost"; nothing enforced it.

(The original card also claimed these five were tracked by nothing; that half was
wrong -- the #1387 test already holds them in NOT_WIRED with the membership
invariants. The surviving finding is the tautological reason, a convention gap.)

## Approach

For each of the five, write the real cost of wiring, sourced from the check's own
header + the runner (what it exercises, what wiring would take). Keep all five --
do not delete or wire them: each guards a real defect a source test cannot see
(#1209/#1205/#1207 layout, a leaked filename, the sleep pane), and wiring a
never-run check mid-release is the red-gate trade the file's header describes.

Add a floor guard (test #1808) that refuses the bare "never wired" tautology
(case-insensitive) and an over-short reason, so the tautology cannot creep back.

## Decisions

- **Keep, not delete/wire.** See above; matches the file's documented rationale.
- **A FLOOR, not a quality judge.** "A real cost" cannot be fully mechanised, so
  the guard only refuses the bare tautology + over-short reasons, and says so.
- **The self-control must exercise each guard it names.** The regex and the
  length floor are two guards; the self-control pads the tautology past the
  20-char floor with internal whitespace so ONLY the regex can catch it (a bare
  12-char "never wired." would be caught by the length floor and could not tell a
  broken regex from a working one). Proved a dropped `/i` flag reds the case arm
  and a deleted regex reds the other.

## Verification

`node --test tools.browser-checks-wired.test.js`: 8/8. Both arms: the guard reds
on origin/main's tautology reasons and greens on the new ones. Reasons verified
accurate against `docs/browser-checks/*.js` (render-conn-url invokes
frPaintConnect; render-openai-step reveals the bar via evaluate, no click;
render-special-purpose deep-links /?tab=detail; render-sleep-button opens System
Settings). The #1315 cross-refs are disclosed as card-tracker-sourced.

Addresses #1387; does not close it.
