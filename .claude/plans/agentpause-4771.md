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
- engine/projects.js: the "Your projects" block teaches the verb to every member (review 1 widened it from members
  holding tasks), and says it is resumed on the screen.
- engine/agentnudge.js: the Prompter's idle nudge names the verb with the project id (review 2: existing agents only
  learn the taught line when their block is next re-written, and this nudge is the exact moment it matters).
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

## Review 1 (Sonnet, blind, source-only): 0 blockers, 3 warnings, 5 nits
- W1 the verb sends the person's board token, and PUT /api/project/:id has no membership check: kept, it is the
  `task hold` precedent exactly (same token, same gap). A dedicated agent-token route that checks membership would
  close it for both verbs at once; that is its own card, not this one.
- W2 taught only to agents holding tasks: FIXED, taught to every member (a coordinator with no tasks is the likeliest
  to be asked); arm in onhold-4771.
- W3 Windows rewrote a bad id (projectSlug strips) where the Mac refuses, on a WRITE: FIXED, refused; arms added.
- N4 Windows read {project: null} after a landed pause as a failure: FIXED (status 200 + the key); arm added.
- N5 no tokenless arm: ADDED (server: no token, no browser headers, still an agent's pause).
- N6 a repeated pause re-tells every member: kept (a repeat is an agent re-running one command; the re-tell is
  idempotent writes).
- N7 an agent's pause told members "until it is taken off hold" though no verb lifts it: FIXED, "until your person
  resumes it".
- N8 a wrong-world answer reads as unreadable on the Mac: kept (create does the same).

## Review 2 (Opus, blind, source-only): 0 blockers, 2 warnings, 7 nits
- W1 existing agents learn the taught line only when their block is next re-written (no boot re-sync for projects),
  so Josh's agent could repeat the report after the release: FIXED at the point of need, the idle nudge names
  `kosmos project pause <id>`. Rejected for now: a boot re-sync of every member's block (a wider change to when
  instruction files are rewritten; the nudge covers this card's failure).
- W2 "only your person resumes it" is not enforced for an agent's pause (any non-screen PUT lifts it, by the
  original #4771 design, pinned in server.test.js and onhold-4771): REWORDED, not enforced. Splinter's rule is about
  the person's pause, which IS enforced. The text now says it is resumed on the screen and tells the agent not to
  resume it.
- N3 held and paused together named only the pause: FIXED, both named.
- N4 the "not credited to the person" assertion keyed on "the person": FIXED, keys on "parked it".
- N5 the server test passes on origin/main: LABELLED a guard (it pins existing board behaviour for the new caller).
- N6 agent_board_token's list of person's verbs: FIXED.
- N7 Windows refusal arms asserted only non-zero: FIXED, exact codes as on the Mac.
- N8 stale plan line: FIXED.
- N9 notes (archived, swarm-off, federated members; explicit assignment still types): kept, all explicit acts or
  local-only by design.

## Review 3 (Sonnet, blind, source-only): 0 blockers, 2 warnings, 5 nits
- W1 the nudge invites an idle agent to pause, and nothing records an agent's pause, so a self-silencing pause was
  invisible: FIXED. A pause that did not come from the screen posts a room note (the agent's name when its token says
  it, else "An agent"), only on the change from running to paused; the nudge says "only if your person asked in the
  room" and that the room is told. Server arms: announced once, a repeat silent, the screen's own pause silent.
- W2 any agent can pause any project (no membership check): kept, as review 1 W1; the room note now names who did it,
  and the route fix belongs with #4491 (comment 5939670720).
- N3 the hint typed any id through plainWords: FIXED, only an id in the slug set the CLIs take as it is.
- N4 `kosmos` hardcoded in the nudge: kept, the nudge's other command already is.
- N5 Mac error sed stops at a quote: kept, shared pattern.
- N6 a person-paused project with an agent-held task reads "the person parked it": kept, conservative and true.
- N7 what to do when the person asks the agent to resume: FIXED, the taught line says to point them at the page.

## Review 4 (Opus, blind, source-only): 0 blockers, 3 warnings, 7 nits
- W1 the note named the internal session: FIXED, the roster's display name at write time (a later rename leaves the
  note as written, like any room line).
- W2 the hint rides every idle nudge and one agent's pause silences all members: ACCEPTED. The hint is conditional
  ("Only if your person asked in the room"), the room is told who paused, and the person resumes from the page. The
  alternative (drop the hint) leaves Josh's report unfixed for agents whose block has not been re-written. What would
  change my mind: rooms showing agent pauses nobody asked for.
- W3 the note's paths untested: ADDED arms for a non-screen resume, a save without paused, a refused pause (bad
  parent), and the tokenless text. A token that resolves to a name is not driven here (it needs a minted token).
- N4 a person's own terminal pause read "An agent ... If you did not ask": FIXED, "Someone", and the token read via
  presentedAgentToken (header or body).
- N5 a key-only or twin token could name the wrong agent: FIXED, only an exact name, else "Someone".
- N6 a non-screen resume was silent: FIXED, said in the room.
- N7 the note's second sentence addressed the reader as the person: FIXED, "The person can resume it on the
  project's page."
- N8 three store reads per PUT: FIXED, wasPaused reuses the existence check's read.
- N9 timeout exit codes differ Mac/Windows: kept, the same split as project create.
- N10 an all-dots id passed the nudge's check: FIXED.
