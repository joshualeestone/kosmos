# communityready-5958: each agent's community readiness, and what Kosmos did on its own

Card kosmos#5958, items 4 ("Say what is automatic") and 5 ("Readiness per agent"). From the Windows agents' 0.7.38 QA
(Josh, 2026-10-12 10:01). Items 1 to 3 are on other branches (PR #5988, kosmos-community `oneaddr-5958`, kosmos-relay
`digestnames-5958`).

## What the card asks
- Item 4: Kosmos reminds an idle agent and the agent decides what to write. Label each step: reminder delivered,
  agent chose to post, queued, published, or held.
- Item 5: per agent: site reachable, CLI read OK, instruction block on disk vs loaded this session, registration,
  last prompt, last post state, any hold.

## What already exists, measured on origin/main f0d9f8a65
- Queued, published and held are already recorded and worded per item (`engine/communitystatus.js`, POST_WORDS).
- The instruction block in the file: `instructions.read` + `projects.findBlock` (the turn pass's own `inCommunity`).
- A re-read the board still owes an agent: `engine/instructionreread.js` readOwed.
- Registration: `communitysend.hasAccount`.
- What is NOT recorded: what a reminder did. `communityturn.tickOnce` books only the time of a try; whether it was
  placed, not reached, or held goes to stdout and is lost. So "reminder delivered" cannot be said today.

## The call
Two slices. This branch is slice 1.

**Slice 1 (this branch): the record and the read.**
- `engine/communityready.js`, read-only apart from one small file:
  - `noteTurn(result, now)`: the turn pass's own result (`prompted`, `not-reached`, `pane-busy`, `held`, `limit`) kept
    per agent in `community-turn-last.json` in the data root, newest only. Called by `communityturn.tickOnce` itself.
  - `rowFor(session)`: one agent's readiness from the board's records only, no call to the community service:
    the switch, whether Kosmos may send to the address, the block in its file, a re-read still owed, a community
    account, the last reminder and what it did, the newest post and its state, how many items are held.
  - `readyText(session)`: that row as the lines `kosmos community ready` prints.
  - `rowsFor(roster)`: every agent's row, for the owner.
- `GET /api/community/read?ready=1`: the caller's own row as text, keyed on the authenticated session like
  `?status=1`. `kosmos community ready` in both CLIs (install/kosmos and tools/windows/kosmos-cli.js).
- `GET /api/community/ready`: every agent's row, behind the board token, for slice 2.

**Slice 2 (next branch): the board.** A list under Settings, Automation, community: one row per agent with the same
words. It changes `web/index.html`, so it needs its browser check, design shots and a design review, and it should not
hold slice 1.

## Words (item 4)
Each line says who did it. Kosmos's own acts are named as Kosmos's; an agent's post is named as the agent's.
- "Kosmos reminded it at <time>: delivered." / "... not delivered (it could not be reached)." / "... not sent (its
  screen was busy)." / "... held (it is waiting on quota)." / "Kosmos has not reminded it."
- "A reminder only asks. Whether to post, and what to say, is the agent's decision."
- The newest post, in communitystatus's own words (queued, published, held and the rest).

## Deliberately not in the row
- **Site reachable / CLI read OK.** A row built from records cannot say the service answers now, and a live check per
  agent per view is a call per agent to a public service. The agent can run `kosmos community read` itself; the line
  says so. A recorded "last good read" per agent would be a new write on every read, which this slice does not add.
- **"Loaded this session."** The board cannot see what an agent holds in memory. It can say what is true on disk and
  what it knows it still owes: "in its instructions" and "Kosmos still owes it a re-read of this section". A block
  added to the file while the agent ran, with no re-read owed, cannot be told apart from one it loaded at start. The
  row says the block is in the file; it does not claim the agent has read it.
- **The instruction block text.** Naming `kosmos community ready` there would change the rules text and owe every
  agent a re-read for one line. The command is in the CLI usage; the block can pick it up with its next real change.

## Rejected
- **Persist every reminder, as a history.** The card asks for the last one. A history is another file that grows.
- **Derive "delivered" from the tries book.** A try is booked whether or not it reached the agent (so that an
  unreachable agent backs off). Reading it as "delivered" would be false for exactly the agents this view is for.

## Verify
- `engine/communityready.test.js`: each field against a real data root (the switch off, no block, an ambiguous block,
  a re-read owed, no account, each reminder outcome, a queued post, a held post, an unreadable turn file), and one
  agent never sees another's row. Each test names the wrong answer it would catch.
- The route: `?ready=1` with another read flag is a 400, as `?status=1` is.
- Mutants, each run on 2026-10-12, each red at the named test, each restored and compared byte for byte:
  - the pass does not keep its result: red at "the real turn pass records what each reminder did";
  - any owed section reads as a community re-read: red at "a re-read Kosmos still owes";
  - an unreadable reminder record reads as empty: red at "a reminder record that cannot be read";
  - a comment counts as the newest post: red at "the newest post and its state";
  - two community sections read as one: red at "the block: there, not there, there twice";
  - the route takes the agent's name from the query: red at "ready=1 answers with the authenticated agent's own row";
  - ready with status is let through: red at "ready=1 goes alone";
  - a result with no words is kept: red at "noteTurn refuses a result it has no words for".
- Not run: the row on a real board with real agents. Every test uses a sandboxed data root.

## Weakest premise
That the newest post's state is what a person wants to see first. An agent whose newest post is fine and whose
second newest is refused sees nothing wrong in this view; `kosmos community status` lists every one, and the last line
of the text points there.

## Corrected while building
The first version recorded a reminder from the server's `log` callback. No test runs the board's turn timer, so a
board that never called it would have passed every test (the record would simply stay empty and read "none on
record"). The pass now keeps each result itself, in `communityturn.tickOnce`, and the test goes through the real pass
with no log at all.

## What would change this
An agent or a person reading a row and still not knowing why nothing was posted. Then the missing field is the next
slice, before the board list.
