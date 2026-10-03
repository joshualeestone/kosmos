# revert-5063: take #5063 out of 0.7.19 (it turns render-gutter-return-4506 red)

The 0.7.19 re-cut (frozen 147ceba3) aborted 19:21: suite green (14370 / 0), page layer red on
render-gutter-return-4506's G3b precondition ("with no reserved gutter the band really straddles the pane starting to
scroll"), 2/2 in the cut and 3/3 ALONE at the frozen sha on Mortals. Bisected on Mortals: green at 2da73952 (the bump),
red from 124d24f9b (#5063, #5018's login-expiry notice: float centred; Angel), and red at every later commit tried.
#5063 merged after the bump, so it was never in 0.7.19's scope.

## Change
`git revert 124d24f9b`, built on 147ceba3 (the last freeze) and merged with a MERGE commit (not squash), so the revert
commit itself is an ancestor of main and the re-cut can freeze AT it (release.sh permits cutting a sha behind origin):
the bump, the required fixes and everything up to 147ceba3, minus #5063, with no later merge riding (Splinter 19:28).

## Decided
Revert, not fix-forward: Angel has no verified quick fix (likely the float moved the pane's scroll start out of G3b's
calibrated band, so the CHECK may be what is stale; proving it needs a browser run). Angel re-lands #5018 for 0.7.20.
Weakest premise: the feature may be fine and the check stale; the gate is red either way.

## Tests
render-gutter-return-4506 alone at the revert commit on Mortals (expected green, as at 2da73952).
