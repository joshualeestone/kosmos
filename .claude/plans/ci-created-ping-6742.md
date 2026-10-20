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

## Measured: no CI job boots a launchd or win32 SERVICE board outside node --test

A top-level env reaches a service board only where the unit is written from the inherited
env (the systemd path, via `engine/linuxboard.js:107`). So the claim that CI is fully
covered rests on CI never starting a macOS-launchd or Windows-win32 SERVICE board outside
`node --test`. Searched and measured:

- No workflow runs a service-start verb directly: `grep -nE 'launchctl (load|bootstrap|
  kickstart|enable)|sc\.exe|schtasks|Register-ScheduledTask|New-Service' .github/workflows/*.yml`
  returns nothing.
- `test.yml` (shell, macos-latest) and the shell suite boot boards only INSIDE the suite,
  which sandboxes launchd and hard-fails on a real service board: `tools/run-tests.sh:383`
  exports the dead URL for the boards it starts; `#3011` snapshots the real
  `~/Library/LaunchAgents` (`run-tests.sh:728`), makes an unsandboxed write there throw
  (`:753`), and FAILS the suite if a real `com.kosmos.agent.*` plist was created or modified
  (`:788-804`); `#4273` refuses and boots out any launchd job/process the suite leaves
  (`:810-820`). Install tests run setup.sh with the LaunchAgents dir redirected into a
  mktemp sandbox (`tools/test-install.sh:349`, `AGENT_WORKFORCE_LAUNCH="$SB/launch"`) and
  export the dead URL (`test-install.sh:355`); live-board watching SKIPs when the shell
  cannot see the launchd domain (headless runner, `test-install.sh:488`).
- `browser-checks.yml` / `browser-checks-full.yml`: `tools/browser-checks.sh:85` exports the
  dead URL; the boards are foreground Playwright boards (inherit env), not services.
- `linux-systemd.yml` / `test-linux-setup-4920.yml`: the only real OS-service boards in CI
  (systemd), covered by `linuxboard.js:107` injecting the inherited top-level env into the
  unit; test-linux-setup asserts the unit and the running board carry it. Its old-0.7.27
  update path uses a pre-systemd setup.sh whose unit cannot carry the var, so that step
  injects the dead address into the old unit with `sed` BEFORE `systemctl --user start`
  (`test-linux-setup-4920.yml:330-334`) and the old kosmos "knows no systemd"
  (asserted `:321`), so no board runs the old unit before the injection.

The search was at the SPAWNED-SCRIPT level, not only the workflow text: the scripts the
workflows run (`run-tests.sh`, `browser-checks.sh`, `test-install.sh`, `windows-tests.js`)
were read for board starts, and the only real service-board start in CI is the systemd one
above. `grep` for `launchctl`/`sc.exe`/`schtasks` across the workflows returns nothing, and
`setup.sh` is invoked only by the systemd workflow.
- `windows.yml`: `node tools/windows-tests.js` runs every file under `node --test`
  (`tools/windows-tests.js:291`), so NODE_TEST_CONTEXT suppresses the ping; the win32
  scheduled-task board (`engine/win32board.js`, `schtasks ... "Kosmos\board"`) is never
  started outside test context here.
- `linux.yml`: node part only, under `node --test` (suppressed). `android.yml` / `ios.yml`:
  Gradle/Xcode builds, no board.

## Residual (for a follow-up card, outside this card's CI scope)

A dead address set in a PARENT environment does not carry into a macOS launchd or Windows
win32 SERVICE board, because those boards get a fresh environment from their own
plist/scheduled-task definition. `engine/linuxboard.js:107` injects
`AGENT_WORKFORCE_CREATED_URL` into the systemd unit from the installer's env; the macOS
board LaunchAgent writer in `install/setup.sh` (the RunAtLoad/KeepAlive /
ProgramArguments `kosmos board-run` plist, ~setup.sh:5403) and the Windows board in
`engine/win32board.js` (the `schtasks` task) do NOT. This is invisible to CI (which never
boots those service boards outside node --test / the sandbox, per the measured section
above), but it means a real macOS or Windows USER install's board is not covered by a
parent-env dead address the way Linux is. Real user installs must still count; the gap is
only that the parent-env value does not reach these two service boards. Fixing it means the
installer-side injection (symmetric with `linuxboard.js:107`), which is installer code and
out of scope for this CI-ping card. Anchors for the follow-up: `install/setup.sh` board
plist writer (~:5403), `engine/win32board.js`, model `engine/linuxboard.js:107`.

## Reviewer

Scorpion (plain text in the PR body; `joshualeestone` is the push identity / PR author
and cannot be a GitHub reviewer).
