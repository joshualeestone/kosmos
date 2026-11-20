# moveres-8839: kosmos agent move --yes takes the name agent list prints (kosmos#8839)

## Finished means
`kosmos agent move "<name as kosmos agent list prints it>" <account> --yes` moves that agent (a name with a hyphen or a
space included), on the Mac and on Windows; an ambiguous name is refused naming both; a failed read says try again; an id
still works; Settings is unchanged.

## Root cause (measured before building)
The no-terminal path never looked the name up: it only echoed it. Only --yes asked the board, through
GET /api/agents/account-plan, which read the launch job by the typed name (machine names only). Same at the 0.8.12 pin.

## What changed
- server.js account-plan: `?resolve=1` resolves with removal.resolve over cardsForResolve (kosmos#8109's pattern, as agent
  remove and agent model). 409 ambiguous; 503 readFailed when the cards cannot be read and no job matches; 409 for a listed
  agent with no launch job; 404 only for a name on no card. Every answer carries `name`.
- install/kosmos and tools/windows/kosmos-cli.js: send resolve=1; POST the resolved name; messages keep the typed name; a
  failed read says try again.

## Second half of the card (decided, not a defect)
The automatic mover is off unless AGENT_WORKFORCE_AUTOMOVE=1 (an operator's switch); the board in the report does not set
it, so it never moves. Its sweep is not measuring there either; posted on the card as a possible card of its own.

## Rejected
- Resolving on every plan request: Settings asks by the exact machine name and must never be answered about another agent.

## Weakest premise
The cards are the same two sources agent list prints; a card list that is stale by a restart could resolve a name to an
agent whose job just vanished (then 409 "no startup job", nothing moved).

## Verify
server.agent-move-name-8839 (6, real sandboxed board), cli.agent-move-8048 (20), server.accountplan-8048: 35/35; each new
check red with it removed; resolution off reproduces the card's exact refusal.
