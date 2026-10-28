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
  - GET /api/project/<id>/overview first (the route answers { project: <overview>, agentsUnreadable }). The typed
    name is checked against every member's sessionName and display name, ignoring case; none, or more than one member
    (a shared display name, or one member's sessionName that is another's display name), sends nothing and says which.
  - The screen's confirm line (openMemModal, with a straight apostrophe as all the command's text has), then "Remove <who> from <project>? [y/N]" at a terminal; --yes skips it,
    and no terminal without --yes refuses before anything is sent (as kosmos agent remove, #7362).
  - DELETE /api/project/<id>/agent/<sessionName> (what the screen's Remove sends), with the board token and the agent's
    own token, as pause does.
  - The answer in the screen's words (dropMember): "<who> is off <project> and still on your computer.", or its
    could-not sentence with the board's reason; a refusal (the members valve, 429) in the board's own words, exit 1; a
    timeout or a dropped connection after sending, "may be off", exit 3; a 200 with no project read back (the change
    landed, the read after it did not), "most likely off", exit 3; an answer that is not JSON after the DELETE left,
    "may be off", exit 3. The DELETE waits 120 s on both, as agent remove.
  - A member stored as "." or ".." is refused, as agent remove refuses those names, but with exit 1 after the
    overview read: here it is the board's data, not a typed argument.
- `cli.project-remove-member-7405.test.js`: both commands against a stub board whose overview is the board's own
  (fleet cards through projects.describe and projectview.overviewOf, wrapped as the route wraps it), never hand-built.
  The first version's hand-built top-level shape passed every test while both commands failed on a real board.

## Decided
- No server change. The route already serves non-screen callers under the members valve (60 changes an hour), and an
  agent token alone is refused there as before (it is not on AGENT_TOKEN_ROUTE_PATTERNS). One real difference from the
  screen's Remove: a command carries no browser headers, so isViaScreen is false and the board treats it as not from the
  screen even when a person typed it: it counts toward the members valve, is recorded via 'process', and what it left
  behind is noted "(not from the screen)". Accepted: the board cannot tell a person at a terminal from a script.
- A name not on the project is checked BEFORE the DELETE, because the route answers a non-member as success; without
  the check the command would report a removal that never happened.
- Rejected: matching a display name loosely (a prefix, a contains). Removing a member is not undone by the command,
  so only a whole sessionName or display name matches, and any name that could mean two members asks for a
  sessionName. Rejected: preferring an exact sessionName over a display name (a --yes script meaning one member by its
  display name would remove another without a word).
- Weakest premise: that the person or agent knows the member's display name or sessionName. `kosmos project show`
  lists both.
- Kept as agent remove has them: the Mac's "may be off" names the board's address and Windows' does not, and the Mac
  strips every space from the y/N answer.
- Not checked: that the member is gone from the project a 200 returns. After a 200 the board's removeAgent has run,
  and a member who left between the overview read and the DELETE is off, which is what the command says.
- The Mac's y/N prompt is tested at a real terminal (macOS script(1), driven from /bin/sh through a pipe, since it
  cannot use node's sockets); the answer is typed only once the prompt is printed.

## Mutation checks (run by hand, code restored after each)
- The overview read at the top level again: 9 Mac and 6 Windows cases go red.
- A 200 with no project treated as unreadable: the "most likely off" case goes red.
- The Mac refusing every answer: the terminal case goes red.
- An unreadable answer after the DELETE back to exit 1: the not-JSON case goes red.
- The old match (an exact sessionName first, display names only if none): the collision and case cases go red.
- The Mac's not-a-member arm sending anyway: the not-a-member case goes red.
- The Windows not-a-member check removed: the Windows not-a-member case goes red.
- The Mac's no-terminal guard removed: the no-terminal case goes red.
