# socketsplit-5658: the #668 tests read the board again when its offline list comes back empty

Card: kosmos#5658 (Renet, a loaded full-suite run on Mortals: the #668 control half threw a TypeError reading
`a.running` on an undefined row). Test-only.

## Done looks like

An empty offline list on a loaded host no longer turns server.socket-split.test.js red: the board is read again until
the ghost row is there (up to 3 fresh boards). If it is still missing, every test fails with a sentence naming the
reason (withheld under load, or the agent gone), never a TypeError.

## Decisions (reversible)

- Retry on the row being missing, not on any one signal. Review 2 measured the likeliest load path (a stub tmux
  slower than status.js's 5 s wait): the pane list read times out, listPanes throws, and /api/status answers 500
  with { error, detail } and no agents. The route can also empty the offline list on a poll it cannot account for
  (couldNotAccount, notRunning null; unreachable with this empty stub) or when the agent survey fails. The test needs
  the row whichever it was.
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
- **Round 2 (opus):** 0 blockers, 1 warning, 2 NITs.
  - W fixed: the comment, the plan and one sentence blamed couldNotAccount, which this fixture cannot reach (an empty stub reads as zero unreadable lines). Under load the read times out and the route answers 500 with { error, detail }. The comment and plan now say so, and the failure sentence quotes the server's own error and detail (proven with a throwaway variant); the notRunning-null sentence no longer claims load.
  - NITs fixed: the sandbox is owned by a wrapper that removes it whatever happens after mkdtemp (setup included), and a failed removal never replaces the read's own error.
- **Round 3 (sonnet):** nothing above NIT. Converged. All three taken: the #5658 block moved above the original docblock so it stays with its function; the not-a-roster hint says "for example" (the quoted error names the real cause); a stale assert message.
