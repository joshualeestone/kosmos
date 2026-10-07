# #5488: a plans-only PR push reuses its last green verdict instead of three macOS runners

## The problem, measured
The GitHub macOS queue was 19 `test` runs deep (5 run at a time). Over the last 300 `test.yml` runs (10-06 03:38Z to
10-07 14:34Z), created to finished: median 39 min, p90 188 min. Each run holds THREE macOS runners (#4317 shards).

| bucket | runs |
|---|---|
| first run of a PR | 88 |
| push to main (71 change code; 3 retest an already-green tree) | 74 |
| PR push changing code | ~100 |
| PR push changing ONLY .claude/plans/ | 12 |
| PR push changing docs + plans only | 4 |
| PR whose whole diff is docs/plans | 4 |
| same tree (re-run) | 10 |

So the avoidable load is about 4%. The real fix for the queue is capacity (a self-hosted Mac runner, part (b) of the
card, waiting for the hardware). This change takes the safe 4%.

## Why not paths-ignore
On `pull_request`, GitHub applies path filters to the PR's WHOLE diff against base, not to the newest push. A proof
commit on a PR that changes code still matches, so `paths-ignore: .claude/plans/**` skips none of the 12.

## Why .claude/plans/ only, and not docs/
- `no-brand-refs-1881` and `no-name-refs-3071` exclude `.claude/plans/` by design and scan `docs/` on purpose.
- `test-launchagent-leak-guard-3011` excludes `.claude/plans/`.
- `render-talk-goldencard-2519` reads `.claude/plans/goldencard-2519-*.md` (not the proof) and `docs/browser-checks/`.
  So a goldencard-2519 plan is carved back in: it runs the suite.
- Every other `.claude/plans` mention in a test is a comment citation (checked line by line).

## The change
- `tools/ci-plans-only-reuse.sh <head-sha> <branch>`: prints the id of the newest green `test.yml` pull_request run
  for the branch at another sha, ONLY when every file changed since that sha is under `.claude/plans/` (and is not a
  goldencard-2519 plan). Prints nothing on any doubt: no green run, sha not in the clone (force-push), diff fails, gh
  fails, nothing changed (a deliberate re-run), missing arguments. Always exits 0.
- `test.yml`: a `scope` job (ubuntu, `actions: read`) runs it on pull_request only. `suite` runs when
  `!cancelled() && needs.scope.outputs.reuse == ''`, so a failed scope job still runs the suite. `test` passes a
  skipped suite ONLY with a named run to reuse, and prints that run's URL.
- `tools.shell-shard-4317.test.js`: `test` now needs `[scope, suite]`.
- `tools/test-ci-plans-only-reuse-5488.sh` (in test:shell): real git repo, stubbed gh, 11 decision arms and 4
  wiring pins. Measured red: with the non-plans arm loosened, 2 failures (code, docs).

## Weakest premises
- A pull_request run tests the merge with main AS IT WAS. Reusing it skips re-testing this head against a main that
  has moved. The main push run after merging still tests the merged tree, and a rebased PR is never plans-only
  (main's changes are in the diff), so it always runs.
- No check is required on main (no branch protection, no rulesets, measured). If `test` is ever made required, a
  skipped `suite` is still fine: `test` itself reports success with the reused run named.
- `gh run list --branch` matches the head branch NAME; a fork PR with the same branch name as another PR could match
  its green run. The diff check still requires that run's sha to be in this clone and the diff to be plans-only.

## Not done
- Part (b), the self-hosted runner: waits for the Mac mini.
