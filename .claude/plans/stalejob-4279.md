# stalejob-4279: a leftover launchd job no longer blocks creating an agent with its name

## Why

kosmos#4279. On Agent1s, 2026-09-27, the board's automatic setup-guide creation for the name Josh was
refused at 19:37 CDT: "something called Josh is already set to start on this computer". The holder was
`gui/501/com.kosmos.agent.josh`, a job a 09-24 test had loaded from a plist in `T/rx-launch-*`. It had
respawned 8,096 times with exit 1, and its working folder was temporary. Once it was booted out by hand
(19:44), creation succeeded (20:36). For a user, any leftover job blocks the name, with a message about
a thing they cannot see: a crash mid-remove, an older install, or a reinstall into a new data folder.

## The change

- `engine/create.js`, the "loaded with nothing on disk" refusal: when `launchctl print` names the plist
  the job was loaded from (the first-level `path = ...` line), and that plist is NOT this board's own
  plist path, AND it is gone or under a SYSTEM temp root (`/tmp`, `/var/folders`, each also with its
  `/private` spelling; `os.tmpdir()` and `$TMPDIR` are deliberately NOT trusted), the job is booted out, the
  creation re-checks that it is gone, and it goes on with a step naming the file removed and why (also
  logged). If the bootout does not take, a failed step says so, and it refuses as before, loading nothing.
- Everything else still refuses, unchanged: a plist at our own path, a plist that exists outside a temp
  folder, or a print that names no path. Labels are world-scoped, so a same-label job is this board's own
  agent or its leftover, and we do not unload what we cannot prove is dead.
- `leftoverJob(printed, ours)` is exported and unit-tested. The four root literals are classified in
  the #1732 Windows-coupling inventory as macos-only-branch (the path is launchd-only).
- Tests in `engine/create.test.js` (#4279): temp plist replaced and created; gone plist replaced and
  created; own path refused; present non-temp plist refused; a bootout that does not take still refuses;
  the parser reads only the first-level path. The existing "loaded with nothing on disk" test (no path in
  the print) still refuses and never boots out.

Rejected: treating a nonzero last exit or a high run count as enough on its own. A live agent that is
crash-looping today is still somebody's agent; the proof that a job is a leftover is where its plist is.

## Review 1

- BLOCKER, fixed: `os.tmpdir()` and `$TMPDIR` were trusted as temp roots, and TMPDIR is often repointed
  to a persistent folder, where a plist could be a live job. Only the four fixed system roots count now;
  a test pins that a plist under a repointed TMPDIR is not a leftover. (My own previous commit had moved
  toward those dynamic roots to satisfy the #1732 audit: the wrong direction.)
- The reported path was untested (reporting our own path passed): the step and the unit test pin it.
- A bootout that did not take told the person nothing: a failed step says so now.
- The comment called the rule a proof; it names its weak premise instead.
- The "present, not temp" fixture used this test file, which is temp when the checkout sits in /tmp:
  it is /etc/hosts now.

## Review 2

- BLOCKER, fixed: the temp-root check used the RAW path launchd reports, so `/tmp/../<a live plist>` passed
  as temp and a live job was booted out (reproduced by the reviewer through the runner seam). Both checks
  now use the resolved path, and an existing file's realpath; a `..` test pins it (the raw-path mutation
  reds).
- The whole-segment prefix check (`/tmpfoo` is not under `/tmp`) was untested; it is `underRoot`, exported
  and unit-tested (a naive startsWith reds).
- When the cleanup fails, the refusal now says it was tried ("removing it did not work"), not the old
  "nothing else left of it".
- The print format is noted as checked against real output (macOS 26, 2026-09-27); an unmatched format
  returns null, which falls back to the old refusal (fails closed).

## Review 3

- BLOCKER, fixed: after a SUCCESSFUL bootout, real `launchctl print` throws (run() is execFileSync), and the
  verify caught that throw as "not gone", so the happy path refused. A throw now means gone (the loaded
  check's own convention). The test runner now throws once booted out, as launchctl does; with the old
  verify, the create tests red.
- BLOCKER, fixed: `existsSync` says false on a permission error too; "gone" is ENOENT from stat and only
  that. Anything else refuses. Pinned with a chmod 000 folder.
- Our own plist path is realpath'd too, and a temp symlink to it is pinned as ours (deleting that check
  reds).

## Weakest premise

That a real agent's plist never lives in a temp folder. Kosmos writes real plists to
~/Library/LaunchAgents; only a sandboxed launch root (tests, set by AGENT_WORKFORCE_LAUNCH) puts them in
temp. A person who pointed AGENT_WORKFORCE_LAUNCH at a temp folder on purpose would have their job
treated as a leftover when they create the same name again; that setting is test-only.
