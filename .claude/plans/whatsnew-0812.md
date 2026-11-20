# whatsnew-0812: What's New for the 0.8.12 staging cut

## Goal
main is 55 commits past staging 0.8.11 (gap alarm, #1050). The cut's step 1b-ii requires web/whats-new.json to be for
the cut's version and built from the pool. Nothing merged since 0.8.11 added a pool entry.

## Done
- release/whats-new-pool.json: `tools/whats-new-pool.js build 0.8.12` first recorded prod 0.8.11 (marking its
  highlights shown, lastProd 0.8.11), then six 0.8.12 entries were added for what a person sees this cut:
  old Safari gets its board (#8781), Update on an installed Linux board (#8786 S1, PR #8805), Cloud machines update
  nightly (#8786 S2, #8803), an apostrophe in an agent's name (#8784), a full sign-in on Kosmos Cloud lasts (#8785),
  a crashed session's provider block clears (#8782, rank 8.6: in the release notes, not the window).
- web/whats-new.json: built by the tool, not by hand (5 highlights).

## Decided
- No `platforms` tag on the two Linux items: the window accepts only mac and windows, and a Linux board shows the
  untagged list. The lines name Linux or Kosmos Cloud, so a Mac reader knows they are not about them.
- The Linux Update line announces PR #8805, which is on its merge watcher. If #8805 is red at the freeze, this line is
  removed (rebuild) before the cut, so it never announces something not in the build.

## Weakest premise
That each line describes the shipped behaviour exactly. Every line was written from the card and PR, not from using
the build.
