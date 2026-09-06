# #1279 slice: the POST /api/team authoring seam

## Why this exists

Card #1279: "a PM agent builds a team for a stated purpose." The engine core
(`engine/team.js` `createTeam` + the Kosmos-owned cap + creation provenance)
merged in PR #2247, but it was reachable from nothing: `git grep createTeam`
outside its own file/tests returned no caller, and `team.js:43` says the
"chat request -> createTeam seam" is "the authoring surface's job, not this
engine core's." This slice is that seam: the HTTP route that makes createTeam
usable.

## What this slice builds

`POST /api/team` in `server.js`, immediately after the `POST /api/agents`
handler. Body: `{ creator, purpose, members: [ {name, role, provider,
account, ...} ] }`. It:

1. Parses the body (400 on unparseable, matching the sibling route).
2. Runs a per-member `#1903` liveness pre-flight in parallel
   (`create.accountConnectable`), mirroring what `POST /api/agents` added: a
   member whose account is DEFINITIVELY dead is refused BEFORE any write and
   removed from the set handed to `createTeam`, so a team never produces an
   agent that 401s on its first turn. Only a definitively-dead account refuses
   (accountConnectable's #1315 asymmetry); connected / unconfirmable /
   unresolvable all proceed (#1916 fail-open).
3. Calls `team.createTeam({ creator, purpose, members: liveMembers })`.
4. Merges the liveness refusals into the engine's own `refused[]` and
   recomputes `outcome`/`because`, so a team the engine created in full but
   which had a dead member pre-removed is honestly PARTIAL, not created.
5. HTTP code: `outcome === 'refused'` -> 400 (caller's fault: bad specs, dead
   accounts, over cap, or a shape error), else 200 (created/partial with the
   per-member detail). Same split as `/api/agents`.

## Key decisions (mine, per the decide-yourself ruling)

### Auth: operator-driven this slice, agent-driven is the next one
Every `/api/` POST is board-token-gated by the sensitive-route check in
`server.js` (the `sensitive = pathname.startsWith('/api/')` gate; only
`REMOTE_AGENT_ROUTES` = report/reply are exempt). `POST /api/team` is NOT in
that exempt set, so it inherits the board-token requirement automatically:
this route is reachable only by the board/operator, not by an arbitrary agent
token. That makes this slice OPERATOR-DRIVEN team creation, safe by
construction (the caller already holds the board).

Rejected: exempting the route and validating an AGENT token now, to make it
truly PM-agent-callable in one shot. That is the security-sensitive surface
(an agent spawning agents autonomously) and it deserves a deliberate
agent-token model (an exemption + `remoteWriteGuard`, like report/reply) and
an opt-in, built when its consumer flow exists. Named here, not smuggled in.

### Global per-creator active-agent cap: deferred, with the reason
The engine cap bounds ONE request (<= `MAX_TEAM_CAP` 50). A ceiling ACROSS
calls (so a creator cannot spawn 50, then 50 more) needs a birth-log reader
that does not exist yet: `recordBirth` writes `createdBy`, but there is no
reader in `engine/store.js` that lists agents by creator, and counting active
ones also needs a roster join + removal exclusion. That is real infra and it
belongs with the agent-token slice above, where the surface is actually
agent-reachable and the global cap earns its keep. Until then the per-request
cap + the operator-only gate are the bound.

### Not replicated from /api/agents in this slice (on the record)
- **No project ATTACH.** A member spec's `projects` still composes the managed
  block at birth (`createAgent`/#732), but `projects.addAgent` (the roster
  attach `/api/agents` runs after CREATED) is not run here.
- **No OpenAI per-model validation** (#2140/#2191) and **no first-agent home
  seed** (#166/#732) — neither is a team-creation concern in this slice.

## Weakest premise
I assume the HTTP-endpoint shape over a `kosmos` CLI verb because it matches
the report-hook auth chain and the existing `/api/agents` create surface. If a
CLI verb is preferred the rails are identical; only the entry point differs.

## Tests
`server.team-route-1279.test.js`, driven through the real route (sandboxed
roots, DRY_RUN, fake bins; the one faked boundary is Claude's `claude -p`
liveness via `create.setClaudeProbe`, the module's own #1916 seam). Covers:
happy-path created + provenance recorded; provenance cannot be forged by a
member; one dead member -> PARTIAL with the dead one in refused[] and no birth
for it; all dead -> 400 naming the sign-in (not "a team with no members"); the
cap refuses a runaway and creates nothing; a shape refusal (missing purpose)
surfaced as 400. The dead arm is deterministic without a second Claude fixture:
an empty sandbox simply has no OpenAI sign-in, so a member "on OpenAI" is a
real dead account.
