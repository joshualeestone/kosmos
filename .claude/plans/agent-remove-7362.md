# #7362: `kosmos agent remove <name> [--yes]`

**Posture:** production

## Why
Test agents made by release checks (v2check0761 ... v2check0771b on the Windows box) pile up on the board, and the only
way to remove one was the person clicking "Remove this agent" on each card. Agents must never call the board's routes
by hand, so a kosmos command is the sanctioned path.

## Design
- Both CLIs (tools/windows/kosmos-cli.js, install/kosmos) call exactly the board's own Remove path:
  GET /api/agent/<name>/removal (the engine's plan, in its own words), then DELETE on the same route. Never ?force=1.
- Only this board's agents: removal.plan refuses an agent the board cannot tie to itself; force (the person's override
  for an untied card) is never sent.
- Confirm prompt "Remove <label>? [y/N]" unless --yes; no terminal and no --yes refuses before any request.
- The plan read goes with the board token (the board serves it to the person); the DELETE goes with the CLI's usual
  headers. Like every other verb, that includes the board token unless the agent runs token-only
  (KOSMOS_AGENT_TOKEN_ONLY=1), so the #4475 rule (an agent alone may remove only an agent it created) applies only to a
  token-only agent. No new exposure: any agent holding the board token could already remove through the same route.
- Outcomes: removed exit 0 (+ "can be put back" only when the plan says restore can); partial and refused exit 1 with the
  board's sentence. "May have happened" is exit 3 (as agent create's): a timeout or a dropped connection after the
  DELETE left, and a removal that threw partway (500 {error, detail}).

## Tests
cli.agent-remove-7362.test.js: Windows CLI (9) and Mac CLI (5, bash: cannot run on the Windows box) against a stub board:
--yes removes with no force; refused plan sends no DELETE (control: a DELETE would be recorded); partial exits non-zero;
no terminal without --yes sends nothing; option-shaped name refused before any request; timeout says "may".
