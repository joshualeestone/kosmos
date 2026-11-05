# agentrestart-8071: kosmos agent restart "<name>" [--yes]

Card: kosmos#8071 (from #8048: six Mortals agents need a restart to pick up the linked skills and gates).

## Change
install/kosmos and tools/windows/kosmos-cli.js: `kosmos agent restart "<name>" [--yes]`, through the agent page's own
Restart route (POST /api/agent/<name>/restart -> removal.restart), sent as the person. It says the agent's work stops,
confirms at a terminal (or --yes; without either nothing is sent), and reads the outcome back: restarted (0), refused
or partial in the board's words (1), "may have restarted" when the board stopped answering after the request (3).

## Not done here
- No "does it answer afterwards, with its skills and hooks" check: the route returns once the session is relaunched,
  and a skills/hooks check from outside needs the folder, which the move verb's plan route already compares. Named
  on the card.
- It reaches Mortals' six agents only with a release (Mortals' installed CLI is 0.7.91).

## Weakest premise
That an agent restarting another is wanted without a person's click. The route already accepts the board token; the
verb adds a confirmed, sanctioned path, not new reach.
