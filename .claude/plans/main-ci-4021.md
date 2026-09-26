# main-ci-4021: a main suite run is never cancelled by the next merge

Card: kosmos#4021 (part 2; part 1 is answered on the card with a measurement).

## Problem
test.yml's concurrency group cancels in-progress runs on every ref. The suite takes ~14m and on
2026-09-26 merges landed faster, so every main run 17:57Z-18:49Z was cancelled and main's red
showed first at the 0.6.99 cut's step 3.

## Change
- `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`: PR runs are still cancelled when
  superseded (#3499); a main run always finishes. GitHub keeps at most one pending run per group,
  so the head of main is always next and the queue cannot grow.
- The same for android.yml and ios.yml, which also build on a push to main and carried the same
  shape (review iteration 1; #3499 keeps the three in lockstep).
- ci.main-runs-finish-4021.test.js pins all three: evaluates the expression for main and a PR ref,
  with a control that the old `true` reads as cancelling main, pins each group to github.ref (a
  group shared with PRs would let a PR run cancel main's), and a control that every workflow whose
  PARSED YAML (ruby, as tools/test-browser-checks-workflow.sh does) pushes to main is in its list.
  The detector is tested on 15 spellings that push to main and 12 that do not; it skips where ruby
  is absent (the per-file pins still run).

## Iteration 1 (sonnet)
- WARNING: android.yml and ios.yml had the same main-cancelling shape --> fixed.
- NIT: the control compared against the live text, so it misfired when the live file regressed
  --> built from the line's shape instead.
- Confirmed: the expression is GitHub's documented form; a newer pending run replaces an older
  pending one regardless of cancel-in-progress; release.sh step 3 runs `yarn test` itself and reads
  no Actions status, so the cut's gating is unchanged (this is about SEEING a red main sooner).

## Rejected
- One run per main sha (group keyed on github.sha): tests every merge but stacks N suites on the
  shared macOS runners, the #3499 contention.
- A scheduled uncancellable full run: slower to see a red than this, and a second place to maintain.

## Weakest premise
A red commit superseded while PENDING never runs on its own; the red still shows at the head,
but bisecting means `yarn test` locally at that sha (none of the three has a manual trigger).

## Iteration 2 (opus)
- WARNING: the push-to-main detector (a regex) missed 6 of 7 YAML spellings --> it reads the parsed
  YAML now; all 7 caught in a scratch replay.
- WARNING: the group key was unpinned; `group: test` would let a PR run cancel main's with every pin
  green --> pinned to github.ref (the replay reds it).
- WARNING: plan and test overstated the detector --> reworded with it.
- NITs: older comments above the blocks still said a re-push to main cancels --> reworded; the test's
  header named only test.yml --> names all three; latency cost (up to ~2 x 14m under a burst) stated.

## Iteration 3 (sonnet)
- WARNING: the glob conversion read `?` as any one character and `+`/`[...]` as literals; GitHub's
  `?` and `+` quantify the preceding character and `[...]` is a set, and `!` excludes within a list
  (later wins) --> implemented, with 5 more spellings that push to main and 4 that do not.
- WARNING: a missing ruby skipped the detector quietly even under CI --> a control fails under CI
  when ruby is missing (reasoned from source, not measured: stripping ruby off PATH was not
  permitted on this machine).
- NIT: a comment line left unwrapped by iteration 2 --> rewrapped.

## Iteration 4 (opus)
- WARNING: YAML.load_file refused anchors (Psych 4), so any workflow using one would red this test
  with a parser error --> aliases, Date and Symbol allowed (a scratch anchors.yml now parses).
- NITs, all fixed: each group must be `<own-prefix>-${{ github.ref }}` and prefixes distinct (a
  shared group reds); the group is read with comments stripped; `**/` matches zero directories, `\`
  escapes, a leading `?`/`+` is literal; the plan's counts; bisect is a local `yarn test` (no manual
  trigger exists); CI=false is not CI and a broken ruby is named as broken; ios.yml is in the
  positive control.
- CONVENTION: descriptive names (PINNED_WORKFLOWS, branchFilterToRegex, pushesToMain, ...).

## Iteration 5 (sonnet)
- WARNING: a workflow ruby's safe loader refuses (a custom tag) failed the detector with a raw
  backtrace naming no file --> the failure names the file and the reason in one line.
- NIT: `[...]` is copied into the regex as-is, looser than GitHub's alnum-ranges-only sets; kept,
  since a divergence there can only make the detector disagree loudly, never miss silently.
