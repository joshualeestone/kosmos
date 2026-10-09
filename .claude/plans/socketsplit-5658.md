# socketsplit-5658: the #668 tests read the board again when its offline list comes back empty

Card: kosmos#5658 (Renet, a loaded full-suite run on Mortals: the #668 control half threw a TypeError reading
`a.running` on an undefined row). Test-only.

## Done looks like

An empty offline list on a loaded host no longer turns server.socket-split.test.js red: the board is read again until
the ghost row is there (up to 3 fresh boards). If it is still missing, every test fails with a sentence naming the
reason (withheld under load, or the agent gone), never a TypeError.

## Decisions (reversible)

- Retry on the row being missing, not only on `counts.notRunning === null`: server.js empties the offline list on
  three paths (pane lines it could not read, which also nulls notRunning; a failed survey of created agents, which
  does not; a throw), and the test needs the row whichever it was.
- Every #668 test takes its row through one helper (ghostRow), so the control half asserts the row before rendering.
- The route is not changed (the card's second question): withholding the list on a poll that cannot account for the
  agents is the board's honest answer (#291's "?", couldNotAccount). A partial list on that poll would say "these are
  the stopped ones" when it cannot know.
- Weakest premise: three fresh boards on a host loaded enough to fail all three would still go red, now with a clear
  sentence; raising READS would trade suite time for that.

## Verification

- server.socket-split.test.js 3/3.
- Throwaway variants (not committed): a withheld first read passes on the second; a list withheld on every read fails
  all three tests with "no ghost row in 3 reads ... withheld the offline list", and no TypeError.

## Review log

- **Round 1 (sonnet):** nothing above NIT. All four taken: the withheld message names a parse regression as well as load; the other message names a row that failed to compose; an answer with no counts says so; the sandbox is removed in a finally (a pre-existing leak when the child fails, likelier on a loaded host).
