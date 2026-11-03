# filesparity-7842: Files keeps its list through the same failures as the Profile, and more

Card: kosmos#7842 (split from #7840's last review round).

## Call
- Profile: `Board.answerStands(status)` is 200 or 404. Only those, carrying the board's words, replace a value shown;
  every other answer (no answer, 401/403, 5xx, 408, 429, any other 4xx) keeps it and is said only when nothing is.
  This narrows #7840's rule, which let any other worded 4xx replace a value (the card's second ask).
- Files (the Files screen and the agent page's section, one function `filesKeepsShown(read)`): only a new list
  replaces a list shown. Every refusal keeps it, its words said only when nothing is shown. Exception: the agent
  page's 404 (the agent has no folder of its own) replaces.

## Why Files is stricter than the Profile (review 3)
The engine's listing refusals (engine/projects.js listFiles and listDir) mix lasting reasons (not there, not a folder,
a link) with passing ones ("that folder changed while it was being read", "we could not read what is in that
folder"), and server.js sends both under the same statuses: 200 {ok:false} on the flat list, 409 at the top of
browse, 404 below it. Nothing in the answer tells them apart, and a passing one comes during any save by the agent.

## Rejected
- A status rule for Files (rounds 1 and 2): it wiped the list on those passing refusals.
- Matching refusal text on the phone: the reasons are prose and change.
- A server-side marker for a passing refusal (a field, or a 503): right in the long run, but it needs a board
  release before the phone can rely on it, and older boards would still send neither. Worth a follow-up card.

## Weakest premise
That keeping a stale list through a LASTING refusal (Files became a link, a subfolder was removed) is the lesser
harm. The list itself will not say it changed.

## Not changed
The 200 the phone cannot read is now kept on both screens (review 2), as on the Profile.
