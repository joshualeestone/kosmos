# autoretell-3932: re-tell an agent once the person fixes what an Act row asked (#3932)

## Why

The project notice's Act rows (#3923: no instructions file, several Kosmos project sections, too short,
at the size limit) ask the person to fix the agent's instruction file. Nothing re-tells the agent after
they do: `syncAgent` runs only on membership, task and project changes. So the row keeps asking for a
fix already made, until the next project change. #3923 (merged as PR #4000) added a Try again.

## What exists (origin/main at 2d039be6)

- `projects.syncAgent(name, roster)` (engine/projects.js ~2929) writes the verdict onto every project the
  agent is on: `p.told[name] = { state, because, ..., at: ISO }`. `changed`/`added` describe one write
  and are not stored.
- The Try again route, `POST .../?retell=1` (server.js ~15771), runs syncAgent, then for each project in
  `told.added` that the agent is still on, `projects.speakOfMembership(name, proj, 'listed', roster)`
  (types the "listed" line into the running agent, so a stored TOLD stays true). Agent-made calls are
  bounded (RETELL_RECENT, 60 an hour); the screen is not.

## The change (server only)

1. Lift the retell core out of the route into one function, e.g. `retellMember(name, id, roster)`:
   syncAgent (a throw becomes COULD_NOT with a fixed sentence), then speak 'listed' for each newly
   added project the agent is still on; return { told, said, alsoSaid }. The route calls it unchanged
   in behaviour (its 404/409/500/429 guards stay in the route).
2. A light interval (built as a 30s timer like the swarm sweep, gated on liveExecutionAllowed): for
   each member whose newest stored verdict is could_not, if the agent's instruction file has an mtime
   newer than that verdict and at least SETTLE_MS (10s) old, call retellMember once. Remember the
   mtime acted on per member, so one fix triggers one retell, not one per sweep. (As built below
   corrects the details.)
3. Tests: a could_not member whose file changes after its verdict is retold once (verdict flips to told,
   the line is spoken once); an unchanged file is not; a file changed within SETTLE_MS is not yet; a
   member who left is not; a second poll with no new change does nothing (the one-shot memory).

## Not in this change (a page change; after a release freeze)

Returning the Act rows to Mona's no-button copy ("Kosmos will pick this up next time"): web/index.html.
Do it only once the server half has merged and is on a cut.

## Weakest premise

There is no server-side record of a file being open in the Kosmos editor (searched: none). The guard
is the settle window: act only when the file has not changed for SETTLE_MS. A person who pauses longer
than that mid-edit and then saves does not lose work: the editor's save carries a version and
`instructions.write` refuses a stale one ("these instructions changed since you opened them"). The
cost is a reload before their save, not an overwrite.

## As built (2026-09-27 03:13 CDT)

- `engine/autoretell.js`: `due()` decides, `sweepOnce()` remembers and retells. Pure, injected deps.
- `server.js`: `retellMember(name, id, roster)` is the Try again route's core, lifted unchanged; it calls
  `projects.syncAgent` / `projects.speakOfMembership` through the module so the #3923 stubs still reach
  it. `autoretellTick(now, acted)` is one pass (exported for tests); a 30s timer calls it, gated on
  live execution, brake `AGENT_WORKFORCE_AUTORETELL_OFF=1`.
- The file compared is `instructions.fileFor(name)`, the one tellAgent reads, not `create.instructionFile`.
- Candidates: the NEWEST could_not verdict across the agent's projects; the file must be newer than it.
- No valve: one retell per settled change to the file. Any write counts, Kosmos's own too (an
  unrelated Kosmos write can cost one extra retell, which types nothing on a could_not).
- Readiness (the `ready` check, server.js autoretellTick): a card reading `stopped` is ready (it reads
  its file when it next starts). Any other card may be running, and is ready only when staleness reads
  `current` (it started after the file's last change). Stale, whoever wrote it, and unknown wait for
  its restart; the change is not spent. Retelling an agent running on an older copy would write the
  file as Kosmos, and `toldOverride` would then show "told it on its screen" for an agent that never
  read the person's change. Review 2 found the problem; review 4 found the writer-based version beaten
  by a person's edit followed by any Kosmos write (the record keeps only the last writer); review 6
  found a stopped agent with a surviving transcript held back and an unknown start let through.
- The exact-name gate is tellAgent's own, one function both call: `projects.heldExactly(name, roster)`
  (review 5 found `name === safeKey(name)` shut out real agents like `Or.Two`; review 7 found the
  gate hand-copied). Out of scope: the same expression still appears at projects.js ~857 and
  server.js ~5249 / ~5363, which predate this branch.
- COST: for a running agent the Act row clears only after its restart, not seconds after the fix.
  The commonest row ("no instructions file yet", fixed under a running agent) always takes this path.
  The follow-up page copy must not promise that it clears by itself while the agent runs. Written on
  the card too.
- A retell that fails, even for a passing reason, is not retried until the file changes again: the
  notice's Try again retries sooner. A list of "passing" reasons to auto-retry was rejected: it would
  be a second copy of tellAgent's reasons, and drift.
- Tests: engine/autoretell.test.js (12), server.test.js, two "#3932" tests (a running agent end to end: no file, settle window,
  retell writes the block and keeps the person's words, the listed line typed once, second tick no-op),
  and a STOPPED agent named Or.Two, re-told though staleness reads stale.
- Mutations: dropping the settle, newer-than-verdict or acted checks each reds the unit tests.
