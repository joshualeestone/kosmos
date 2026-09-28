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
  plist path, AND it is gone or under a SYSTEM temp root (`/private/tmp`, `/private/var/folders`, compared
  on the realpath; `os.tmpdir()` and `$TMPDIR` are deliberately NOT trusted), the job is booted out, the
  creation re-checks that it is gone, and it goes on with a step naming the file removed and why (also
  logged). If the bootout does not take, a failed step says so, and it refuses as before, loading nothing.
- Everything else still refuses, unchanged: a plist at our own path, a plist that exists outside a temp
  folder, or a print that names no path. Labels are world-scoped, so a same-label job is this board's own
  agent or its leftover, and we do not unload what we cannot prove is dead.
- `leftoverJob(printed, ours)` is exported and unit-tested. The two root literals are classified in
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

## Review 4

- BLOCKER, fixed: any throw from the verify print read as "gone". Only launchd's own missing-service throw
  counts now (exit 113, `Could not find service ...`, measured on this Mac); a timeout or a failed exec
  refuses. Tested with an ETIMEDOUT that leaves the job loaded.
- The bare `/tmp` and `/var/folders` roots were dead: the realpath of an existing file is always the
  `/private` spelling. Dropped, with their #1732 rows.
- A refusal for a present plist outside temp said "nothing else left of it"; it now names the file.

## Review 5

- BLOCKER, fixed: no test checked WHICH label the bootout and the verify print target, so pointing the one
  destructive call at another label passed all 197. The temp-plist test now asserts both are exactly
  `gui/<uid>/<this agent's serviceLabel>` (the wrong-label mutation reds).
- The named-file refusal treats a stat error other than ENOENT as "a file is there" (it was read as none).
- The gone branch's own weak premise is now stated below.

## Review 6

- An unreadable plist at OUR OWN path could get the "a startup file Kosmos did not make here" refusal,
  which could lead someone to delete their own agent's plist; that message now excludes our own path
  (pinned on the own-path test).
- The verify comment claimed an exit-code check the code does not make; it now says only the message
  text is checked.
- The removal log line is pinned (console spy on the temp-plist test).

## Review 7

- No blocker or warning; every earlier fix re-verified by mutation.
- The `\tpath = ` regex was written twice (leftoverJob and the named-file refusal); it is one helper,
  `printedPath`, now.
- Not changed: tempRoots' one-push-per-line shape is deliberate, since the #1732 inventory counts one
  literal per row; a comment says so.

## Review 8

- No blocker. Review 5's "a non-ENOENT stat error means a file is there" had no test on a NON-own path
  (reverting it passed all 198); a locked foreign plist now pins it: refused, named, never booted out.
- Not changed: the removal log line uses the agent's raw name while the messages use its display name.
  The log is for machines and the steps are for people; that split is deliberate.

## Review 9

- No blocker; every earlier fix re-verified by mutation. The reason text a person sees was only
  substring-matched (a reversed sentence containing "gone" passed); it is pinned exactly, and in the log
  and the step.
- Anything present at the named path (not only a regular file) gets the refusal that names it.

## Review 10

- No blocker. A RELATIVE printed path's refusal message was untested; pinned (the isAbsolute guard's
  removal reds).
- The $HOME fixtures (needed because the SANDBOX is in temp) had only per-test cleanup; a `homeFixture`
  helper also registers each for an exit-time cleanup that unlocks a chmod 000 folder first.
- Not changed: the redundant own-path disjuncts in leftoverJob stay, since it is exported and a caller may
  pass an `ours` that exists; a comment says so.

## Review 11

- The review said the refusal copy's literal own-path compare would call our own EXISTING plist, printed
  as `/private/var/...`, "a file Kosmos did not make". Measured: unreachable through create, which refuses an
  existing own plist earlier ("no folder for it") without asking launchctl; reverting that line reds nothing.
  Tracing the same shape found a live one: with our plist ABSENT, realpath of it throws, so its `/private`
  spelling slipped leftoverJob's own check, read as gone, and our own job was booted out. Fixed with one `isOurs` (realpath through the folder, so an
  absent file still canonicalises) used at all three own-path checks. The absent arm is pinned through create (dropping the folder
  fallback reds it); the existing arm by a unit test, since create cannot reach it.
- The $HOME fixtures also clean up on SIGINT/SIGTERM. A SIGKILL runs no hook; that residual is stated in the
  test file.

## Review 12

- The post-bootout verify read a print that ANSWERED `ok:false` (a refused live execution, say) as gone,
  the failure-as-success shape. Dormant today (the live-execution gate is set once at start and the first
  print already needed ok), but unpinned. Now any answered print is "not confirmed"; only launchd's
  not-found throw confirms. Pinned by an ok:false verify test.
- The two temp plist fixtures are now registered for the same cleanup as the $HOME ones.

## Weakest premise

That a real agent's plist never lives in a temp folder. Kosmos writes real plists to
~/Library/LaunchAgents; only a sandboxed launch root (tests, set by AGENT_WORKFORCE_LAUNCH) puts them in
temp. A person who pointed AGENT_WORKFORCE_LAUNCH at a temp folder on purpose would have their job
treated as a leftover when they create the same name again; that setting is test-only.

A second, narrower one, for the GONE branch: a job whose plist was deleted while its process still runs
(an accidental `rm`, an unmounted volume) is booted out too. It cannot come back after a restart either
way, and the name is blocked until something removes it; this change makes that something the next
create, and says so in a step.
