# bc-ci-allowlist-b10-835 -- expand per-PR browser-checks CI allowlist, batch 10 (#835)

## What and why
#835 (cut-efficiency): render-check regressions should fail at the PR, not at the
release cut. The mechanism is `KOSMOS_BC_CI_ALLOWLIST` in
`.github/workflows/browser-checks.yml`: it names the subset of `docs/browser-checks/*.js`
render checks that the per-PR browser-checks CI job runs headless on every PR that
touches `web/`. Batches 1-9 grew it from 8 -> 36. This batch adds 4 more, taking it to 40.

Editing `browser-checks.yml` triggers its own path-filtered CI, which runs the expanded
allowlist, so this PR self-validates: the driver's never-ran guard
(`tools/browser-checks.sh`) hard-reds a misspelled or never-running name, and any check
that reds headless reds the PR before merge. A bad pick cannot merge.

## The 4 checks added (all from the no-board/no-arg stem loop at tools/browser-checks.sh:1256)
Selection standard held bright-line for a clean converge: file:// hermetic (or
in-process, no external board), ZERO geometry/screenshot/animation/canvas signals, and
ZERO fixed sleeps in the assertion path (event-driven waits only, or fully synchronous).
Each was RUN headless (HEADED=0) against current main (origin/main @ 412e49d5, the batch-9
merge) and exited 0.

- **render-account-dup-reauth-2584** -- file:// load of web/index.html, window.fetch
  stub for /api/accounts. Asserts two cross-provider defaults sharing one email render two
  DISTINCT accessible reauth names that carry no filesystem path and use the provider name.
  Reads text (accessible names). No server, no fixed sleeps. PASS headless.
- **render-autohello-2686** -- file:// load, window.fetch stub answers every route,
  records posted requests. Asserts the auto-hello fetch SEQUENCE (16 sub-checks). Settles
  with 3 `waitForFunction` (event-driven), zero fixed sleeps. PASS headless (all 16).
- **render-firstrun-model-continue-2134** -- file:// load, seeds the FR global directly
  (no fetch even needed), drives the real frPaintOpenai, reads #fr-next / #fr-alt
  `.hidden` state. Fully synchronous single page.evaluate, zero waits. PASS headless.
- **render-model-spinners-2365** -- file:// load, window.fetch stub for
  /api/accounts/openai. Asserts the Choose-a-Model waiting states show Mona's .spin-sweep
  dots (8 dots, no icon) via DOM/HTML reads; the user-action wait shows neither. No
  server, zero fixed sleeps. PASS headless.

## Deliberately EXCLUDED this batch (candidates that passed but do not meet the bright-line)
- **render-create-openai-model-2140 / render-detail-openai-model-2140** -- both file://
  hermetic and both PASS headless, BUT they settle only with a fixed 40ms `setTimeout`
  microtask-flush (waitForFunction/Selector = 0). Per the batch-9 reliability principle
  (a fixed-sleep-only check in the always-run subset can intermittently red other PRs),
  they are DEFERRED, not rejected. The 40ms is a microtask flush after a synchronously
  resolved stub, so the real flake risk is low; a future re-add with an event-driven wait
  (or an explicit reliability sign-off) is clean. Kept out here to keep the always-run
  subset's wait-discipline bright-line and the converge tight.
- **render-addmem-flash-2429 / render-bubblepop-2407** -- spawn an in-process server and
  settle its boot with a fixed 1200ms sleep; server-boot fixed settles are the classic
  contended-runner flake, excluded on the same reliability basis.
- **live-connect** -- runs a CLI via execFile (not a DOM render check); out of scope for
  the render-check allowlist.

## Weakest premise in my own reasoning
That "zero fixed sleeps in the assertion path" fully predicts headless reliability in the
always-run subset. It is necessary, not sufficient: an event-driven wait with too short a
timeout, or a check whose stub races the real paint, could still flake. Mitigation: each
of the 4 was run headless on current main and passed, and the per-PR CI self-validation
re-runs them on a clean runner before merge; if any reds there I drop it and the batch
still stands with the rest. What would change my mind: a red or a non-deterministic result
in the browser-checks CI job on this PR.

## Scope guard
This batch only expands the ADVISORY allowlist. It does NOT enable branch protection or
make any check REQUIRED (that is parked for Josh's Pro/make-public money call). yaml-only
change; inert to the node unit suite.

## Steps
1. Append the 4 names to KOSMOS_BC_CI_ALLOWLIST in browser-checks.yml. [done]
2. challenge-loop to convergence; write the pre-challenge proof.
3. PR to joshualeestone/kosmos (literal cd for the gate; no --reviewer; no em dash).
4. Watch browser-checks CI; on green squash-merge; remove the worktree.
5. Append the batch-10 result to the daily note.
