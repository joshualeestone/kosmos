# agentpause-4771: agents can pause a project when their person asks (follow-up to #4771)

Card: joshualeestone/kosmos#4771, comment 5939536855 (Josh's report on 0.7.15 staging, b6effce46: a project paused
"in the room" kept idle-nudging an agent, which then held every task by hand). Splinter's call on the card: build
reading 1, an agent-side pause; lifting stays screen-only; and rule out reading 2 (the board's Pause pressed and the
nudge still came).

## Measured first (origin/main 2f6a91e06)
- engine/agentnudge.js openParts skips projects.isPaused and tasks.isOnHold; the only caller is the server's
  heartbeat (prompterTick, readProjects = projects.readAll()), and its nudge is the "you have been idle while you still
  have open work: task #N" text Josh's agent describes. The pause reaches it through the stored record.
- The engine already distinguished the two pauses (engine/projects.js edit: `pausedByPerson` only via the screen; a
  person's pause is lifted only via the screen). Nothing on the agent side could set one: no verb on either CLI.
- engine/recommender.js membersFrom skipped archived projects only, so a paused project's members could still be
  convened (default-off feature, but the same rule "nothing in a paused project is nudged").

## What changes
- install/kosmos and tools/windows/kosmos-cli.js: `kosmos project pause <project-id>`: PUT /api/project/<id>
  {paused:true} with the board token (it opens the route, as for create) AND the agent token (so isViaScreen is
  false: an agent's pause, never the person's). No resume verb on either CLI.
- engine/projects.js: the "Your projects" block teaches the verb beside `task built` (only when the agent has tasks,
  as built is), and says only the person resumes.
- engine/recommender.js: a paused project is not acted in (inline `paused === true`, pinned to projects.isPaused by
  its test).
- Help: the one-line description of `project` says pause on both CLIs (cli.help-lines-4785 holds them equal).

## Decided, and rejected
- Rejected: a `kosmos project resume`. The engine would let an agent lift its own (agent) pause, but Splinter's call
  is that lifting stays on the screen, so a person who asked for a pause is the one who ends it.
- Rejected: building anything for reading 2 beyond the check. The code path from a stored pause to "no nudge" is one
  read, and server.project-pause-4771.test.js drives it over HTTP the way the screen does. A check on a SERVED build
  (press Pause, wait one Prompter cycle) needs a release and an installed app; recorded on the card as needs-release.

## Weakest premise
That reading 1 is what happened on Josh's board (Splinter's premise too). The served-build check settles reading 2
without asking him. What would change my mind: a served build where the board's Pause is pressed and the idle nudge
still arrives, which would point at a reader of a different record (a second world, a stale cache) rather than the
nudge rule.

## Verification
cli.project-pause-4771 (Mac, stub board recording method, URL, body and agent token), tools.windows-kosmos-cli-
project-pause-4771 (Windows via main()), server.project-pause-4771 (sandboxed board: agent pause is not the
person's, the person's cannot be lifted by an agent, and a screen pause empties the Prompter's open work), plus the
taught line pinned in engine/tasks.test.js and the Recommender arm in engine/recommender.test.js.
