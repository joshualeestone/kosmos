# Plan: GET /api/tasks/mine + open-task list in kosmos handoff (kosmos#6506, ruling 3)

## Goal (what is true when done)
The deferred half of #6506: `kosmos handoff` also lists the agent's own assigned OPEN tasks across
its projects. This needs a board route the board did not have, so ruling 3 is two parts:
1. a read-only board route `GET /api/tasks/mine` returning the CALLING agent's open tasks across
   every project it is on, authenticated by the agent token (never name-matching);
2. `kosmos handoff` calls it and prints those tasks, saying "the board did not answer" when the
   board is unreachable, never an empty list.

## Why
The first #6506 PR shipped the self-report as the live task state and deferred the assigned-task
LIST because the board had no agent-scoped "all my tasks" route. This builds that route and wires it.

## What it does (and the security ruling 3 requires)
- **Route** (server.js, in `AGENT_TOKEN_ROUTES`, GET only): resolves the caller from its agent token
  via `sendertoken.resolveName` (no roster/panes). A missing, unknown or ambiguous (twins) token is
  REFUSED with the "could not tell which agent" 403. The caller's own name (from the token, never the
  request body) picks its projects (`tokenOnlyOnProject`) and its tasks (`sameAgentName` over
  `whoNames`), so one agent's token can never return another agent's tasks. "Open" is the derived
  `listGroup(t) === 'open'`, never a stored `state`. Envelope `{ tasks:[{project,projectId,number,title}], count }`.
- **CLI**: the board call is made in the CLI layer, the `kosmos accounts` way: the per-account `$URL`
  (never hard-coded 16180), with the token in a mode-600 header file (`kosmos_curl`) / `ctx.call`
  default headers, never on the command line. `engine/handoff.js` stays HTTP-free: it formats the
  response (`tasksFact`). Unreachable -> "the board did not answer" (never an empty list); 403 -> a
  refusal; 200 -> the list (or "none open"). The three local facts (git, self-report, instruction
  file) stay offline, so a down board never stops the rest of the handoff.

## Finished looks like
- `node --test server.tasks-mine-6506.test.js engine/handoff.test.js cli.handoff-6506.test.js tools.windows-kosmos-cli-handoff-6506.test.js` green, including: cross-agent isolation (A's token never returns B's tasks), refusal of a missing/unknown/ambiguous token, only open-group tasks, and the board-did-not-answer path.
- help-lines + verb-parity + #3628 stay green (no new verb; the CLI change is inside cmd_handoff/verbHandoff).
- Full local `tools/run-tests.sh` green on the PR head, every CI check green by name.
- Raiden's independent review with no blocker.

## Weakest part of my own reasoning
The route resolves the caller with `sendertoken.resolveName` directly rather than reusing
`agentTokenOnlyCaller` (which returns null on a non-enforcing board and for a board-token caller),
because a "mine" route must identify the agent by its token even when the agent also holds the board
token. I build the same `{name,key,byKey,twins}` identity `agentTokenOnlyCaller` builds and refuse
the same ambiguous case, so the behavior matches; the risk is a future divergence between the two
identity builders. If that matters, the fix is to factor the identity-building into one shared helper.
