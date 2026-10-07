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
- Tests that walk EVERY tracked file (a string grep for `.claude/plans` cannot see these; found in review):
  `fixture-discipline.test.js` checks each tracked PATH for segments like `undefined` or `foo:`, and
  `tools.no-phone-home-4253.test.js` reads every tracked `*.test.js`. So reuse is limited to plain Markdown files
  directly under `.claude/plans/` whose names are letters, digits, `.`, `_` and `-` only (no subdirectory, no colon,
  no `.test.js`). The brand and name scans exclude plans; `bundle.execbit-4134` reads named paths only.

## The change
- `tools/ci-plans-only-reuse.sh <head-sha> <branch>`: prints the id of the newest green `test.yml` pull_request run
  for the branch at another sha, at most six hours old (`KOSMOS_REUSE_MAX_AGE_S`), ONLY when every path changed since
  that sha, BOTH sides of a rename (`--no-renames`; a code file moved into plans must not read as a plan change), is a
  plain plan file as above and not a goldencard-2519 plan. Prints nothing on any doubt: no green run, sha not in the clone (force-push), diff fails, gh
  fails, nothing changed (a deliberate re-run), missing arguments. Always exits 0.
- `test.yml`: a `scope` job (ubuntu, `actions: read`) runs THE BASE BRANCH's copy of it (`git show
  origin/<base>:tools/ci-plans-only-reuse.sh`), so a PR that edits the decider is never judged by its own copy (no
  copy on the base, as on this PR itself, means the suite runs), on pull_request only, with the branch name and sha
  passed through `env:` (a branch name can hold shell syntax), and keeps only a numeric answer. `suite` runs when
  `!cancelled() && needs.scope.outputs.reuse == ''`, so a failed scope job still runs the suite. `test` passes a
  skipped suite ONLY with a numeric run id to reuse, and prints that run's URL.
- `tools.shell-shard-4317.test.js`: `test` now needs `[scope, suite]`.
- `tools/test-ci-plans-only-reuse-5488.sh` (in test:shell): real git repo; the gh stub refuses unless asked
  for green pull_request test.yml runs of the branch with their age; 24 decision arms; the wiring parsed as YAML; the REAL `test`
  step body run with each input (a skip is green only with scope success and a numeric id); the REAL decide step
  body run in a scratch clone whose origin/main holds the decider (reuse, no base copy, and push).
  Measured red: non-plans arm loosened, 2 failures; `--no-renames` dropped, 1 (the move); `--status success` dropped,
  2 (the stub refuses, so the reuse controls fail).

## Cost
- `suite` now waits for the ubuntu `scope` job on every PR run. Its checkout is full history without past file
  contents (`filter: blob:none`; only the checked-out tree's files download), much cheaper than the ~340 MiB full
  clone.

## Weakest premises
- A pull_request run tests the merge with main AS IT WAS. Reusing it skips re-testing this head against a main that
  has moved, and proof commits come last, just before merge, when main has moved most. Decided, not missed: the
  six-hour cap bounds it; the window itself is not new (a PR already merges with main moved since its last run); and
  the main push run after merging tests the merged tree. Rejected: requiring the same base sha, which on a main that
  takes a merge every few minutes would reuse almost never, and so save almost nothing.
- Reuse never chains: a run that itself reused a verdict concludes success with a fresh createdAt, so only a
  run whose `suite (...)` jobs RAN and all concluded success (`gh run view --json jobs`) is a source. Without that,
  each plans-only push would reset the six-hour clock (found in review iteration 2).
- Both sides of every changed path must be a plain file (mode 100644, or absent): a symlink or an executable bit
  under plans is not "a plan" (`git diff --raw`).
- `gh run list` once (of seven identical calls) returned two older runs at 10:05 CDT on 10-07 (seen in the author's
  terminal, no log kept); not reproducible.
  If it recurs it is safe: an older source means an older sha, a wider diff, and the suite runs.
- No check is required on main (no branch protection, no rulesets, measured). If `test` is ever made required, a
  skipped `suite` is still fine: `test` itself reports success with the reused run named.
- The listing does not filter by base branch: a stacked PR's green run against branch A can be reused after the PR
  is retargeted to main. Same class as "main has moved"; the six-hour cap bounds it, and the main push run after
  merging tests the merged tree.
- `gh run list --branch` matches the head branch NAME; a fork PR with the same branch name as another PR could match
  its green run. The diff check still requires that run's sha to be in this clone and the diff to be plans-only.

## Not done
- Part (b), the self-hosted runner: waits for the Mac mini.
