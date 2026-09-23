# Plan: #3499 - stop the duplicate CI test job that reads as a failure

## Card
#3499 (claimed:barondraxum, release/CI-mechanics lane). kosmos PRs run TWO near-identical
`test` jobs; one goes green (~14m), the other hits the ~15m timeout cap and is CANCELLED,
which `gh pr checks` mislabels as `fail`. Verified across #3455/#3487/#3491/#3496. Every
co-land needs a manual cancel-vs-fail check, and it risks masking a REAL fail as "just the
cap" (false-green class).

## Root cause
`.github/workflows/test.yml` triggered on `push: branches: ["**"]` AND `pull_request`. A
same-repo feature-branch PR therefore ran the one `test` job twice (branch push + PR). The
two runs contend on the shared macOS runners, and the suite has grown to ~14m (the in-file
"~2-3 min" note was stale), so under contention one run crosses the 15m timeout-minutes cap
and is CANCELLED. The existing `concurrency` group does not collapse the push/PR pair (they
resolve to different refs), and the in-file comment called the double-run "harmless" - which
predates both the suite growth and the false-fail evidence in #3499.

## Decision
Two coordinated changes to test.yml:
1. `on.push.branches: ["**"] -> ["main"]`. A PR now runs the suite ONCE (pull_request); main
   still runs it on push (the green-main signal the release cut gates on). This removes the
   duplicate at the source rather than papering over the cancelled job.
2. `timeout-minutes: 15 -> 30`. A single ~14m run had almost no margin under 15; 30 gives real
   headroom while still catching a genuine hang at ~2x runtime.
Result (card's verify criterion): one green `test` conclusion per PR, no CANCELLED-as-fail.

## Rejected
- Concurrency-group dedup (normalize push ref + PR head_ref to one group, cancel-in-progress):
  still produces a CANCELLED job (the superseded run), which is the exact thing `gh pr checks`
  reads as `fail`. Does not meet "one green, no cancelled".
- Raise timeout only (keep the double-run): would stop the cancellation (both go green) but
  leaves TWO green `test` conclusions - the card asks for ONE. Also keeps the wasted contention.
- Shard the suite: more complex, and unnecessary once the double-run is gone.

## Weakest premise
That no process relies on push-CI for NON-main branches. Reasoned no: agents push feature
branches then open PRs (pull_request covers them), and the cut gates on green MAIN (push on
main). A branch pushed but never PR'd is now untested until its PR opens - accepted, because
such a branch never merges, so its CI is moot. If some workflow did depend on feature-branch
push-CI, this would miss it; I could find none.

## Verify
- YAML validates (ruby YAML.load): push.branches=["main"], pull_request kept, timeout=30.
- Workflow meta-guards pass: test-ci-gate-armed-2518.sh, test-browser-checks-workflow.sh.
- Full run-tests.sh suite unaffected (workflow-only change, no app/web/shell code touched).
- Post-merge, the real proof is the card's criterion: a subsequent PR shows ONE green `test`
  conclusion with no CANCELLED-as-fail. This PR itself should already show it (push gated to
  main means my feature branch runs the suite once via pull_request).
