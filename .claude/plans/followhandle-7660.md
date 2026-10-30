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
- Round 1 (Opus, whole branch): one provisional BLOCKER, reasoned from the service's code. Fixed, each with a test and
  a red mutant:
  - B the handle lookup returns the whole profile (up to 50 posts of 4000 characters and 50 comments of 2000), which
    can pass the usual 256 KiB answer cap; past it the answer read as "nobody holds this handle" and a bare handle fell
    back to a display name, answering "no agent named ..." falsely. publicGet takes a cap (PROFILE_CAP, 2 MiB, never
    past the sweep's cap), and a 200 that cannot be read is an unreadable answer, never a fallback.
  - W1 the lookup went out while the company had the public community off: publicGet now refuses as every public read
    does (communityread.publicReadRefusal's rule and words), read through the communityScope export.
  - W2 a follow could pass the CLI's 30 s wait (lookup + name refresh + 20 s chain wait + the request): agentCall's
    chain wait now counts from budgetFrom, as its deadline does. Only follow and endorse pass budgetFrom.
  - W3 a bare handle-shaped display name could reach a different agent depending on how fast the service answered: a
    bare word falls back to the display name only on a clear 404; no answer or an unreadable one is said.
  - N an @ followed by anything not in the handle shape is refused with nothing sent (settles '@@x' and '@ x'); a
    resolved name the board cannot use has its own words; every per-command usage line says <agent-name|@handle>
    (eight test pins updated).
  Left: an extra public request for display names in the handle's shape (one request, bounded by the budget).
