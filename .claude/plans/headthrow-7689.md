# headthrow-7689: a throw after a response head no longer ends the board (kosmos#7689)

Stacked on headers-7686 (#7686, Renet), which makes sendJson serialise first and a late second head end the response.

## Sweep (card comment 10-31)
All 42 production `res.writeHead` calls on main were classified: 4 hazards, 5 handled streams, 1 safe try, 32 constant
bodies. sendJson is fixed by #7686; this branch fixes the other three.

## Change
- sendDiagnostics: JSON.stringify before the head (the route's catch then refuses: 204 to a browser download).
- GET /api/inbox?as=text: the text is built first; one local sendTextBody writes the head with it, in every branch.
- GET /api/project/:id/records?as=text: renderList first, inside a try that answers through the route's failed().
- server.headers-twice-7686.test.js: the diagnostics arm now expects the 204 refusal, not a cut.

## Rejected
A process-level unhandledRejection handler: it would hide every future instance rather than fail it.

## Proof
server.head-then-throw-7689.test.js forces each render to throw (control first, injection asserted reached). Against
#7686's server.js both arms go red (an escaped rejection; a cut instead of the 500). 14/14 with #7686's file.
