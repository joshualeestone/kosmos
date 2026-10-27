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
- The plan read goes with the board token (the board serves it to the person); the DELETE goes as the agent, so the
  board's token-only rules (#4475: an agent alone may remove only an agent it created) still apply.
- Outcomes: removed exit 0 (+ "can be put back" only when the plan says restore can); partial and refused exit 1 with the
  board's sentence; a timeout after the DELETE left says it MAY have been removed (exit 3, as agent create's "may").

## Tests
cli.agent-remove-7362.test.js: Windows CLI (9) and Mac CLI (5, bash: cannot run on the Windows box) against a stub board:
--yes removes with no force; refused plan sends no DELETE (control: a DELETE would be recorded); partial exits non-zero;
no terminal without --yes sends nothing; option-shaped name refused before any request; timeout says "may".
