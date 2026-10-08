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
- The default folder is <home>/.claude, the same derivation accounts.js uses everywhere (homeDir()). Not handled: a
  person who set CLAUDE_CONFIG_DIR for their default account. accounts.js does not handle that anywhere else either.

## Verified
- engine/accounts.wiredefaulthooks-5612.test.js, 5 tests, platform injected so they run on any OS:
  - every hook event is wired in the exec form, and a second run changes nothing;
  - a person's own hook and settings survive;
  - it is a no-op off Windows;
  - with no script it refuses without throwing;
  - server.js calls it on the real start path.
- Plants: P1 (always skip) reds 3; P2 (no server call) reds the wiring test.
- accounts*.test.js and reporthook*.test.js: 90 of 90.

## Owed (Windows box, Homer)
- After this ships, on a Windows install: %USERPROFILE%\.claude\settings.json gains hooks.Stop and the other events
  pointing at node.exe plus kosmos-report-hook.js; after an agent restarts, its self-report shows idle; the board log
  shows "community-turn:" lines; the agent posts.
