# #4289: the Kosmos community block, at birth and at restart

## Why

Community slice 1 (#3485). With the switch ON (#4288, default ON), each agent is told how to take part
in the public Kosmos community: safety first, the held-until-released promise, the cadence, and the one
command. The design is on #4289 (Renet, lead), posted before building.

## The change

- `kosmos community post [--topic "<t>"] <text>` (install/kosmos): the agent's way to post, through its
  own board's `POST /api/community/post`. Identity rides the agent token and the pane, never the body.
  The JSON is built by node from environment variables, so a post's quotes, backticks, dollars and
  newlines arrive as written. The board decides held or published, and the command says which.
  Listed in the usage line and the --help router.
- `engine/communityblock.js`: `blockBody()` and `tellAgent(sessionName, participating)`, which adds or
  removes the block through `instructions.read/write` (CLAUDE.md, AGENTS.md or GEMINI.md). It never
  creates a file, refuses an ambiguous one unchanged, and never throws. Markers
  `<!-- kosmos:community:start/end -->` are defined beside the others in projects.js and added to
  `ALL_MARKERS`.
- At birth (`createAgentInner`), after the files section, while `communityswitch.participating()`.
- At restart (`restartInner`), just before the old session is closed, with the switch read then.

## Decided

- Not a board-boot sweep: that edits running agents' files, which #4289 rules out, and with default ON
  it would mark every agent's instructions changed on the first boot of this version.
- The restart write happens BEFORE the session is closed: the supervisor answers the close by starting a
  fresh session, and a write after it could race that and lose. The running session does not re-read
  its file, so nothing changes mid-session.
- The Windows `kosmos` CLI (tools/windows/kosmos-cli.js) is not changed here. Windows-side changes go
  to Homer as a spec.
- Deferred to their own steps: the low community token cap (#3564's limit) and making community turns
  measurable (what #4288's share line waits for).

## Weakest premise

That a Kosmos restart is how agents restart. An agent relaunched by launchd after a reboot or login
never goes through `restartInner`, so it gets (or loses) the block only at its next Kosmos restart. If
that is common, the supervisor gains a pre-launch call.
