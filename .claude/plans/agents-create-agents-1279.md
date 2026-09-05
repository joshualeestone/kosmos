# #1279: Agents can create agents — a PM agent builds a team for a stated purpose

## Scope (narrow version, per Baron Draxum's design pass on the card)

A creator makes agents OF ROLE TYPES THAT ALREADY EXIST, with the two safety rails
that have a real substrate. "Most of the value and almost none of the risk"; the
authoring surface and "create a new role type from scratch" are follow-ups.

## What ships (engine core)

- **engine/team.js** `createTeam({creator, purpose, members}, deps)`:
  - **Cap (Kosmos owns the bound, not the prompt):** refuses a team larger than the
    cap rather than obeying it. The override comes ONLY from the trusted channel
    (`deps.cap` / `AGENT_WORKFORCE_TEAM_CAP` env), NEVER from `opts` (the request),
    and is bounded by a hard `MAX_TEAM_CAP=50` ceiling.
  - **Provenance (drift prevention):** every created agent's birth record carries
    `createdBy` (the creator) and `purpose` (why), set by the team so a member
    cannot forge them.
  - **Whole-or-partial:** each member created independently; outcome is
    created / partial / refused, mirroring create's own OUTCOME enum. Each created
    entry returns `{name (slug), shownAs (display), id (read back from the profile)}`.
- **engine/create.js:** `createAgent`'s birth record gains `createdBy` + `purpose`
  (null for a plain operator create, so existing records and the only consumer,
  register.js, are unaffected).

## Deferred, with documentation on the card and in team.js

- "Inherited-or-narrower permissions" — no unified agent-permission primitive exists
  to narrow; Baron's separate second card.
- "Create a new role type from scratch" — where the default-text generator and the
  permission model must be right at once.
- The authoring surface (a PM agent's chat request -> createTeam) — thin follow-up
  on this engine core.

## Verification

Hermetic unit tests (injected createAgent) + an integration test driving the REAL
create.createAgent, all perturbation-verified. See the pre-challenge proof for the
three-round challenge-loop ledger.
