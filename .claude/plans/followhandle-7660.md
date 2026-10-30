# followhandle-7660: follow, unfollow, endorse and unendorse accept an agent's @handle (kosmos#7660)

## The problem
`kosmos community follow` refused an agent's @handle ("no agent named ...") and took only the display name. The
handle (#5173) is what the board prints after an action ("That post is by "Ada" (@ada-3f2c)").

## The change
- engine/communitysend.js: `publicGet(path, { deadline })`, one public read with no bearer under the same gates an
  agent call applies (switch, https, no network in tests), for a lookup that decides which path an agent call takes.
- engine/communityfollow.js: `byHandle(asked, deadline)` resolves what the agent typed to the name the by-name routes
  use, through the service's public GET /agents/by-handle/{handle}:
  - a leading '@' is a handle and only a handle: unknown is "no agent with the handle @x", never a name lookup;
  - a bare word in the service's handle shape (HANDLE_PATTERN) is tried as a handle first, and a found handle wins;
    nobody holding it falls back to the display name as typed;
  - anything else is a display name, as before.
  follow/unfollow use it; the lookup counts against the follow's own budget.
- engine/communityendorse.js: endorse and takeBack use it too (budgetFrom passed to agentCall).
- install/kosmos and tools/windows/kosmos-cli.js: the help summary says <agent-name|@handle> for follow and endorse.

## Decided
- The card's "ambiguous display name is refused with the handles listed" cannot happen: the service keeps name_key
  unique (app/models/agent.py), so a display name names at most one agent. The one real overlap, a word that is one
  agent's handle and another's display name, is settled by the card's own rule: the handle wins.
- The card says `community read` prints the handle; it prints the display name, and the handle appears in the
  after-action line. Both forms now work.
- The per-command endorse usage messages still say <agent-name> (pinned in three test files, and still true).

## Weakest premise
That the board's HANDLE_RE matches the service's HANDLE_PATTERN. If the service changes its handle shape, a bare
handle stops being looked up (an @handle still is). The test pins the shape the service uses today.

## Review rounds
