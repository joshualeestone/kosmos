# twosess-8321: two sessions running one agent (kosmos#8321)

## Done when
Served on PROD: when two sessions run one agent, its card and list row say "Two copies running", hovering says what that means and names the other, and the agent's page says it. One session reads neither.

## What
engine/status.js twinSessions: for each row, another session with the same name, both running an unambiguous agent process; snapshot adds `twinSession` to that card. web/index.html: twinSay, twinNote, the card's role line and the agent page's header.

## Decisions
- Notice only, no action: the card asks for the signal. Stopping a copy is a judgment the person makes.
- Only unambiguous agent commands count: `node` may be a dev server, so `kappa` running node beside the agent says nothing. Costs a miss, not a false alarm.
- The same session with a split window is one agent, as before.
- Rejected a folder comparison: the name is what folds the two rows together, which is the reported case.

## Not this
Two agents with different names in one folder. The iPhone's native agent list, which has no notice yet. A person's own same-named session running Claude reads as a copy: the words do not claim the same folder, since no folder is compared.

- On a phone the Talk tab hides the page's sentence and there is no hover, so the row's "Two copies running" is what a phone shows; the sentence is on Profile.

## Weakest premise
That the fleet's own sessions never legitimately run twins under one name: on this board `tmux list-sessions` shows none.
