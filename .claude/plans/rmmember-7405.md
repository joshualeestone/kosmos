# rmmember-7405: take a member off a project from the command line

Card: kosmos#7405 (an outside user's issue list, 0.7.70, about 35 agents). Claimed by Mona Lisa on Splinter's routing.

## Done means
- `kosmos project remove-member <project-id> "<name>" [--yes]` takes a member off a project, on the Mac/Linux command
  (install/kosmos) and the Windows command (tools/windows/kosmos-cli.js), through the route the screen's Remove sends,
  with the screen's words.
- Nothing is sent for a name that is not on the project, a name two members share, a refused usage, or a run with no
  terminal and no --yes.

## Change
- `install/kosmos` cmd_project and `tools/windows/kosmos-cli.js` projectRemoveMember:
  - GET /api/project/<id>/overview first (the route answers { project: <overview>, agentsUnreadable }). The typed name matches a member's sessionName exactly, else its display name
    ignoring case; none or more than one sends nothing and says which.
  - The screen's confirm line (openMemModal), then "Remove <who> from <project>? [y/N]" at a terminal; --yes skips it,
    and no terminal without --yes refuses before anything is sent (as kosmos agent remove, #7362).
  - DELETE /api/project/<id>/agent/<sessionName> (what the screen's Remove sends), with the board token and the agent's
    own token, as pause does.
  - The answer in the screen's words (dropMember): "<who> is off <project> and still on your computer.", or its
    could-not sentence with the board's reason; a refusal (the members valve, 429) in the board's own words, exit 1; a
    timeout or a dropped connection after sending, "may be off", exit 3; a 200 with no project read back (the change
    landed, the read after it did not), "most likely off", exit 3. The DELETE waits 120 s on both, as agent remove.
  - A member stored as "." or ".." is refused, as agent remove refuses those names.
- `cli.project-remove-member-7405.test.js`: both commands against a stub board whose overview is the board's own
  (fleet cards through projects.describe and projectview.overviewOf, wrapped as the route wraps it), never hand-built.
  The first version's hand-built top-level shape passed every test while both commands failed on a real board.

## Decided
- No server change. The route already serves non-screen callers under the members valve (60 changes an hour), and an
  agent token alone is refused there as before (it is not on AGENT_TOKEN_ROUTE_PATTERNS), so the rules are the screen's.
- A name not on the project is checked BEFORE the DELETE, because the route answers a non-member as success; without
  the check the command would report a removal that never happened.
- Rejected: matching a display name loosely (a prefix, a contains). Removing a member is not undone by the command,
  so only an exact sessionName or a whole display name matches, and a shared display name asks for the sessionName.
- Weakest premise: that the person or agent knows the member's display name or sessionName. `kosmos project show`
  lists both.

- Kept as agent remove has them: the Mac's "may be off" names the board's address and Windows' does not, and the Mac
  strips every space from the y/N answer. The Mac's y/N prompt is not tested (the test runs it with no terminal); the
  Windows one is.

## Mutation checks (run by hand, code restored after each)
- The overview read at the top level again: 9 Mac and 6 Windows cases go red.
- A 200 with no project treated as unreadable: the "most likely off" case goes red.
- The Mac's not-a-member arm sending anyway: the not-a-member case goes red.
- The Windows not-a-member check removed: the Windows not-a-member case goes red.
- The Mac's no-terminal guard removed: the no-terminal case goes red.
