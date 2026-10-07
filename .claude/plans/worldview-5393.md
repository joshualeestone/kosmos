# worldview-5393: one view across worlds, slice 1 (kosmos#5393)

## Goal
From field feedback: one view of fleet health across all of a person's Kosmos worlds (#1704). It shows each
provider's state and the tasks nobody is on. It shows no invented "remaining quota", because no provider gives
Kosmos one.

## Slice 1 (this branch): an engine read and a read-only route
- `engine/worldview.js`
  - `unassignedIn(records)`: pure. Counts wider than the Assigner's rule (engine/assigner.js pick): the task is open, no
    part is given to anyone, it is not marked built, and its project is not archived. The count is split into
    `waiting` and `held`. Held means the task is on hold or its project is paused.
  - `readProjectsAt(root)`: reads that world's own `projects.json` directly. It never calls
    `projects.readAll()`, which sets LAST_READ_OK and gates writes in the running world.
    - An absent file is a real zero.
    - An unreadable file, or one that is not a list, is reported on its row. It is never counted as zero.
  - `overview({ base, runningId, cards })`: one row per world from `worlds.listWorlds`.
    - The running world gets per-provider state from its live cards: `not_paused`, or paused, with `until`
      only when a card states one.
    - Other worlds: provider state is known only while that Kosmos is open.
- `server.js`: `GET /api/worlds/overview`, token-gated like `GET /api/worlds`.
  - Removed agents are filtered by `sessionName`, as `/api/status` does.
  - Cards that cannot be read become `cards: null`, reported on the row and never shown as an empty list.
- Tests:
  - `engine/worldview-5393.test.js`
  - `server.worlds-overview-5393.test.js`
  - the board-auth-1946 list gains the route.

## Slice 2 (not here)
The page. It picks the words ("working" versus "not paused").

## Rejected
Reading another world's cards by starting or calling its board. Nothing runs there to call, and starting one is
a side effect that a read must not have.

## Decided in flight
The provider state is `not_paused`, not "working". The cards only show that no agent on that provider is rate
limited, and an idle or unknown agent also counts as not paused.

## Weakest premises
- That the Assigner's rule is what a person means by "unassigned". A task added by a webhook counts as
  waiting, even though the Assigner never hands those out.
- That a task count read from disk is fresh enough. It is only as fresh as that world's last write.

## Validation
- The slice's own tests.
- The source-reading sweep files (the 92 files that read server.js).
- The full suite once, through the queue.
- Then /challenge-loop.

- **Provider rows (reviews 3 and 4):** `until` is null unless every paused agent on the provider states a time, and
  null when the latest stated time has already passed (it is only ever in the future). Each row carries
  `signInFailed` (auth_failed cards) and `stopped` (stopped cards, which are not counted in `agents`); a provider
  with only stopped agents reads 'stopped'. No screen reads the route yet (slice 2 does), so the shape changes break
  nothing.
- **Whose worlds (review 4):** worldBase() is worlds.baseRoot(process.env), which is store.dataRootFor on this
  account's own environment, so the route lists this account's worlds only, as /api/worlds/list does.
