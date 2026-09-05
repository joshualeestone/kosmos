# freshinstall-verify: fresh-install launch-verification scenario

## Why

The ~6 external testers hit a fresh install first, so the first-run experience is
the launch's front door. Splinter routed this as launch-critical prep: a
verification scenario for served fresh 6.36, ready to RUN the moment Baron cuts,
covering the welcome project (#2279 / PR #2293), first-run completion, the
permission flow, and agent adoption/import. No scenario file existed, so this
creates one.

## What this is

A single doc, `docs/fresh-install-launch-verification.md`, that:

- Grounds itself in the existing `docs/clean-machine-retest.md` for HOW to reach a
  fresh-install state (it does not duplicate that; it links it), and surfaces the
  one fact that decides half the scenario: the wizard forks on running agents
  (live fleet -> adopt path; none -> create path). #2279 is the adopt-path case.
- Enumerates the four areas Splinter named, each with concrete PASS criteria and
  the method: which existing browser-check automates it (render half) vs which
  needs a served-API curl or operator observation (server / native half).
- Operationalizes #2279 with a served-API curl (GET /api/projects before/after
  POST /api/first-run/complete) so the seed can be checked on the served build,
  not only by eye, with a loud warning not to run the mutating form against a real
  store.
- Names its own weakest premise (the server seed is unit/route-tested; this
  scenario confirms the served build carries it and the board renders it).
- Provides a five-step fast go/no-go smoke subset, and states what it does not
  cover (the install download, Windows, non-Claude provider connect).

## Decisions

- **Doc, not a new browser-check.** A fixture-based browser-check renders whatever
  projects the intercepted API returns, so it cannot actually test the #2279
  SERVER seed (the board already renders projects). The real served verification
  is the API curl + operator observation, which the doc specifies. Adding a check
  would also drag in the wiring-guard reconciliation (reason-grep count, runner
  loop, README) for marginal value over the existing render-projects coverage.
- **Reference existing checks by name rather than re-describe them.** Every
  referenced check file was confirmed to exist on origin/main.

## Verification

- All 14 referenced browser-check files confirmed present.
- The #2279 served curls match the routes shipped in PR #2293 (`GET /api/projects`
  returns project names; `POST /api/first-run/complete` takes the cross-site
  origin header).
- Em-dash swept (author-facing).
