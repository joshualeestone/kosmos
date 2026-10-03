---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0720
diff_hash: 75fcc873edcc9236368176c5c59f364606cac30a054f617d7fb75d6fcc72263e
subdir_audit: passed
timestamp: 2026-10-03T05:32:22Z
converged: true
---

## Challenge loop: 4 blind rounds; the last two found only NITs

## [WARNING] Round 1 (opus)
FIXED: line 1 (Gemini) is Mac only and the person chooses (the box starts as Antigravity has it); line 3 in the app's
own words ("removed agent", not "leftover").

## [NIT] Round 2 (sonnet)
All three lines true; one W on the release ENTRY draft (outside this repo), fixed.

## [WARNING] Review of the #5018 line vs PR #5089
FIXED: "sign-in expired" overclaimed (the notice also shows before expiry); now "is ending".

## [NIT] Final review vs the MERGED #5089 (83c33a874)
CONVERGED: floats (.topnotes absolute under the header, header height unchanged); shows before and after expiry; names
provider, email and agents; the X persists per browser until the notice's state changes. NIT left: "is ending or has
ended" would also cover the expired case.

## Checks
tools/whats-new-check.js 0.7.20: 4 highlights, each at most 140 characters; no em dash in any spelling.
