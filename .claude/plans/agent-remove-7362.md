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
cli.agent-remove-7362.test.js: Windows CLI (13) and Mac CLI (7, bash: cannot run on the Windows box) against a stub board:
--yes removes with no force; refused plan sends no DELETE (control: a DELETE would be recorded); partial exits non-zero;
no terminal without --yes sends nothing; option-shaped name refused before any request; timeout says "may".

## Review rounds (blind challenge loop)
- Round 1: no blocker. [WARNING] a dropped connection after the DELETE read as "not reached" (Windows) --> FIXED: anything but a connect failure is "may", exit 3, test. [WARNING] a 500 {error, detail} (removal threw partway) read as "did not remove" --> FIXED in both CLIs: "may be partly removed", exit 3, tests. [WARNING] plan overstated the #4475 token-only guard --> FIXED: plan states it applies only to a token-only agent. [NIT] curl 18/52/56 exited 1 --> FIXED: exit 3. [NIT] "put it back" keyed on the engine's English --> ACCEPTED (the plan carries no structured field). [NIT] token-only display name refused after confirm --> ACCEPTED (see round 3).
- Round 2: no blocker. [WARNING] bash dropped-connection line read like a timeout --> FIXED: explicit "may have been removed". [WARNING] bash outcome paths untested on this box --> FIXED: bash tests for 500 and dropped paths (run on a Mac; ENOENT on Windows). [NIT] 60 s vs 120 s removal wait --> FIXED: 120 s both. [NIT] "." and ".." --> FIXED: refused before any request, tests. [NIT] confirm case parity --> FIXED. [NIT] 5xx without detail parity --> ACCEPTED (the handler never sends one).
- Round 3: no blocker. [WARNING] a token-only agent typing a display name is refused by the board after confirming --> ACCEPTED, decided: the plan returns the typed name, not the board name, so it cannot be checked before asking; the output is honest. [NIT] ".)." after a dry-run sentence --> FIXED. [NIT] bash prompt on stdout --> FIXED: stderr. [NIT] no token-only header test --> ACCEPTED.
- Round 4: no blocker, no warning. [NIT] bash exits 1, Node 3, for a non-JSON 5xx from something in front of the board --> ACCEPTED (not from the removal handler; the board is on localhost).
- CI fix (after round 4): the "." / ".." test branched on process.platform, which the repo's host-branch rule
  (engine/windows-tests-1777) refuses unless listed; split into a Windows test and a Mac test like the others. Tests only.
