# teamcopy-4554: the Team choice says agents, not people (#4554)

Card: kosmos#4554 (Create a Team of Agents). Found in a day-one shot sweep of main dff1f1b18 (Mona Lisa, 2026-10-03).

## Finished looks like
The kind picker's Team card reads "A lead and the agents who report to it", the same noun as the Team screen's own line
("A lead and the agents who report to it, made in one go.") and as Josh's #4554 brief ("agents that report to it").

## The call
One word in web/index.html. Not Josh's verbatim copy (his brief says agents), so it is a reversible copy call.

## Rejected
Rewording the rest of the card or the Team screen: they already agree with each other and with the brief.

## Weakest premise
That "people" was not chosen on purpose. Nothing in #4554, #4556 or the markup's comments says it was.

## Checks
Before this branch no unit or browser check read this sentence. web.teamcopy-4554.test.js now pins it: the Team card's
description, and that the Team screen's hint opens with the same words (red on main's page, measured). The engine
comment in engine/teamseed.js that said "people" says "agents" too.
The web/ surface gate maps render-newagent-paths-4556 to the card. That check does not read the sentence; it is run on
this branch's head, and a Browser-check-surface trailer commit records the run, so the gate is satisfied.
