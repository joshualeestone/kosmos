# Plan: #2707 shared "brief pending" room note (one asks, the rest hold)

## The card

Found by the Kosmos-Inside-Out dogfood (2026-09-10, measured). Josh staffed 7 agents onto a
brief-less project and within minutes the room had 7 near-identical "folder empty, room empty,
what is the goal?" posts - his phone buzzed 7 times with the same question. FIX: a project
waiting on its brief shows a single shared "brief pending" state the agents see, so the FIRST
agent asks and the rest hold - one ping to Josh, not seven. Pairs with the project-brief-stub
card (#2706, shipped).

## What existed

- #2706 already writes a `BRIEF.md` stub into a project's folder on creation, seeding the Goal
  from the create-form description when given, else a placeholder.
- `messages.roomNote(projectId, text)` posts a system note in Kosmos's own voice into a
  project's room (the shape validator restricts it to the product; agents cannot forge it). It
  is how `WELCOME_ROOM_NOTE` gets into a new project's room, posted from the server routes.
- Agents read a project's room (`kosmos room` / `GET /api/project/:id/room`), so a room note is
  a genuinely SHARED surface all agents on the project see - which is what the card asks for.

## The change

- **engine/projects.js:**
  - `BRIEF_GOAL_PLACEHOLDER` extracted as a named constant (was a loose literal in
    briefStubContent), because two places now depend on the exact string: briefStubContent
    WRITES it, briefIsPending DETECTS it. A second copy would drift and silently break detection.
  - `briefIsPending(folder)`: true when the folder has no `BRIEF.md` at all, OR has the #2706 stub
    but the Goal is still the placeholder (never filled in). A project the person gave a
    description to is NOT pending - its stub Goal was seeded from that description, so the agents
    already have a goal and there is nothing to ask about. Fail-safe toward NOT pending on any
    read error (a false negative just skips a helpful note; a false positive would contradict a
    real brief).
  - `BRIEF_PENDING_NOTE`: the shared note text - read the room first, one asks here, the rest
    hold, and write the answer into BRIEF.md so it lands in the shared brief (#2706), "one
    question to the operator, not seven".
- **server.js (POST /api/projects):** after the project is created and its members are told,
  if it has agents AND `briefIsPending(made.folder)`, post the note once via `messages.roomNote`.
  Gated on agents (a brief-less project with nobody on it has no one to coordinate) and on
  pending (a described project already has a goal). Best-effort, after `told`, exactly like
  `WELCOME_ROOM_NOTE`: a note we could not post never fails the creation.

## Decisions

- **A room note, not per-agent instructions.** The card asks for "one shared state the agents
  see". A room note is genuinely single and shared (one post all see); a per-agent instruction
  block is neither. It also reuses the existing roomNote mechanism and needs no lifecycle
  (it is a historical note, not a stateful banner to resolve).
- **Fire at CREATION only** (not on later add-agent). The card's scenario is creation-with-agents
  ("Josh added 7 agents"). A later add-agent to a brief-less project is a follow-up; the note
  persists in room history for late joiners regardless. Firing on every add would need a
  "already posted" guard; creation happens once, so no guard is needed.
- **Coordination is behavioral, with the room as the serialization point.** The note tells agents
  to read the room and hold if someone already asked. It substantially reduces the 7-buzz
  problem; a residual boot-race (agents that all read an empty room within the same instant) is a
  known limit that a mechanical claim would close - noted as a possible follow-up, not built here.

## Weakest premise

That "read the room first, one asks, the rest hold" is enough coordination for the card's intent
without a mechanical serialization (a hard flag the first asker claims). It is the shared-state
the card literally describes and it fixes the common case; the simultaneous-boot race is the
residual. Left josh-review: if Josh wants a hard "only one may ask" guarantee, that is a
follow-up with a per-project claim.

## Verification

- New `engine/projects.brief-pending-2707.test.js` (8 tests): briefIsPending is true for an
  absent brief and for an unfilled-placeholder stub, false for a described/seeded Goal and a
  filled brief; a CONTROL ties detection to the SAME placeholder briefStubContent writes; the
  absolute-path guard rejects bad input; a FAIL-SAFE arm proves a brief that EXISTS but cannot be
  READ (EISDIR) is NOT pending, so the note never contradicts a real brief; and the note names
  the coordination.
- `server.projects.test.js` (+3 tests): the route posts the shared note for a brief-less staffed
  project, and does NOT for a described project (goal already set) or a project with no agents.
- Fixed the note's side-effect on existing room-asserting tests: two files held fixtures that
  created brief-less staffed projects and asserted an empty room/thread; they now pass a
  description so they are briefed (the `withThread` helper in `server.projects.test.js`, and the
  "Ops room" fixture in `server.test.js`). The note's own behavior is covered by the dedicated
  tests above, which create brief-less projects on purpose.
- `node --test` regression scope: the sweep for test files that POST a staffed project through
  the route AND inspect a room matched exactly three (`server.test.js`, `server.projects.test.js`,
  `web.mention-rename-refresh-2139.test.js`); all three pass. The note is project-scoped (keyed by
  project id), so it cannot pollute another test's room.
- Browser-checks: `docs/browser-checks/render-projects.js` and `render-thread.js` also POST
  brief-less staffed projects through the route, but they are structurally unaffected: the note is
  a `kind:'note'` row, and `ROOM_NOT_SPEECH` (web/index.html:20495) excludes `'note'` from the
  thread/speech views those checks read (`#pj-msgs` and the speech counts, skipped at 21696 and
  37566). render-projects asserts on told-state / removal UI, not room speech. CI runs the
  browser-checks as the runtime gate.

## Not done

- No add-agent-time note (creation only).
- No mechanical "only one may ask" claim (behavioral coordination via the room).
