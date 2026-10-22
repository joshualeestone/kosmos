---
pre_challenge: true
method: challenge-loop
branch: shelllinux-6791
diff_hash: 594f51008e849aed617cf485862164855291d056171b6931cf93ad1919053347
validation: passed on Mortals but for two unrelated #6668 arms (see Validation)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-21T04:16:52Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4, fresh blind reviewers alternating opus and sonnet. **Converged:** iteration 4 reported NO NEW FINDINGS.

The measurements (three probes on ubuntu-latest), decisions, the stated weakest premise and the iteration-by-iteration fixes are in .claude/plans/shelllinux-6791.md.

**Validation, measured:**
- **Mortals full suite on the code head 3cdd8bf2** (on main 00790aa9; hash 5a6b4a16; since then only the plan's billing
  note changed, and Mortals is re-run on the new head, see below): 22813
  tests, 22491 passed, 2 failed, 320 skipped. The 2 are #6668's watchdog arms (untouched here, red under load on every
  branch tonight; #6768 fixes them). A full run with no shard runs all of test:shell, as before this change.
- **Mortals full suite on the PR head c175b76f** (after the plan's billing correction; hash 594f5100, matching the
  diff_hash above): 22813 tests, 22491 passed, 2 failed (the same two #6668 arms), 320 skipped.
- **On Linux, through the real runner:** branch probe-6791-runner (this change at 5df1a84e plus a probe workflow, never
  merged) ran both Linux shards exactly as the changed test.yml does, on ubuntu-latest (run 39540270814): shell 1/2
  "all 121 passed" (job 8.5 min), shell 2/2 "all 109 passed" (job 12.5 min). Since then only the macOS share changed
  (it gained the syntax checks), so the Linux shards' commands are the same 230.
- **Each command alone on ubuntu-latest:** run 39535595626 (238 of 264 pass; the 26 reds listed with reasons) and run
  39538876370 (8 of the 238 passed only by skipping their macOS work; listed too).
- **Here:** tools.shell-shard-4317 22/22; test-ci-runner-route-5488 0 failures; test-cut-testpart-guard-5934,
  test-runner-scale-export-5727 (also under a simulated Linux-shard environment), test-ci-created-url-6742 and
  test-ci-plans-only-reuse-5488 pass; tools.release-gate, tools.run-tests-only-4929, tools.run-tests-file-timeout-6668
  pass; every node file that reads the touched files, 1077/1077.
- **Gates:** #1720 and #2518 rc 0 (no web/ change).
- **Mutants:** seven, each turned its test red and was restored from a scratch copy (counted by `ℹ fail`).

### Per-Iteration Breakdown

The reviewers' own reports, copied from this session's Claude Code transcript (2026-10-20). Local paths are replaced and em dashes removed (house style). Nothing else is edited.

#### Iteration 1
**Reviewer model:** opus

I found no BLOCKER: no new path sends untrusted code to the self-hosted Mac. I did find 3 WARNINGs and 2 NITs.

What checked out:
- **`runs-on` and the self-hosted Mac.** The `runs-on` expression is correct for every matrix entry, with scope's outputs set and with them empty. The macOS-only commands can only land on macos-latest. A fork PR's Linux shard can only land on ubuntu-latest (the fork rule in `decide` is unchanged).
- **Job names.** The `name` expression yields `node`, `shell 1/2`, `shell 2/2` and `shell macOS`. Nothing else reads these names: `ci-plans-only-reuse.sh` matches on `startswith("suite (")`, and no check is required on this repo.
- **Commands dropped or run twice.** None can be: the platform split is an exact partition, and the hash sharding still covers every Linux command once.
- **Local runs.** A local `yarn test` with no shard runs `run 1 1` with no platform, the same as before.
- **Tests.** `tools.shell-shard-4317.test.js` passed 21 of 21 (0 fail, 0 cancelled). `test-ci-runner-route-5488.sh`, `test-ci-plans-only-reuse-5488.sh`, `no-brand-refs-1881`, `no-name-refs-3071`, `tools.release-gate` and `tools.run-tests-only-4929` all passed.

Findings:

1. [CHALLENGE] WARNING: some macOS coverage now runs nowhere in CI. The probe counted a test that skips with exit 0 as a pass. These commands are in the Linux set and skip on ubuntu-latest, but they really ran on macos-latest before (it has swiftc, arm64 and sandbox-exec):
   - `tools/test-setup-pause-sandbox-4651.sh:25` skips the whole file: "SKIP: no sandbox-exec (not a Mac)".
   - `tools/test-floor-gate-tree.sh:32-33` skips the whole file when there is no swiftc or the machine is not arm64. ubuntu-latest is x86_64 with no swiftc.
   - `tools/test-supervisor-agentbrowser-3633.sh:26-28` skips the whole file on anything but Darwin.
   - `tools/test-ci-cleanup-relay-6245.sh:8` skips the whole file when `uname` is not Darwin.
   - `tools/test-update-locked-app-4455.sh:34,194` skips its Darwin-only arms (LOCKED, RELOCK, CONTROL, GNUFIND, TWOLOCKS).
   - `tools/test-test-leak-guard-4273.sh:244` skips its launchctl arm.

   Effect: a regression in sandbox-exec pausing, the floor-gate probes, the pinned agent-browser build or locked-file handling now goes green in PR CI. It would only be caught by a local full run or a release cut. The plan's "weakest premise" names only two degraded fallbacks, not these. "238 passed" overstates what was measured on Linux.
   Fix: add the four whole-file skippers to `tools/shell-macos-only.txt` with the reason "skips off macOS". Do the same for 4455, or accept its Darwin-arm loss explicitly in the plan. Restate the probe result as "N ran, M passed by skipping".

2. [CHALLENGE] WARNING: `tools/release.sh:781`. The #5934 preflight refuses a leftover `KOSMOS_TEST_PART`, `KOSMOS_TEST_PART_LOCAL` or `KOSMOS_SHELL_SHARD`, but not the new `KOSMOS_SHELL_PLATFORM`. With `KOSMOS_SHELL_PLATFORM` set and no shard, the new block in `run-tests.sh` exits 2. That stops a cut at step 3, after the version bump, which is exactly the failure #5934 was written to prevent.
   Fix: add `[ -n "${KOSMOS_SHELL_PLATFORM+x}" ]` to that condition and its message. Add an arm to `tools/test-cut-testpart-guard-5934.sh` (it already does this for `KOSMOS_SHELL_SHARD` at lines 50-51), and unset it in the env setup of `tools.release-gate.test.js` (lines 128 and 698).

3. [CHALLENGE] NIT, verify before merge: the real Linux job has never run. The probe ran each command alone through `sh -c`. The real job runs them in one sequence inside `run-tests.sh`, and several of its post-shell gates have never run on Linux with a green node status, because `linux.yml` is always red before them (run 38035802728):
   - the process-orphan and kts-dir-owner checks in `test-leak-guard.sh`;
   - the LaunchAgents guard;
   - the two browser-check gates.

   From reading the code, `kosmos_wait_until_clear` and the pgrep guards in `cut-guard.sh` fail open on Linux by design, and the locale pin accepts the runner's `C.UTF-8`. So I found no concrete failure. But the branch has no PR and no CI run (`test.yml` runs on push only for main).
   Fix: open the PR and read the `shell 1/2` and `shell 2/2` logs end to end, including the closing summary and any leak notes. A shard stops at its first red, so one red can hide later ones.

4. [CHALLENGE] NIT: `.github/workflows/test.yml:332,336`. The "how close to the limit" step still builds its label from `matrix.shard`. So the macOS job reports itself as "suite (shell 1/1)" while its check is named "suite (shell macOS)". Its warning past 70% would also tell you to raise `SHELL_SHARDS`, which does not shard the mac job.
   Fix: use the same expression as the job `name`, and give the mac job its own hint.

5. [CHALLENGE] NIT: stale text.
   - `test.yml:195` still says "three macos-latest runners".
   - `test.yml:235` says "otherwise macos-latest"; it is now ubuntu-latest for a Linux shard.
   - `tools/shell-shard.js:19-20` gives usage lines without `[linux|mac]`.
   - `tools/shell-shard.js:114` says "`list` is the whole test:shell list, so the count in the first line is honest". It is now the platform's share, so the header reads, for example, "N of 238".
   - `tools/test-ci-created-url-6742.sh:44` still says the shell shards run on macos-latest.

   Fix: update the wording in each.

#### Iteration 2
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, `tools/run-tests.sh:678-684` and `tools/run-tests.sh:390-404` (new job at `.github/workflows/test.yml` suite matrix). The "230 pass on Linux" figure was measured with each command run alone in a bare environment (the plan says "ALONE"). The real Linux shards run those commands from inside `run-tests.sh`, which changes the environment:
   - `TMPDIR` becomes a per-run `kt$$` directory.
   - `gh` and `vercel` are replaced by `fake-cli-signed-out.sh`.
   - The created, feedback, community and catalogue URLs point at a dead port.
   - Locale and time-scale are set, and `KOSMOS_NO_LEGACY_MIGRATION=1`.
   - The launchagent and test leak guards run before and after.

   `tools/test-browser-run-guard.sh:15` already notes that `mktemp` behaves differently on Linux under `run-tests.sh`. So a command that passed alone can still go red in its shard. A degraded-fallback pass that only exists in one of the two environments is also possible. This cannot be measured here (I could not run Linux).
   Failure scenario: the PR's own first CI run turns a shard red on a command the probe called green. That is loud, not silent, but it is a premise the plan treats as measured when it is only reasoned.
   Fix: before merge, read both Linux shard logs end to end. The plan's iteration-1 NIT already says to. Better, add `bash tools/run-tests.sh` with `KOSMOS_TEST_PART=shell KOSMOS_SHELL_SHARD=1/2 KOSMOS_SHELL_PLATFORM=linux` to a throwaway probe branch and record the result in the plan. Then change the plan's "measured" wording to say it was measured alone, not through the runner.

2. [CHALLENGE] NIT, `tools/run-tests.sh:787`. The forwarding of the platform to `shell-shard.js` (`${KOSMOS_SHELL_PLATFORM:+"$KOSMOS_SHELL_PLATFORM"}`) has no test. `tools.shell-shard-4317.test.js:242` only pins the workflow env. Lines 317-318 only pin the refusals, which fire before the forwarding line.
   Failure scenario: someone drops the forward while tidying. The Linux shards then run all 264 commands and go red on the macOS-only ones, so that arm is caught. The `shell macOS` job then runs all 264 and stays green, so it silently stops being the 34-command job. Nothing pins the mac arm.
   Fix: add a test that runs `run-tests.sh` with a stub `node` that records its argv (the file already builds a stub dir), with part=shell, shard 1/1, platform mac. Assert the stub saw `... run 1 1 mac`.

3. [CHALLENGE] NIT, `.claude/plans/shelllinux-6791.md:46` ("Effect"). It still says the macOS shell job runs "26 commands". The header and `shell-macos-only.txt` say 34, and the line before it says "numbers updated by iteration 1". The plan is committed to a public repo and is the only place the premise is recorded.
   Fix: change "26 commands" to "34".

**Checked, no finding:**
- **Env var sweep.** The positive control worked: `KOSMOS_SHELL_SHARD` is in 10 files (`.github/workflows/test.yml`, `tools/run-tests.sh`, `tools/release.sh`, four node tests, three shell tests). `KOSMOS_SHELL_PLATFORM` is in the same 10 other than `linux.yml`, which only has `KOSMOS_TEST_PART` and never sets a shard.
- **Nested runners.** No other test or script that runs `run-tests.sh` or `release.sh` was missed by the reset.
- **Release preflight.** It treats a set-but-empty platform the same way it treats a set-but-empty shard, so the node job's empty `matrix.platform` behaves as before.
- **Actions expressions.** The name expression and the `runs-on` fallbacks give the right values for the node job, both Linux shards and the macOS job, including when scope writes nothing. `tools/test-ci-runner-route-5488.sh` evaluates them, and it passes.
- **Old job names.** `tools/ci-plans-only-reuse.sh:50` matches `startswith("suite (")` and still works. Nothing else reads the shard names or the `macos-latest` default. The macOS job is never routed to the self-hosted Mac.
- **Sensitive data.** The diff contains no home paths, usernames, emails or em dashes.
- **Tests I ran.** `tools.shell-shard-4317.test.js` gave 21 pass, fail 0, cancelled 0. `test-ci-runner-route-5488.sh` has 0 failures. `test-cut-testpart-guard-5934.sh` passed. Both new assertion groups can fail: the stale-line, bad-platform and CLI-exit-2 arms each have a control, and `size > 0` guards an empty list.

#### Iteration 3
**Reviewer model:** opus

I reviewed HEAD `d39d144361b77aafffec16bfe37669009c261561` and have one new finding, a WARNING.

1. [CHALLENGE] WARNING: the `sh -n` syntax checks of the installer now run under a different parser than the one users have. Lines: `.github/workflows/test.yml:87` (runs-on), `tools/shell-shard.js:459-464` (`forPlatform`), `tools/shell-macos-only.txt`.
   - **What moved:** 110 of the 230 commands that move to ubuntu-latest are `sh -n` / `bash -n` syntax checks. Twelve of them are `sh -n`, including `install/setup.sh`, `install/pkg-scripts/postinstall`, `install/pkg-scripts/resolve-install-user.sh` and `deploy/install-board.sh`. Those four start with `#!/bin/sh` and run on users' Macs.
   - **Why it matters:** on macOS `/bin/sh` is bash 3.2.57 in POSIX mode. On ubuntu-latest `sh` is dash. The repo already records bash 3.2 parse bugs it cares about (`install.linux-board-4920.test.js:240`: two shapes broke setup.sh in review; the test-cut-guard comment about a case `)` inside `$( )`).
   - **Measured on this Mac:** I wrote a one-line probe, `x=$(case a in a) echo y;; esac)`, in my scratch dir. `/bin/sh -n` and `/bin/bash -n` both give rc=2 (`syntax error near unexpected token ';;'`). `/bin/dash -n` gives rc=0.
   - **Failure scenario:** a PR adds that shape to `install/setup.sh`. Before this branch, `sh -n install/setup.sh` ran on macos-latest and went red. Now it runs only on ubuntu, goes green, and the PR merges with an installer that every user's Mac refuses to parse.
   - **Nothing else catches it in CI:** I grepped every `*.test.js` and none parse-checks these files under `/bin/sh`. The node part's install tests run blocks of setup.sh, not the whole file. The only remaining check is the full-suite run at release cut, which is after the merge.
   - **Wider, reasoned not measured:** if macos-latest's `bash` on PATH is `/bin/bash` 3.2, the 98 `bash -n` checks and the full `bash tools/test-*.sh` runs lose the 3.2 coverage too. For example, an empty array under `set -u`, which `tools/site-autodeploy.sh:381` names. The probes only asked whether a command passes on Linux, not whether passing on Linux checks the same interpreter.
   - **Fix:** run the syntax-only commands (`^(ba)?sh -n `, about 0 s each) in the `shell macOS` job as well as the Linux shards. One way is for `forPlatform('mac')` to return the listed commands plus every `-n` command. Another is to list the 12 `sh -n` lines (at least) in `tools/shell-macos-only.txt` with the reason "macOS /bin/sh is bash 3.2; dash parses differently". Update the exact-partition assertion in `tools.shell-shard-4317.test.js:195-197` to allow the deliberate overlap, and note the interpreter difference under "Weakest premise" in the plan.

Everything else held up:
- **runs-on expression:** the mac job is matched before the shard routes, so it can never reach the self-hosted Mac. Node falls back to macos-latest and a Linux shard to ubuntu-latest.
- **Linux tools step:** it is gated to Linux, so it does not run on the self-hosted Mac.
- **Platform forward:** run-tests.sh refuses a platform without a shard and forwards it to `shell-shard.js`. The release.sh preflight refuses it too, and the tests that nest the runner reset it.
- **Plans-only reuse:** `tools/ci-plans-only-reuse.sh` keys on the `suite (` name prefix, so the new job name is still counted.
- **Tests:** `tools.shell-shard-4317.test.js` ran with `ℹ fail 0` and `ℹ cancelled 0` (22 pass). `tools/test-ci-runner-route-5488.sh` exited rc=0 with 40 ok and 0 failures.

#### Iteration 4
**Reviewer model:** sonnet

NO NEW FINDINGS

I reviewed head 3cdd8bf23fba75f29924ffb236444952205dab27 against 00790aa9fe and found nothing new and real. Nothing required editing, committing or posting.

What I checked:
- **runs-on chain:** I traced it for every matrix entry, including when scope returns an empty runner output.
  - The node entry gets scope's runner, else macos-latest.
  - The `mac` entry always gets macos-latest, so it never reaches the self-hosted Mac.
  - A linux shard gets scope's shell1/shell2 runner, else ubuntu-latest.
  - An empty output falls through to ubuntu-latest, which is safe.
- **Job name expression:** I checked the `suite (...)` name and the matching name in the limit step. The node entry yields an empty suffix, `mac` yields " macOS", and a linux shard yields its shard. Nothing in `.github`, `tools` or the root test files refers to the old `suite (shell 1/2)` names, and `test` aggregates through `needs.suite.result`.
- **Partition counts:** I ran `shell-shard.js` against the real command list.
  - It has 264 commands with no duplicates.
  - 110 are syntax-only checks, and none of them is chained with `&&`, `;` or `|`, so the `^(ba)?sh -n ` match cannot pull a real test onto macOS.
  - The linux share is 230 commands and the mac share is 144.
  - The only linux commands matching a macOS-tool grep are `bash -n tools/lib/codesign-retry.sh` and `bash tools/test-codesign-retry-5149.sh`; both are already pinned in place by the plan's measurements.
- **CI security:** The `apt-get` step is `runner.os == 'Linux'` only, uses no secrets or user-controlled input, and runs on a throwaway hosted VM. The self-hosted routing rules are unchanged.
- **Env leakage:**
  - `KOSMOS_SHELL_PLATFORM` is empty for the node entry.
  - `run-tests.sh` validates it, and `release.sh` refuses it.
  - Nested-runner tests reset it.
- **Tests run:**
  - `tools.shell-shard-4317.test.js` gave 22 pass, 0 fail, 0 cancelled.
  - `tools/test-ci-runner-route-5488.sh` gave 0 failures.
  - `tools/test-cut-testpart-guard-5934.sh` passed all arms.

The bash-3.2-versus-5 weakest premise is already recorded in the plan and accepted, so I did not re-report it.
