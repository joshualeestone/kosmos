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

## Fix (as built, after review 7's reversal)
- engine/accounts.js wireDefaultHooks(): on win32 (process.platform), reporthook.ensureWired on
  trust.defaultAgentSettings() under the #3088 lock preacceptBypass takes. Merge-only, idempotent, fail-soft; a held
  lock returns busy; anywhere else a no-op, because setup.sh owns the Mac.
- Two callers. (1) server.js at board start: a busy lock is retried up to 5 more times, a minute apart, with waitMs 0.
  (2) engine/win32launch.js preacceptClaudeFirstRun, for each default-account agent, just before its Claude reads the
  file: the board and the supervisors are separate logon tasks with no order between them.
- Weakest premises, all of them:
  - an agent already running when this ships reports nothing until its next start;
  - a busy lock at a LAUNCH is not retried and not waited for (waitMs 0, one stderr line): preacceptBypass already
    waited on it, and a held lock usually means another launch is writing these same hooks; the agent is covered if
    that write or the board's landed, and otherwise is wired at its next launch;
  - the board and every supervisor run the same node.exe (the bundle's runtime\node.exe, process.execPath). If they
    ever differed, each writer would repoint the other's entry on every start: no harm to the hooks firing, but
    churn. Owed on the Windows box: the entry's command is runtime\node.exe.

## Decisions
- win32 only. Rejected: running it on every platform. On a Mac setup.sh wires every account folder at install and
  update, and a board-start rewrite could fight it over the script path (installed bin/ against the source checkout).
  Weakest premise: setup.sh runs on every Mac update. If a Mac ever updates without it, this does not cover that.
- Board start AND each default-account agent launch (REVERSED at review 7; the first version did board start only).
  The premise "the board starts before any agent" is false on Windows by design: the board and the supervisors are
  separate logon Scheduled Tasks with no order, and Claude Code reads its hooks once, at start. So an agent launched
  before the board's write ran its whole session unreported. win32launch's preacceptClaudeFirstRun now wires them too,
  just before the agent's Claude reads the file (the place it already writes the bypass consent, under the same lock),
  keyed on the REAL platform so a test injecting win32 on a Mac writes nothing. Weakest premise now: an agent ALREADY
  running when this ships reports nothing until its next start.
- The default folder comes from trust.defaultAgentSettings() (AGENT_WORKFORCE_CLAUDE_SETTINGS, else
  <AGENT_WORKFORCE_HOME or home>/.claude/settings.json), the file preacceptBypass writes for a default-account agent, so
  both writers lock the same path. Not handled: a person who set CLAUDE_CONFIG_DIR for their default account;
  win32launch deletes it for a default-account agent anyway.

## Verified
- engine/accounts.wiredefaulthooks-5612.test.js (count with grep; it grows), platform injected so they run on any OS:
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

## Review 5 (opus): no blockers
- Fixed (WARNING): a retry ran withFileLock's 2 s wait (Atomics.wait) inside a serving board, so a collision could
  stall every request for 2 s. Retries pass waitMs 0, because the minute between tries is the wait. Tested: a held
  lock with waitMs 0 refuses at once, as busy.
- Fixed (NITs): the comment says every agent launch writes the consent (win32launch), not just logon; a missing script
  refuses before making the .claude folder (tested); the plan's test count.

## Review 6 (sonnet): no blockers
- Fixed (WARNING): "refuses at once" overstated waitMs 0; filelock may spin once (about 20 ms) before refusing. The
  comments and test title say so.
- Stated (WARNING): the FIRST attempt keeps withFileLock's default wait (up to 2 s, Atomics.wait) at board start. That
  is acceptable only because it runs before the board listens; retries (in a serving board) wait 0.
- Fixed (NIT): the redundant no-script test is merged into its twin, which now also asserts no .claude folder is made.

## Review 7 (opus): no blockers
- Fixed (WARNING, a reversed decision): board start alone left agents launched in the same moment unwired for their
  whole session. Each default-account Windows launch wires the hooks too (win32launch preacceptClaudeFirstRun), on the
  real platform. Plants: P7 (no launch call) and P8 (the injected platform passed) red the new source check.
  win32launch suites 53/53, and the real ~/.claude/settings.json is unchanged by the run (stat + sha compared).
- Fixed (NIT): the server.js comment says every agent launch (not logon), and that launches now wire the hooks too.
- Left (NITs): the file mode a fresh settings.json gets depends on which writer creates it (irrelevant on Windows);
  long lines match neighbours.

## Review 8 (sonnet): no blockers
- Fixed (WARNING): wireDefaultHooks's and preacceptClaudeFirstRun's doc comments name both callers and the #5612 write.
- Fixed (WARNING): the plan's Fix section describes the design as built (two callers) and lists every weakest premise,
  including the two review 8 named (no retry at launch; one node.exe for board and supervisors).
- Fixed (NITs): the server.js comment rewrapped; the catch-all sentence covers a write failure too.
- Left (NIT): the launch-site check is a source check (P7 and P8 red it); a behavioural test would need
  preacceptClaudeFirstRun exported, and the Windows-box checks cover the behaviour.

## Review 9 (opus): no blockers
- Fixed (WARNING): the launch wiring took the default 2 s lock wait right after preacceptBypass's own, so a launch in
  a serving process could block about 4 s. It passes { waitMs: 0 }; the source check now requires exactly that (no
  injected platform).
- Carded (NIT, a sibling gap): prepare() also wires the weekly statusline (allowance.ensureStatusLine, #3946), and
  setup.sh does it for the default account on a Mac (install/setup.sh:3971); nothing does it for the Windows default
  account, so Windows default-account agents have no weekly-allowance reading. Carded as #5614, because the statusline
  command's Windows form needs its own look.
- Left (NIT): the test file has no win32 in its name, so the Windows runner's selector skips it; it injects the
  platform and runs on every OS in the main suite.

## After convergence
- The convergence full suite (17,1xx tests) failed two: costOf (main's, gone after rebasing onto #5600) and the
  Windows-runner guard (windows-tests-1777): the hooks test branches on a win32 host, so it is now in tools/windows-tests.js
  ALSO and runs on the Windows runner too. After the rebase: reachability, the runner guard and the hooks test 42/42.
