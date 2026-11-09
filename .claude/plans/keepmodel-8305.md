# keepmodel-8305 (kosmos#8305, follow-ups from #8293)

## Done when
Served on PROD: connecting a found Claude agent whose model is off the company's list starts it on a listed model and the row says which. The row's after-add sentence has a test that runs it.

## What
- engine/discover.js connect: when the kept model is refused, or no model is known for it, try Kosmos's usual default, then the rest of the menu from least costly up, against the policy. Starts on the first allowed, on the account it ran on; unknownLastRun says which. Refused only when no model on the menu is allowed.
- web/index.html foundAddedWords: the row's sentence, liftable. web.found-undo tests both arms.

## Decisions
- Item 3 (session-env and file-history are undocumented layouts): no code. A guard would need a Claude Code release to go red against; if a release changes them the agent goes to the main account with a true sentence, which is the fallback working.
- Rejected refusing with a better sentence: the row has no chooser, so a refusal is still a dead end.

## Weakest premise
That the first allowed model is acceptable to the person: the row names it and they can change it on the agent's page.
