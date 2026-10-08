# winhooks-5612: Windows agents never report idle, so they never join the community (kosmos#5612)

## Cause (read from the served 0.7.27 source, archive/0.7.27-app-commit, and still true on main)
- The community turn (server.js, communityturn.tickOnce) prompts an agent only when its self-report says idle
  (communityturn.js: "no idle report is not idle enough"). The self-report is written by Claude Code lifecycle hooks
  (the Stop hook writes idle), via engine/kosmos-report-hook.js.
- reporthook.ensureWired has exactly two callers: install/setup.sh (Mac) and engine/accounts.js prepare (a newly
  ADDED account). Nothing on Windows (tools/windows/setup.ps1, KosmosLauncher.cs, engine/win32launch.js) ever wires
  the DEFAULT account's settings.json, although reporthook.js already has a working win32 exec form (#570).
- So a Windows agent on the default account never reports idle and is never prompted. With no posts it gets no
  replies, so the reply nudge has nothing to send either.
- Ruled out by reading the source: delivery (chat.js sends win32 lines through the supervisor channel), the community
  block (written into CLAUDE.md at create and at board start), and the switch (ON by default, written atomically).
  The Windows CLI has every community verb.

## Fix
- engine/accounts.js wireDefaultHooks(): on win32, reporthook.ensureWired(<home>/.claude/settings.json,
  hookScriptPath('win32')). Merge-only, idempotent, fail-soft. Anywhere else it is a no-op, because setup.sh owns
  the Mac.
- server.js calls it at board start, right after the community switch's one-time step. A refusal is logged to stderr
  and never stops the board. Agents pick the hooks up when they next start.

## Decisions
- win32 only. Rejected: running it on every platform. On a Mac setup.sh wires every account folder at install and
  update, and a board-start rewrite could fight it over the script path (installed bin/ against the source checkout).
  Weakest premise: setup.sh runs on every Mac update. If a Mac ever updates without it, this does not cover that.
- Board start, not each agent launch. Rejected: wiring inside win32launch (per launch). One idempotent write per boot
  is enough: the hooks live in the shared settings file, not per agent. Weakest premise: the board starts before any
  agent on that boot. An agent already running keeps its old settings until it restarts, which is said in the comment.
- The default folder comes from trust.defaultAgentSettings() (AGENT_WORKFORCE_CLAUDE_SETTINGS, else
  <AGENT_WORKFORCE_HOME or home>/.claude/settings.json), the file preacceptBypass writes for a default-account agent, so
  both writers lock the same path. Not handled: a person who set CLAUDE_CONFIG_DIR for their default account;
  win32launch deletes it for a default-account agent anyway.

## Verified
- engine/accounts.wiredefaulthooks-5612.test.js (5 tests at first, 7 after review 1), platform injected so they run on any OS:
  - every hook event is wired in the exec form, and a second run changes nothing;
  - a person's own hook and settings survive;
  - it is a no-op off Windows;
  - with no script it refuses without throwing;
  - server.js has the call right after the community switch step (a source-position check: it cannot prove the start
    path runs it; the Windows-box checks do).
- Plants: P1 (always skip) reds 3; P2 (no server call) reds the wiring test.
- accounts*.test.js and reporthook*.test.js: 90 of 90.

## Owed (Windows box, Homer)
- After this ships, on a Windows install: %USERPROFILE%\.claude\settings.json gains hooks.Stop and the other events
  pointing at node.exe plus kosmos-report-hook.js; after an agent restarts, its self-report shows idle; the board log
  shows "community-turn:" lines; the agent posts.
- A permission prompt in a Windows agent turns its tile red. A plain `claude` started by hand shows what the hook prints
  in a session Kosmos did not start.

## Full suite (baseline, before review fixes)
- 17107 tests, 16874 pass, 1 fail: the reachability guard naming engine/usageprice.js costOf, main's known red (fixed
  by #5600). This branch adds nothing to it.

## Review 1 (opus): no blockers
- Confirmed end to end, from the source: the hook script ships in the Windows zip (build-kosmos-windows.sh requires
  app/engine/kosmos-report-hook.js). process.execPath is the board's durable runtime\node.exe. The hook posts to the
  win32 board port with the agent token win32launch sets. win32launch deletes CLAUDE_CONFIG_DIR for a default-account
  agent, so the agent reads exactly <home>\.claude\settings.json.
- Fixed (WARNING): a lost update. Each Windows agent's supervisor writes its bypass consent into the same file at logon
  (trust.preacceptBypass, under the #3088 <target>.lock), as the board starts. wireDefaultHooks now takes the same
  lock on the same path (trust.defaultAgentSettings()). A held lock is a refusal for this boot. Plant P3 (no lock)
  reds the new lock test.
- Stated (WARNING): the person's own Claude Code sessions on Windows read this file too, so they now run the hook, as
  on a Mac since #561. A session Kosmos did not start may print the hook's "reporting is OFF" note. Parity, not a
  regression. Added to the Windows-box checks: start a plain `claude` in a terminal and read what it prints.
- Fixed (CONVENTION): server.js uses its existing `accounts` import.
- Fixed (NIT): a test with nothing injected wires the real engine/kosmos-report-hook.js.
- Left (NIT): accounts added earlier on Windows are not repointed (setup.sh does that on a Mac). prepare() re-wires on
  reconnect, and #570's exec form predates every Windows release.

## Review 2 (sonnet): no blockers
- Fixed (WARNING): a held lock gave up for the whole boot, so one logon collision left the account unwired for days.
  wireDefaultHooks now marks it busy, and the board tries again a minute later, 5 times (unref'd timers). Other
  refusals are not retried, because they would refuse again.
- Fixed (WARNING): the test sandbox cleared AGENT_WORKFORCE_HOME's sibling seam AGENT_WORKFORCE_CLAUDE_SETTINGS, which
  trust.defaultAgentSettings() reads first and other tests set.
- Fixed (NITs): the lock test uses withFileLock's AGENT_WORKFORCE_LOCK_MS seam (0.1 s, not 2 s) and asserts busy; the
  wiring test asserts the board starts the retrying call; the plan's test count.

## Review 3 (opus): no blockers
- Fixed (WARNING): every withFileLock refusal was reported busy, including the immediate one where the folder refuses
  the lock file (a non-EEXIST mkdir error); the board then retried 5 minutes for nothing and named the wrong cause.
  wireDefaultHooks passes withFileLock its busy and cannotAccess sentences and marks busy only for the held lock.
- Fixed (NITs): the comment says "up to 5 more times" (1 + 5 attempts); a throw returns a fixed sentence (an error
  message carried the home path into the log); the plan says the wiring test is a source-position check.

## Review 4 (sonnet): no blockers
- Fixed (WARNING): the cannot-access test plants its refusal with a read-only folder, which binds neither root nor
  Windows. It skips there and says why.
- Answered (WARNING): busy compares withFileLock's own busy sentence. The held-lock test runs the real filelock, so any
  drift in that sentence reds it. Commented at the comparison.
- Fixed (NITs): the wiring test drops its fragile distance bound (order only); the plan's default-folder sentence names
  trust.defaultAgentSettings().
- Left (NIT): the retry timers have no test of their own; busy (which drives them) is tested, and they are unref'd and
  bounded.
