# #1279 slice: the AGENT-token team-creation surface + global per-creator cap

The security-sensitive continuation of the operator-driven seam (PR #2315). Makes
`POST /api/team` callable by a same-machine PM agent with its own agent token, and
adds the per-creator GLOBAL active-agent cap. Threat model + decisions were posted
on #1279 before building; this file is the durable record.

## What this slice builds

### Auth (loopback only; NOT network)
- New `LOOPBACK_AGENT_ROUTES = {POST /api/team}` exempts the route from the
  board-token sensitive-gate so an AGENT token suffices. It is deliberately kept
  OUT of `REMOTE_AGENT_ROUTES`, so `remoteWriteGuard` refuses every NETWORK peer.
  An operator opening the bind for remote REPORTS must not thereby expose remote
  team creation; the two are decoupled.
- The handler re-enforces auth itself (report/reply precedent), two loopback paths:
  - AGENT: a valid agent token -> the creator is the AUTHENTICATED caller
    (`resolveAgentSender`), never a self-declared `body.creator`. An agent cannot
    spawn under another agent's name. An invalid token -> 403.
  - OPERATOR: the board token, no agent token -> slice-1 behaviour (createdBy =
    body.creator). No credential on an enforcing board -> 403 (the operator
    branch's board-token check).
- Roster-unreadable on the agent path -> 503 (transient, retryable), the one
  deliberate divergence from report/reply's 200-with-reason, because this is a
  create surface a caller should retry.

### Global per-creator active-agent cap (AGENT path only; operator exempt)
- `activeAgentsCreatedBy(creator)` = the count of clean names whose NEWEST
  `created` birth (create.createdLog) is by that creator and which are NOT removed
  (remove.removedAgents). NOT the live roster: a just-created agent is not on the
  tmux roster until its pane appears (never under DRY_RUN), so a roster-keyed count
  would read 0 right after a create -- the exact window a spawn cap must bound.
  Birth-minus-removed counts a fresh birth immediately and frees headroom on
  removal. LAST-occurrence-wins per name so a name removed and recreated by another
  creator is attributed to its current owner (createAgentInner refuses a create
  while a name is on the removed list, so a live name's owner is always its newest
  `created` birth).
- `creatorAgentCap`: default 25, env `AGENT_WORKFORCE_CREATOR_AGENT_CAP` override,
  hard ceiling 100. Same "Kosmos owns the bound" posture as the per-team cap.
- Enforced ATOMICALLY with the create under a per-creator lock (`withCreatorLock`).
  The check+create is synchronous and adjacent today (so already atomic in Node's
  single thread); the lock is FORWARD-protection for if createTeam/createAgent ever
  grows an await before it writes the birth. Its serialization is unit-tested
  directly (a yielding fn); the route concurrency test proves the cap OUTCOME.

## Key decisions (mine, reversible; Josh can override)
- **who-can-call:** loopback agent-token OR board-token; NOT network. Rationale:
  agent-spawning is higher blast radius than report/reply.
- **cap value:** 25 default / 100 ceiling.
- **operator exempt from the cap:** the operator manages the whole fleet and is
  board-authorized; the cap defends against an AGENT spawning agents.

## What the cap IS and IS NOT (honest boundary)
The per-creator cap bounds a COOPERATIVE agent using its own assigned agent token:
it cannot spawn past the ceiling by making many teams. It is NOT a hard boundary
against a COMPROMISED or adversarial agent. A loopback caller that omits its agent
token falls to the OPERATOR branch, which is cap-exempt; on an enforcing board that
branch requires the board token, but the board token is a mode-600 file readable by
the same OS account every Kosmos-created agent already runs under -- the same access
that already lets an agent reach the uncapped POST /api/agents today. So a compromised
agent that can read the board token becomes the operator and bypasses the cap, exactly
as it could already create agents one at a time. Closing that requires a per-agent
PERMISSION model (permissions are global today, per engine/policy.js) -- the deliberately
deferred slice. The cap is a real guardrail against runaway/cooperative spawning, framed
honestly, not oversold as an adversarial boundary.

## Deliberately NOT in this slice (named on #1279)
- No NETWORK team creation, and no per-agent PERMISSION model (permissions are
  global per engine/policy.js; createdBy is the prerequisite for ever enforcing
  "a created agent cannot exceed its creator").

## Weakest premise
The count compares by clean name. A renamed agent's old births stop counting,
which can only UNDER-count (never over-refuse). Rename is rare.

## Challenge-loop findings fixed
- iter 1 (BLOCKER): TOCTOU race -> per-creator lock; and the deeper roster-lag
  count bug -> birth-minus-removed basis.
- iter 2 (WARNINGs): the lock is forward-protection not a live-race fix (createTeam
  is sync) -> corrected comments + direct lock unit tests; inert denyPaneFallback
  dropped; cleanName the gone set.
- iter 3 (BLOCKER): first-occurrence-wins mis-attributed a reused name -> last-
  occurrence-wins; 503-vs-200 documented as deliberate; hasBoardToken moved to the
  operator branch; this plan file added.

## Tests
`server.team-agent-token-1279.test.js`: network refusal, cap value, the count
(incl. removed + reused-name), the auth matrix on an enforcing board, the cap +
operator exemption + removed-frees-headroom + concurrency OUTCOME, and the
withCreatorLock serialization unit tests. The 14 seam tests still pass.
