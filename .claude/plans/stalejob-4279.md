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
  plist path, AND it is gone or under a temp folder (`/tmp`, `/private/tmp`, `/var/folders`,
  `/private/var/folders`, `os.tmpdir()` and `$TMPDIR`, both spellings), the job is booted out, the
  creation re-checks that it is gone, and it goes on with a step saying what was removed and why (also
  logged). If the bootout does not take, it refuses as before and loads nothing.
- Everything else still refuses, unchanged: a plist at our own path, a plist that exists outside a temp
  folder, or a print that names no path. Labels are world-scoped, so a same-label job is this board's own
  agent or its leftover, and we do not unload what we cannot prove is dead.
- `leftoverJob(printed, ours)` is exported and unit-tested.
- Tests in `engine/create.test.js` (#4279): temp plist replaced and created; gone plist replaced and
  created; own path refused; present non-temp plist refused; a bootout that does not take still refuses;
  the parser reads only the first-level path. The existing "loaded with nothing on disk" test (no path in
  the print) still refuses and never boots out.

Rejected: treating a nonzero last exit or a high run count as enough on its own. A live agent that is
crash-looping today is still somebody's agent; the proof that a job is a leftover is where its plist is.

## Weakest premise

That a real agent's plist never lives in a temp folder. Kosmos writes real plists to
~/Library/LaunchAgents; only a sandboxed launch root (tests, set by AGENT_WORKFORCE_LAUNCH) puts them in
temp. A person who pointed AGENT_WORKFORCE_LAUNCH at a temp folder on purpose would have their job
treated as a leftover when they create the same name again; that setting is test-only.
