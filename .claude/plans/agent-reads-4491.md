# agent-reads-4491: #4491 Option C slice 4, the agent's own token reaches the three everyday reads

Card: joshualeestone/kosmos#4491 (claimed:angel). Built on slices 1 to 3 (#4503, #4521, #4551) and on #4581's
project reads (#4692), all on main.

## Finished looks like
1. `GET /api/roles`, `GET /api/tasks` and `GET /api/project/<p>/room` pass the board-token gate for a loopback
   caller presenting only a valid agent token in the header. These are the reads behind `kosmos agent roles`,
   `kosmos agent role-draft`, `kosmos task list` and `kosmos room`.
2. A caller that came through on its agent token ALONE (no board token) reads the room and the task list only of
   a project that agent is on, never the global task list, never the Tasks view's costly arm. The roles list is
   open to any valid token. A caller that also presents the board token is not narrowed.
3. Both CLIs (Mac `install/kosmos`, Windows `tools/windows/kosmos-cli.js`) send the agent's own token on those
   reads, plain hex only, and still send the board token.
4. Nothing an agent or the person can do today stops working, because every CLI still sends the board token
   (Decisions says what changes the day they stop).

## Why these three, and why now
Step 3 of Option C is "both CLIs stop reading board.token". That can only happen once every verb an agent uses
answers to the agent's own token. After slices 1 to 3 and #4581 the remaining agent verbs were: three reads (this
slice) and four writes (task add, task close, project create, room reopen), plus connections and community, which
have their own rules. The reads change nothing on the board, so they are the smallest next step (two of them
do name the caller, to narrow what a token-only caller gets: see Decisions). The writes are slice 5: each handler
has to name the caller first.

## Decisions
- **Exact keys, GET only.** The gate key is `METHOD pathname`. HEAD, every write on the same paths, and every
  neighbour (`/room/reopen`, `/project/<p>/tasks`, `/projects`) stay behind the board token. The query is not part
  of the key, so the JSON arm of the room read (no `?as=text`) opens too: it is the same rows.
- **Membership, for a token-only caller (reversed in review round 3).** The first two versions had no membership
  check, on the argument that every agent already reads every room with the board token its CLI holds. Round 3
  found the caller that argument leaves out, in this file's own words: a token minted for an agent on another
  machine (`POST /api/agent-token`) is refused as a direct network peer, but behind the person's own reverse
  proxy (`AGENT_WORKFORCE_ALLOWED_HOSTS`) it is a loopback peer. It holds no board token. Before this slice its
  room read was a 403; with the first two versions it read every room, including projects it is not on. So the
  room and task handlers ask `agentTokenOnlyCaller(req)`: enforcing board, no valid board token, so the agent
  token is what passed the gate. Then: the project must list that agent (by the token store's key, the same
  `projectHasAgent(..., byKey)` the task verbs use for a paneless caller); the task list needs `?project=`; the
  Tasks view's arm (`?view=tasks`, `?withArchived=`) is not served; an unreadable projects list is a 503 for that
  caller while the board-token caller keeps the room's old fail-open read.
- **Why not the two alternatives.** (a) Only documenting the proxied agent as a gainer: it would read other
  projects' conversations, and `kosmos post` and `react` already refuse a non-member, so reading would have been
  the odd one out. (b) Refusing the reads when the request's Host is an allowed-hosts name: the Host header is
  the caller's to set, and a catch-all proxy forwards any.
- **What this does to today's agents: nothing.** Every CLI still sends the board token, so no local agent is a
  token-only caller. The day the CLIs drop it (a later slice), every agent becomes one, and `kosmos room <a
  project I am not on>` stops working for it. That is on purpose and written here so that slice decides it with
  open eyes (for example a PM agent that reads rooms it is not on would need a stated permission).
