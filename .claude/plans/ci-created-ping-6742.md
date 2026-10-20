# CI: dead-address the install ping in every workflow (Addresses kosmos#6742)

## Problem

Kosmos CI runs on fresh GitHub hosted runners. `engine/createdbeacon.js` sends a
real install "created" ping to installkosmos.com (`DEFAULT_ENDPOINT`, `:70`) whenever
a board starts, unless `AGENT_WORKFORCE_CREATED_URL` is set in the board process's own
environment (`:73` reads it at ping time, `:157` POSTs there). The only suppression is
`NODE_TEST_CONTEXT` (`:138`), set by `node --test`. So any CI step that boots a board
OUTSIDE `node --test` records a silent install in the public data. Only
`test-linux-setup-4920.yml` pointed the var at a dead address; Windows CI was not
covered at all.

## Fix

Add a top-level `env: AGENT_WORKFORCE_CREATED_URL: http://127.0.0.1:9/api/created`
(loopback discard port) to every workflow under `.github/workflows/` (9 files).

- A top-level `env:` reaches step shells, in-process `node`, and children they spawn
  (default env inheritance), so it covers `test.yml` (shell part), `windows.yml`
  (`node tools/windows-tests.js` + spawned children), and `browser-checks*.yml`.
- For a board started as a **systemd service**, the unit does not inherit the step
  env, but `engine/linuxboard.js` reads `AGENT_WORKFORCE_CREATED_URL` from its own
  env at unit-creation time (`:88`) and injects it into the unit (`:107`). So the
  top-level env reaches the live systemd boards in `linux-systemd.yml`
  (`linuxboard.installBoard`, via `test-linux-systemd-live-4918.sh`) and in
  `test-linux-setup-4920.yml`.
- `android.yml` / `ios.yml` (Gradle/Xcode builds) and `linux.yml` (node part under
  `node --test`) start no out-of-test board; the var is harmless there and keeps the
  policy uniform, so a future workflow that grows a board step is covered without an
  allowlist (allowlists drift; a blanket top-level env does not).

## Per-workflow proof (the ping cannot leave)

- test.yml: top-level env -> shell boards inherit (also `run-tests.sh:383` exports it).
- windows.yml: top-level env -> windows-tests.js -> spawned children/grandchildren
  inherit (`:291`, no explicit env opt); `--test` children also NODE_TEST_CONTEXT-suppressed.
- browser-checks.yml / -full.yml: top-level env -> boards inherit (also `browser-checks.sh:85`).
- linux-systemd.yml: top-level env -> linuxboard.installBoard injects it into the board
  unit; the supervised/detect/foreground scripts stub systemctl or run under node --test.
- test-linux-setup-4920.yml: already injects via setup -> linuxboard + step GITHUB_ENV;
  top-level env added for uniformity and to satisfy the guard.
- linux.yml / android.yml / ios.yml: no out-of-test board; env harmless/uniform.

## Guard

`tools/test-ci-created-url-6742.sh`:
- Part A: ruby `-ryaml` loads each `.github/workflows/*.yml|*.yaml`, requires the exact
  dead address in the file's TOP-LEVEL `env:` (`d["env"]`), not a grep (which
  false-passes test-linux-setup, where the var is only inside `run:` blocks). Cross-checks
  the glob count against the on-disk file count so a glob slip cannot pass vacuously.
  Ruby-availability contract: hard-fail under CI if ruby is missing, skip locally.
- Part B: perturbs temp fixtures to prove the check reds on no-top-level-env,
  var-only-in-a-step, var-only-in-a-run-block, and a wrong top-level value, and greens
  on a correct one.
- Wired into `package.json` `test:shell`, so it runs in `.github/workflows/test.yml`'s
  `suite (shell)` matrix on every pull_request and push to main.

## Done-when

1. Every workflow in `.github/workflows` has the exact dead address in its top-level
   `env:` block (ruby-verified).
2. The ping cannot leave for each board-starting workflow (proof table above).
3. The guard fails on a workflow lacking it in the top-level env (no-env, step-only,
   run-only, wrong value), and runs in CI (test:shell via test.yml suite shell).
4. Full `tools/run-tests.sh` green at the head.

## Reviewer

Scorpion (plain text in the PR body; `joshualeestone` is the push identity / PR author
and cannot be a GitHub reviewer).
