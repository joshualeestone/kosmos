# uishard-8453: the UIKit-list UI job in two halves, and EarlierDeleteShift's row waited for

Card: joshualeestone/kosmos#8453 (split out of #8221; Splinter 11-12: fix it now). Off main.

## Finished looks like

The UIKit-list UI checks run in two CI jobs that each end well inside their limit on the hosted Mac (shown by this PR's
own run), every class still runs with its expected count, and EarlierDeleteShift's one flaky check is fixed.

## Measured

- The single "uikit list (sample board)" job (limit 80 min) took 75 min 17 s on PR #8447, 69 on PR #8443, 46 to 59 on
  main's green runs. A retry adds minutes; a slow runner would time it out, a red no PR caused.
- Per class, from main's run 42940677400's result bundle (before #8443 doubled two classes' page delay): the
  earlier-pages classes (EarlierDropped 9.8 min, EarlierDeleteShift 5.5, EarlierPages 4.8, EarlierDoubleAsk 4.3) and
  ChatSearch, ChatDrag, StopAdding come to about 27 min; the rest about 26.
- EarlierDeleteShiftUITests.testAfterADeleteTheNextPageIsAskedFromTheWindowAsItIs failed once on PR #8447 ("no page
  landed after the delete") and passed on its retry. The check read the item-37 row at once, after one drag and a 1 s
  pause.

## Decided

- ui-sample.sh `--shard 1/2|2/2` (with --uikit only): 1/2 is the classes named in `earlier=`, 2/2 every other class, so
  together they are always the whole list; a class not named falls to 2/2, never out. UI_SAMPLE_PRINT_CLASSES=1 prints
  the classes a run would take and stops before anything needs a Mac (for the test).
- ios.yml: the `uikit` job is a matrix over "1/2" and "2/2", named "uikit list (sample board) 1/2" / "2/2", 75 min each until a run measures them (review 1),
  fail-fast off, an artifact name per half (strategy.job-index; no slash in an artifact name).
- EarlierDeleteShift: the item-37 row is waited for (5 s), not read at once. It is drawn only with the page asked for
  after the delete, so waiting cannot pass without that page.
- No required check is renamed: the ruleset on main requires only test, windows and scope. ui-flaky-count.sh takes an
  exact job name; its usage now names both halves.

Rejected: raising the limit alone (the next added check or slow runner reaches it again; wall time stays 75 min);
trimming checks (they guard real defects); a hash split (it would not balance the long earlier-pages classes).

Weakest premise: the per-class times are from before #8443 (16 s page delay) and #8442 (five A11yScroll checks), so
1/2 is now longer than 27 min (the delay roughly doubles the earlier-pages classes' waits) and 2/2 a few minutes over 26;
each half also builds the app (about 10 to 15 min). Expected about 45 to 55 min each, so the limit stays 75 (a job stopped
at its limit is cancelled, its result bundle and TIMED OUT lines lost) until runs show the room. Would change my mind:
this PR's run of either half near 75 min, which would call for moving a class across.

## Change

- ios/tools/ui-sample.sh: --shard, earlier=, UI_SAMPLE_PRINT_CLASSES; header.
- .github/workflows/ios.yml: the uikit matrix.
- ios/tools/ui-flaky-count.sh: usage names the halves.
- ios.ui-sample-shard-8453.test.js: the halves are exactly the whole list, each class once with its count; every name in
  earlier= is a real class (a misspelling would move one to 2/2 unseen); --shard refused without --uikit or for other
  values; the workflow runs both halves.
- ios/KosmosUITests/EarlierDeleteShiftUITests.swift: waitForExistence on the item-37 row.

## Results

- ios.ui-sample-shard-8453 and ios.ui-sample-tally-7609: 6 of 6. Mutations: a misspelt name in earlier= fails test 2;
  a matrix of one half fails test 4.
- bash -n on both scripts; ios.yml parses (Ruby YAML); the UI tests typecheck.
- On a simulator (iPhone 17e, iOS 27.0, UIKit list, once each): EarlierDeleteShiftUITests 2 of 2.

## Challenge loop

- Iteration 1 (opus): 1 WARNING FIXED: the limit was set to 60 from an estimate; a job stopped at its limit is cancelled
  (not failed), so its result bundle is never uploaded and its TIMED OUT lines never print, and one hung test costs up to
  14 min; the limit is 75 until a run measures the halves, and ui-sample.sh's "fits the job's 60" comment follows. NITs
  FIXED: two comments named a test file that does not exist (now ios.ui-sample-shard-8453.test.js); test 3 asserts each
  refusal's own words, as exit 2 is also an unknown argument's. Confirmed: no class can drop out (the filter runs before
  the count checks), the print exit comes before any Mac-only step, artifact names are unique per half, no required
  check is renamed, and the node test does not run on the Windows job.
