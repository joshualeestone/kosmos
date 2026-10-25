# roomnotice-7153: a job on this Mac can write a line into a Kosmos room (part of #5941)

Card: joshualeestone/kosmos#7153. Parent: #5941 (Josh 2026-10-25 17:15: the fleet uses Kosmos instead of Discord).

## Finished looks like
A launchd job, with no agent token and no tmux pane, runs `kosmos notice --from "<source>" --stdin <project-id>` and the
line appears in that room in Kosmos's own voice, its first words naming the source. On a board that enforces its
token, a notice without it is refused; an agent's own token cannot write one; bad input is refused with a reason and nothing is written.

## Design (decided)
- Board: `POST /api/project/<id>/notice {text, source}` writes `messages.roomNote(id, source + ': ' + text)` (the
  existing "Kosmos speaking in a room" row: from kosmos, typed into nobody's session, shown to the person).
  Board-token gated by the existing gate (every /api route); not on the agent-token route list.
  Limits: text 1..4000 characters (trimmed), source 1..40 characters, one line, no colon.
- CLI (Mac `install/kosmos` and Windows `tools/windows/kosmos-cli.js`, kept in parity): `kosmos notice --from <source>
  --stdin <project-id>`, board token only (off argv via kosmos_curl's header file on the Mac).

- The row reads `<source> (automated notice): <text>`, one line: whitespace runs, control characters and bidi
  overrides (every control and format character, as externalPost strips) become single spaces, so a job's text cannot fake another row in `kosmos room` or reorder itself.
- A CLI notice that cannot be written (board down, refused, too old) is kept in a private file and its path said, as
  `kosmos post --stdin` does: an alarm fires when the fleet is down, so the text may be its only copy.

## Rejected
- `kosmos post` from the job: needs an agent token or a pane; a launchd job has neither, so it is refused.
- `POST /api/project/<id>/room` with the board token: that is the person's own post, so an alarm would read as Josh's.
- Paging a live agent to post: fails exactly when the fleet is down, which is when the builder alarm fires.
- A new row kind or a `source` field on the row: roomNote's validator admits only the product's own notes; the source
  as the first words keeps the existing shape.

## Weakest premise
Board-token gating. #4491's guard denies board.token inside Claude Code's sandbox (agent sessions), not to a launchd job
outside it, so jobs keep it and agents lose it. Until Josh installs that guard, an agent session can still read the
token and could write a notice: the same exposure every board-token route has today.

**Accepted residual:** a notice carries outside words (a digest quotes other people) in Kosmos's voice. The
"(automated notice)" mark says what it is; only a board-token holder can write one.

## Checks
- server.roomnotice-7153.test.js: gate refusals (no token, an agent's token), a written note from kosmos with its
  source first and trimmed, every bad input refused with nothing written, both limits accepted.
- cli.notice-7153.test.js: as a job (no pane, no agent token): the request carries text and source and the board token
  in a header; refusals said and non-zero; usage refused before any request.
- tools.windows-kosmos-cli-570.test.js: the Windows verb, same arms. Parity tests (verbs, help banner) green.
- The 82 tests that read the CLI or server source: 1618, 0 failed.

## Status
- [x] code + tests
- [ ] challenge-loop
- [ ] PR