- **The setup guide: no rule of its own; the membership rule covers it (settled after round 6, see the correction
  at the end).** On a Mac the guide IS a token-only caller: Claude Code's sandbox keeps every subprocess of it, the
  `kosmos` command included, from the board token (`guardGuideFolder` in engine/setup-assistant.js, measured there,
  and measured again by April on #4728 with the real guard). So this slice does give the guide something: the
  roles list, and the room and tasks of a project it is on. Decided: that is right. A guide on a project may
  already post in that room (slice 1) and is sent the posts addressed to it; reading that room is the same line
  every other member gets. A guide that is on no project reads no room and no tasks. What it says stays masked
  for secrets (#3769). The roles list is what it picks from when it makes an agent (#4474).
  Rejected: closing the room and tasks to the guide outright (this branch's first version). It would make the
  guide the only member of a project that cannot read the room it posts in.
- **The board token is still sent.** Dropping it is a later slice, after every verb answers to the agent token
  and every agent has one.

## Known limits, stated
- The roles read with `?catalogue=1` and the room's JSON arm can each make the board fetch something (the role
  catalogue; link previews for the posts returned). Neither is new reach: every agent already causes both through
  the board token its CLI sends. The route comment names both.
- `GET /api/tasks` with no `?project=` answers the global set to a caller with the board token, as before. A
  token-only caller gets a 403 ("say which project").

## Tests
- `server.agent-reads-4491.test.js` (new, 10; the three added in round 5 are listed there): the gate refuses each read bare and with an unissued token; the
  three reads answer a token-only agent on its own project (text and JSON arms of the room, both 200); a
  non-member is refused the room (both arms, the text arm as a bare sentence) and the tasks; the global task list
  and the Tasks view arm are not served on a token alone; the same agent WITH the board token reads all of it, and
  the board token alone still reads the global list and the Tasks view arm (controls); a token no project lists
  reads nothing but roles; an unreadable projects list is a 503 for the token-only caller and still a 200 for the
  board token; 20 neighbours and other verbs stay closed; the setup guide (a real marked folder) reads its own project's room and tasks and is refused another's; a
  revoked token stops reading.
  Measured red, one mutation each: the helper never reporting a token-only caller; the room open to non-members;
  the tasks open to non-members; the global list served; the Tasks view arm served; the unreadable list failing
  open; board-token holders narrowed too (the controls catch it); the room pattern unanchored; a guide rule present.
- `cli.agent-token-verbs-4491.test.js` (extended, 8 new): each Mac read presents a valid token and still the board
  token, and forwards nothing for a junk or absent token. Measured red against main's CLI (4 tests).
- `tools.windows-kosmos-cli-reads-4491.test.js` (new, 9): the same on Windows, with a control verb this slice did
  not change (task close) that still sends no agent header, and the hook's real token check (not a copy).
  Measured red against main's CLI (4 tests).

## Weakest premise
That "on the project" is the right line for a token-only read. It is the line `kosmos post`, `react` and the task
verbs already draw, which is why I took it, but nobody has ruled on whether an agent should be able to read rooms
of projects it is not on. Today nothing depends on the answer (every CLI sends the board token). It starts to
matter at the slice where the CLIs drop it.

## What would change this
- Josh saying any agent may read any room: delete the two `agentTokenOnlyCaller` blocks (the pin in
  server.agent-token-sender-570.test.js counts them, so it is a deliberate edit).
- Josh wanting the setup guide kept from rooms and tasks even on a project it is on: a guide rule at the gate (this
  branch's first version has one, keyed on the guide's marked folder).

## Known limits added in round 3
- The room's JSON arm marks reactions as `mine` for the viewer it assumes is the person (`reactionsFor(..., 'you')`).
  An agent reading that arm on its token sees the person's reactions marked `mine`. Both CLIs read the text arm,
  which has no such field.
- (Withdrawn: an earlier version of this line called the "guide cannot read the board token" comments false. They
  are true on a Mac. See the correction at the end.)

## Review round 1 (opus): 0 BLOCKER, 2 WARNING, 2 CONVENTION, 4 NIT
- W the guide premise is contradicted inside the repo: measured, WRONGLY (see the correction at the end); the guide
  rule was removed on it. The removal stands, for the reason now in Decisions.
- W the guide rule was only tested against stubs, with a name no guide can have: the rule is gone; the one guide
  test left uses a real marked folder and a real name.
- C "they write nothing and answer every caller alike" was false: the comment now names the catalogue download
  and the link previews.
- C "fails closed" was false for every state the real code can reach: gone with the rule.
- NITs: `kosmos agent roles` named correctly; the double token-store scan is gone with the rule; the Windows test
  uses the hook's real token check; HEAD is tested on all three reads.

## Review round 2 (sonnet): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NIT
- W "no agent gains a read" rested on every token holder also holding the board token, which the code does not
  establish: the route comment now says who gains (an agent that cannot read the board token gains exactly these
  three reads; none is known today), names the non-Claude guide, and says why a token minted for another machine
  does not reach the gate directly (remoteWriteGuard, read in this repo). NOT verified here, and said so: that the
  Kosmos+ tunnel presents the person's board token on the traffic it forwards (that code is in kosmos-relay).
- NIT the guide test cannot fail on today's gate: retitled TRIPWIRE, with a comment saying what it is for.
- NIT a dated measurement stated as fact in shipped source: the comment now points at this plan for it.

## Review round 3 (opus): 0 BLOCKER, 1 WARNING, 1 CONVENTION, 5 NIT
- W "no such agent is known today" left out the reverse-proxy arm this file documents: TAKEN AS A DESIGN CHANGE,
  not a comment fix. The room and task reads are narrowed to the caller's own projects for a token-only caller
  (Decisions, above). Seven mutations measured red.
- C the comment at POST /api/agent-token ("the name does nothing until it is live") was made false: reworded to
  say what a minted token can read at once.
- NITs: the Tasks view parameters are now IGNORED for a token-only caller (it gets the plain list, 200) rather than
  merely named; the room's
  JSON arm is asserted 200 with rows; the `mine` marking is a stated limit; #4728 is named for the stale
  comments; the pin's failure message and the CLI test's messages say the right verb; `kosmos agent roles` is
  asserted to send `catalogue=1`.

## Review round 4 (sonnet): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NIT
- W membership for the new reads is by key, looser than slice 3's exact spelling for a carded caller, and nothing
  said so: the helper's comment now says it, with why it is no wider than the token store (one file per key).
  Kept by key on purpose: a read has no body and no pane, and the token store's key is the only name it has.
- NIT an unreadable projects list is a 503 on the room and a 500 on the task list for a token-only caller: both
  closed; left as they are (the 500 is the task read's existing answer for every caller) and now tested.
- NIT the thrower in the unreadable-list test leaned on another helper's undo: it has its own now.

## Review round 5 (opus): 0 BLOCKER, 1 WARNING, 2 CONVENTION, 2 NIT
- W two decisions in the helper had no test that could fail: ADDED. (1) A valid agent token with a WRONG board
  token (header, cookie, empty header) is still narrowed; measured red when the helper treats any presented board
  token as the person's. (2) Membership by key: a project listing "Reader.Agent" admits the token kept under
  "readeragent"; measured red with an exact comparison.
- C the round-4 comment about t.after order was false (node:test runs them in registration order) and left the
  thrower installed: replaced by try/finally.
- C "there is no caller to identify" was left over from before round 3: removed from the route comment, and the two
  plan lines that said the same are corrected.
- NIT the plan said the Tasks view parameters are refused; they are ignored: corrected.
- NIT membership was checked on the first project with the id while the list filters by id: both reads now require
  the agent on EVERY stored project with that id; tested with a doubled id, measured red with "any".

## Review round 6 (sonnet): 0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NIT. CONVERGED
- NITs, all taken as wording only (no code): the route comment names `?view=tasks` alone as the Tasks-view arm
  (`?withArchived=` does nothing without it), and says why the #4581 project reads stay open while the room and
  tasks are narrowed (counts, members and the brief, not the conversation or the task text); "Finished looks
  like" 4 now carries its condition.

## Correction after round 6: my round-1 measurement was of the wrong setup
Round 1 asked whether the setup guide can read the board token. I measured a throwaway project that had the
guide's Read deny rules and NOT the sandbox block `guardGuideFolder` also writes on a Mac. The script read the file,
and I concluded the guide's `kosmos` command reads the board token. That was wrong for a Mac: April measured both
arms with the real guard (deny rules only: the script reads the file, my result; deny rules plus the sandbox:
"Operation not permitted"), and the code comment beside the sandbox block says the same. It is recorded on #4728.
What this changed here, after the six rounds:
- The route comment and this plan now say the guide on a Mac is a token-only caller and what it gains.
- The two slice-2 comments I had rewritten (in server.js and server.agent-token-gate-4491.test.js) are back to
  main's words; they were true.
- The guide test is no longer a tripwire: it asserts the guide reads its own project's room and tasks and is
  refused another project's and the global list.
- NO rule changed. The round-3 membership rule already held the guide to its own projects; the first version's
  guide rule stays out, now as a decision (above) and not on a false measurement.
Rounds 1 and 2 reviewed the branch under the wrong premise, and rounds 3 to 6 reviewed a comment that stated it, so
one more blind round follows on the corrected tree.

