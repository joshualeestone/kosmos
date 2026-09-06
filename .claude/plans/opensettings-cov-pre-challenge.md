---
method: challenge-loop
branch: opensettings-cov
diff_hash: 51ffabe3b8aff674cf303a4a403ab3b40b0cac31f234a2d3a6d64dbbaada7311
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (round 1 converged on correctness; its one NIT is addressed and
the fix validated on a real board).
**Method:** a fresh blind CTO-lens reviewer, spawned without the authoring agent's
context.

opensettings-cov adds coverage-only to docs/browser-checks/click-first-run.js: a section
that clicks the S2 "Allow Access" and S3 "Turn On" open-settings buttons and asserts each
actually POSTs, and that a refusal is spoken rather than swallowed. It follows a challenge
review during kosmos#2255 that flagged nothing clicked these buttons end to end (a labelled
primary that silently did nothing had shipped once). No product code changes.

### Round 1 (blind) -- CONVERGED on correctness

The reviewer traced all assertions against the real product handlers in web/index.html and
the sibling surfaces that hit the same endpoints:

- [test-coverage] The assertions catch the dangerous answer, non-vacuously: the POST counters
  init to 0 and assert `=== 1`, so a silent button (0) AND a double-fire (2) both red. The
  409 guard is real: the product's success branch clears the message line to '' before the
  failure click, so the message-present assertion requires the failure POST to fire and the
  failure branch to render.
- [correctness] Endpoints/selectors/message-ids all match the product: .s2-allow ->
  /api/open-file-access-settings + #fr-s2-msg; [data-gate=sleep|tmux] .s3-on ->
  /api/open-sleep-settings | /api/open-accessibility-settings + #fr-s3-msg. No confound
  inflates the counters (the Settings-panel fetches to the same endpoints are a different
  surface never rendered in the first-run walk).
- [correctness] Isolation is clean: each block uses its own fresh() context; the POST-count
  assertion runs before the unroute/re-route swap, so the counter is never disturbed.

- **[test-coverage][NIT] The S3 block lacked S2's "spoken, not swallowed" assertion.** S2
  proved a 409 speaks in #fr-s2-msg, but S3 only asserted the POSTs fire -- and the S3 failure
  branch is a structurally separate path with its own message id (#fr-s3-msg), so a dropped or
  mistyped #fr-s3-msg would go green here while the identical S2 defect goes red. ADDRESSED
  (commit 31a014f8): added a mirrored 409 re-route on the tmux button asserting #fr-s3-msg
  speaks, matching the verified product handler (web/index.html: on !res.ok it writes
  body.error to #fr-s3-msg, same shape as S2).

### Validation

- [correctness] The full browser-checks runner (frozen at the committed HEAD 31a014f8, no
  uncommitted-changes warning) exercised click-first-run GREEN against a real board, exit 0.
  Section 12's FIVE assertions all pass: S2 POST-fires + #fr-s2-msg refusal, S3 sleep/tmux
  POST-fires, and the added S3 #fr-s3-msg refusal.
  NOTE, and it is why the run was repeated: the browser-checks runner freezes a detached copy
  of the LAST COMMIT (#758), so an earlier run against the UNCOMMITTED S3 edit tested only the
  four committed assertions. The S3 assertion was committed, then the runner re-run confirmed
  all five -- an uncommitted browser-check edit is not what the runner measures.
- [test-coverage] Node wiring tests (browser-checks reason-grep / selectors / indexed / wired)
  pass -- the added lines shift no pinned count.
- [correctness] Full node suite green apart from tools.release-gate.test.js, whose 7 reds were
  a concurrent test-install.sh on this Mac holding a fixed port (the #708 shared-machine
  class, named verbatim in the failure text); the file passes 22/22 run alone after that
  harness cleared, and CI's clean runner has no such harness.
- No web/ file in the diff (coverage-only), so no browser-check trailer is required.
