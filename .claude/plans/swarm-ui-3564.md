# #3564: Agent Swarms, the UI

Josh, 2026-09-24: "another type of agent... select the number of agents... fair warning that it uses a lot
of tokens... instead of just a single circle avatar, it would then look like a cluster of that same avatar";
"one voice makes the most sense", Claude only to start, "2 to 10 or variable". He approved the mock
("go on the swarm stuff", 12:13): chaoskosmos-site design/agent-swarms.html (c8284df). Split (Splinter,
22:26): Renet builds the engine (branch swarm-engine-3564), Mona the UI. Contract: Renet's comment on #3564
(22:27, route names corrected 22:37 to the singular /api/agent/<name>/swarm).

## Finished looks like
Built as the mock, against the contract, visible only when the engine is present:
1. New agent: an Agent / Swarm choice at the top. Swarm shows "Runs on Claude" (swarms use Claude for now),
   "Most helpers at once" (slider 2 to 10, default 3) with the moving warning ("While it is busy, it can use up
   to about N times the tokens of one agent..."; N from the engine's helperTokenRatio when known, else max + 1),
   and "Daily limit" (required). The button reads "Make this swarm". Sends kind: 'swarm', maxHelpers,
   dailyTokenLimit on the existing create route.
2. The cluster avatar: the agent's own picture, repeated in a round cluster (2 to 7 circles drawn; past seven
   the badge carries the count), each circle lit while that helper works, badge "working/max" at 32px and up,
   the memory ring around the whole cluster. Used on the board card, list row, rails, members, and the page.
3. The swarm's page: a Swarm panel with Active / Paused (gold selected) and Stop now (outlined red, never in a
   menu), Most helpers at once (slider, PUT), and Today (tokensToday of dailyTokenLimit, unrounded, the bar,
   "Pauses itself at the limit and tells you. Resets at midnight."), and the paused sentence by reason.
4. A project's Members: a small On / Off beside a swarm (PUT /api/project/<id>/swarm/<name>).
Nothing of this shows, and no swarm route is called, until /api/status says the engine is in (flag asked of
Renet 2026-09-25 00:03).

## Weakest premise
That the engine's capability flag lands as asked. Until it does, the UI stays hidden, which is safe.

## Verification
A browser check with a fixture engine (status rows carrying the contract's swarm field and the flag; routes
answered in the check): each surface shows only with the flag; the type choice, slider, warning and limit;
the create request's body; cluster circles = min(max, 7) with lit = activeHelpers and the badge; page
controls send the contract's requests; Members On/Off; light and dark; each "shows only when" with a control.
