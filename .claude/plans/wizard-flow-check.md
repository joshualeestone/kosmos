# wizard-flow-check: end-to-end integration guard for the first-run wizard

## Why
Every 0.6.39/0.6.40 install fix landed SEPARATELY -- #1/#2 grant+gating, #3 connect,
#4 import, #5 find-agents + load-onto-screen-9, #9-12 copy -- and each has an isolated
browser-check. But the COMBINED first-run flow (screens 1..9) was never verified as a
whole, and screen INTERACTION is exactly the class that broke Josh's 0.6.39 test (a
stuck transition left later steps unreachable; a gate that wrongly blocked would strand
the flow). Splinter flagged this gap and asked for a full-wizard integration check to
de-risk Josh's fresh-install re-test.

## What
`docs/browser-checks/render-firstrun-wizard-flow.js`: self-boots a sandboxed server and
CLICKS Next through screens 1..9 (never deep-links -- a deep link skips the transition
logic that is the thing under test). The permission-status + scan endpoints are mocked
so the flow proceeds WITHOUT the real macOS TCC grant.

- GRANTED: starts at step 1; every Next advances (no stuck transition, the #2340 class);
  reaches S9; S9 loads the found agent via the granted import scan (#1652/#2349 in the
  integrated flow, not just the isolated unit check); the S9 primary fires
  /api/first-run/complete (terminal step); zero page errors across the whole flow.
- NOT-GRANTED: the S2 file-access gate disables Next and the flow cannot advance past
  S2 (the fail-safe gate cohering mid-wizard).

Wired into tools/browser-checks.sh, README indexed, reason-grep EXPECTED_SITES 59->61
and EXPECTED_CATCH_SITES 35->36 (the bad() helper + a single-line top-level crash catch).

## Decisions
- **Click Next, do not deep-link.** The transition logic (frGo advancing FR_STEP,
  gate polls enabling Next) is the thing under test; deep-linking to fr-step=N skips it
  and would hide the exact stuck-transition bug this guards against. Rejected: the
  deep-link-per-screen shape the isolated checks use.
- **Mock grants, not the real TCC prompt.** The real macOS grant cannot be exercised on
  a CI/headless box (it is an operator fresh-install pass, #2243), so this proves the
  WIRING/nav/gating/copy cohere -- explicitly NOT the real grant->scan. Splinter pinned
  this boundary so nobody over-cites the guard later.
- **Both polarities.** Granted (flow completes) AND not-granted (S2 blocks) are asserted,
  so the gate assertions are non-vacuous -- a gate that never blocked would fail the
  not-granted arm, and a gate that always blocked would fail the granted arm.
- **A ran<7 floor + a quotable top-level catch**, so a partial run or a pre-body throw
  reds the gate with a real line rather than a silent "(no FAIL line)".

## Weakest premise
The mocked grant means a real TCC-grant regression (the native app failing to write
file-access-status.json, or the grant not reaching the scan) would NOT be caught here --
that is Josh's fresh-install re-test's job. Also, driving 9 screens is more timing-
sensitive than an isolated check; it is guarded with waitForFunction (5s) on each gate
and each FR_STEP change rather than fixed sleeps, and it ran clean repeatedly, but a
much slower CI box is the place a flake would first show. If it flakes, widen the
waits before doubting the flow.
