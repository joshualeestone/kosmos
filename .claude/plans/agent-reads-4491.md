# agent-reads-4491: #4491 Option C slice 4, the agent's own token reaches the three everyday reads

Card: joshualeestone/kosmos#4491 (claimed:angel). Built on slices 1 to 3 (#4503, #4521, #4551) and on #4581's
project reads (#4692), all on main.

## Finished looks like
1. `GET /api/roles`, `GET /api/tasks` and `GET /api/project/<p>/room` pass the board-token gate for a loopback
   caller presenting only a valid agent token in the header. These are the reads behind `kosmos agent roles`,
   `kosmos agent role-draft`, `kosmos task list` and `kosmos room`.
2. The setup guide's token alone does NOT open the room or the tasks. It could not read them before this change
   (it is kept from the board token), and it cannot after.
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
- **The setup guide is the exception, and it is closed at the gate.** It is the one agent deliberately kept from
  the board token (#3769: it talks to a newcomer and must never hand out what it can read). Opening the room and
  the tasks to "any valid agent token" would have handed it every project's conversation and task list without
  anyone deciding that. So those two are in `GUIDE_CLOSED_ROUTES`: with a token that belongs to the guide and no
  board token, the gate answers its ordinary refusal. The roles list stays open to it (the product's own text),
  and so do the #4581 project reads (that change decided them; not reopened here).
- **Recognising the guide from a token.** The token store names its agent by key (`store.safeKey` of the session
  name), not by the name. `isSetupGuide(key)` covers a marked folder; a second arm compares the recorded guide
  name's key and checks that name's folder is marked. A recorded name with an unmarked folder is not the guide
  (a removed or renamed guide closes nothing).
- **Fails closed.** If the board cannot tell whether the caller is the guide (the token does not resolve, or the
  guide's record throws), the two reads stay closed for that request. The cost is one agent retrying with the
  board token it still holds; the other direction is the leak the set exists to stop.
- **The board token is still sent.** Dropping it is a later slice, after every verb answers to the agent token
  and every agent has one.

## Known limits, stated
- This stops the instructed agent (T1 on the card), not the determined one: the guide runs as the same Mac user
  and could read the message log file directly. Same limit as every other slice; only a separate Mac user closes it.
- `GET /api/tasks` with no `?project=` answers the global set. An ordinary agent could already read it.
- `?catalogue=1` on the roles read can make the board download the role catalogue (at most once in ten minutes,
  signature checked). Any token holder can now trigger that one request; it was already reachable by every agent
  through the board token.

## Tests
- `server.agent-reads-4491.test.js` (new, 9): the gate refuses each read bare and with an unissued token; the
  three reads answer a token-only agent; 18 neighbours and other verbs stay closed; the guide is refused on the
  room and tasks (four paths) while an ordinary agent in the same board state is not, and the board token still
  opens them; roles stay open to the guide; the guide is matched by folder alone and by recorded name; an unmarked
  folder closes nothing; an unreadable guide record keeps the two reads closed; a revoked token stops reading.
  Measured red: without the guide rule (3 tests), without the key arm (1), with the room pattern unanchored (1),
  failing open (1), with tasks left out of the closed set (2).
- `cli.agent-token-verbs-4491.test.js` (extended, 8 new): each Mac read presents a valid token and still the board
  token, and forwards nothing for a junk or absent token. Measured red against main's CLI (4 tests).
- `tools.windows-kosmos-cli-reads-4491.test.js` (new, 9): the same on Windows, with a control verb this slice did
  not change (task close) that still sends no agent header. Measured red against main's CLI (4 tests).

## Weakest premise
That the setup guide is the only agent meant to be kept from rooms and tasks. If another sandboxed kind of agent
appears, it needs adding to the same rule; nothing here would notice on its own.

## What would change this
- Josh saying an agent should only read the rooms of projects it is on: then the room read identifies the caller
  and checks membership (as task message does), for every agent, and the CLI change is what makes it bite.
- Josh wanting the guide to see rooms or tasks: delete its two entries from `GUIDE_CLOSED_ROUTES`.
