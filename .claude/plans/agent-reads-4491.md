# agent-reads-4491: #4491 Option C slice 4, the agent's own token reaches the three everyday reads

Card: joshualeestone/kosmos#4491 (claimed:angel). Built on slices 1 to 3 (#4503, #4521, #4551) and on #4581's
project reads (#4692), all on main.

## Finished looks like
1. `GET /api/roles`, `GET /api/tasks` and `GET /api/project/<p>/room` pass the board-token gate for a loopback
   caller presenting only a valid agent token in the header. These are the reads behind `kosmos agent roles`,
   `kosmos agent role-draft`, `kosmos task list` and `kosmos room`.
2. No agent known today gains a read it did not already have, the setup guide included (see Decisions). An agent
   that holds a valid token and cannot read the board token WOULD gain these three: that is what the list grants.
3. Both CLIs (Mac `install/kosmos`, Windows `tools/windows/kosmos-cli.js`) send the agent's own token on those
   reads, plain hex only, and still send the board token.
4. Nothing an agent or the person can do today stops working.

## Why these three, and why now
Step 3 of Option C is "both CLIs stop reading board.token". That can only happen once every verb an agent uses
answers to the agent's own token. After slices 1 to 3 and #4581 the remaining agent verbs were: three reads (this
slice) and four writes (task add, task close, project create, room reopen), plus connections and community, which
have their own rules. The reads need no caller to identify, so they are the smallest next step. The writes are
slice 5: each handler has to name the caller first.

## Decisions
- **Exact keys, GET only.** The gate key is `METHOD pathname`. HEAD, every write on the same paths, and every
  neighbour (`/room/reopen`, `/project/<p>/tasks`, `/projects`) stay behind the board token. The query is not part
  of the key, so the JSON arm of the room read (no `?as=text`) opens too: it is the same rows.
- **No membership check on a read.** #4581 already decided that membership is not a boundary for reads
  (`GET /api/projects`), and every ordinary agent can read every room and task list today with the board token its
  CLI holds. Rejected: refusing a non-member agent on the room read. It would change what works today (a PM agent
  reading a room it is not on) the moment the CLI presents the token, for no gain against an agent that can still
  send the board token.
- **The setup guide is NOT an exception (reversed in review round 1, on a measurement).** The first version closed
  the room and the tasks to the guide's token, on the belief that the guide cannot read the board token. That
  belief is written in install/kosmos (the #3769 reply comment) and engine/team.js, and contradicted by
  engine/setup-assistant.js ("the `kosmos` command it runs reads the board token as its own process"). Measured
  2026-09-30 on Claude Code 2.1.285, in a throwaway project with the same rule shape (`Read(//<folder>/**)`) and
  `--dangerously-skip-permissions`: a direct `cat` of a file in the denied folder was refused (the control), and
  a script that reads the same file ran and printed it. So the guide's `kosmos room` works today, the rule closed
  nothing, and it would have become a change nobody decided at the slice where the CLIs drop the board token.
  Removed. Whether the guide should be kept from rooms is a real question for that later slice, and a card now
  carries the false comments (see the PR).
- **What the measurement does not cover:** it used a stand-in script, not the real `kosmos` command inside a real
  guide session, and only Claude. A Codex, Gemini or Grok guide has no deny file at all (setup-assistant.js says
  so), so it reads the token more easily, not less.
- **The board token is still sent.** Dropping it is a later slice, after every verb answers to the agent token
  and every agent has one.

## Known limits, stated
- The roles read with `?catalogue=1` and the room's JSON arm can each make the board fetch something (the role
  catalogue; link previews for the posts returned). Neither is new reach: every agent already causes both through
  the board token its CLI sends. The route comment names both.
- `GET /api/tasks` with no `?project=` answers the global set. An ordinary agent could already read it.

## Tests
- `server.agent-reads-4491.test.js` (new, 5): the gate refuses each read bare and with an unissued token; the
  three reads answer a token-only agent; 20 neighbours and other verbs stay closed (HEAD on all three included);
  the setup guide, with a REAL marked folder (no stub), reads them like any agent; a revoked token stops reading.
  Measured red: the room pattern unanchored (the neighbours test), and the guide test against the first version's
  guide rule (which also shows the real marker chain is what the board reads).
- `cli.agent-token-verbs-4491.test.js` (extended, 8 new): each Mac read presents a valid token and still the board
  token, and forwards nothing for a junk or absent token. Measured red against main's CLI (4 tests).
- `tools.windows-kosmos-cli-reads-4491.test.js` (new, 9): the same on Windows, with a control verb this slice did
  not change (task close) that still sends no agent header, and the hook's real token check (not a copy).
  Measured red against main's CLI (4 tests).

## Weakest premise
That a read an agent can already make with the board token is safe to give to its own token. It is true today
because every agent's CLI holds the board token. It stops being a free pass at the slice where the CLIs drop it:
from then on this list IS what an agent can read, and each entry needs to be looked at again as a grant.

## What would change this
- Josh saying an agent should only read the rooms of projects it is on: then the room read identifies the caller
  and checks membership (as task message does), for every agent.
- Josh wanting the setup guide kept from rooms and tasks: that needs the board token kept from its `kosmos`
  command first (it is not today), then a guide rule at this gate. The first version of this branch has one.

## Review round 1 (opus): 0 BLOCKER, 2 WARNING, 2 CONVENTION, 4 NIT
- W the guide premise is contradicted inside the repo: MEASURED (above); the guide rule removed, comments corrected.
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

