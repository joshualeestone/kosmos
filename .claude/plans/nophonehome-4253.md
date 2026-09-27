# nophonehome-4253: harness boards never phone home

## Why

kosmos#4253. The public install count on installkosmos.com (33,107 on 2026-09-27) is mostly fake.
`engine/createdbeacon.js` sends an install ping on every board start and skips only under
`NODE_TEST_CONTEXT`, which only node's own test runner sets. Harnesses that boot `server.js` from bash
(`tools/browser-checks.sh`, the shell tests `tools/run-tests.sh` drives, the release bundle smoke in
`tools/build-kosmos-bundle.sh`) sandbox `AGENT_WORKFORCE_DATA`, so every boot mints a fresh install id
and registers a new "install". Measured: one allowlisted browser-checks run sent 14.

Hard constraint (Josh, 2026-09-14, #3038): the real install ping is never removed or made
opt-out-able. So the beacon is not changed; only the harnesses are.

## The change

- `tools/browser-checks.sh` and `tools/run-tests.sh` export, at top level before any board boot,
  `AGENT_WORKFORCE_CREATED_URL=http://127.0.0.1:9/api/created` and
  `AGENT_WORKFORCE_FEEDBACK_URL=http://127.0.0.1:9/api/feedback` (a dead local port, the pattern
  browser-checks already uses for its other outbound URLs). Every child inherits them.
- The bundle smoke boot in `tools/build-kosmos-bundle.sh` carries the same two on its own env block.
- `tools/test-install.sh` (the release cut's install gate, dozens of sandboxed boards per run through
  install/setup.sh) exports both at top level, and its `env -i` reboot simulation names both, since
  env -i starts from an empty environment.
- `engine/feedbacksend.test.js`: the arm that pins the DEFAULT endpoint clears the override for its
  one send, since run-tests.sh now sets it.
- New `tools.no-phone-home-4253.test.js`: a CONTROL arm boots the real server.js with
  NODE_TEST_CONTEXT removed and asserts the install ping arrives at the URL the variable names; the
  other arms assert both harness scripts export both URLs to loopback at top level before their first
  boot, and the smoke boot carries both.

Rejected: a `KOSMOS_NO_PHONE_HOME` switch in the beacon (an opt-out a real install could set);
suppressing when `AGENT_WORKFORCE_DATA` is set (`install/setup.sh:1320` sets it for real installs).

## Evidence

- Same command, caller sets `AGENT_WORKFORCE_CREATED_URL` to a sink: origin/main delivered 14 pings,
  this branch 0 (its export overrides, aiming every boot at the dead port).
- `origin/main`'s feedbacksend.test.js under the harness env: 1 fail; this branch: 0.

## Review 1

- BLOCKER, fixed: tools/test-install.sh boots dozens of sandboxed boards and a cut runs it as the
  install gate; it had neither variable. Top-level export beside its sandbox export, plus both names
  in the env -i reboot simulation. The guard covers both.
- The top-level check was a column-0 string match, so an export inside a never-called function (or
  under `if false`) passed. The guard now counts block depth from column-0 openers and closers.
  Mutations, each red: function wrap, if-false wrap, test-install export removed, env -i name removed.
- The feedback URL has a structural guard only (its send is an hourly sweep a short boot never
  reaches); the test file says so.

## Review 2

- No boot path to the real endpoint found (every harness boot, the test:shell chain, the env -i reboot
  simulation, the smoke boot); the real team-board deploy is correctly untouched.
- The depth reader never closed a function: `\}` followed by `\b` cannot match. It closes a column-0
  `}` now, pinned by a direct test on a small script (the old regex reds it).
- test-install.sh's boot pattern skipped the real first installer run (a `VAR= sh` prefix) and anchored
  on a later one; widened, and a test asserts it finds the first (the old pattern reds it).
- run-tests.sh boots nothing in its own text, so only the top-level check applies to it; the test says
  so.

## Weakest premise

A harness started outside these three entry points (a check run by hand with node, a /verify-live
local board, a walk) still pings. Test: the daily new-id count should fall to near zero within a day
of this reaching main.
