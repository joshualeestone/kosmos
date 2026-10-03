# noplace-5127: the Claude-Code-missing refusal names where to connect (#5127, Baron's catch)

Card: kosmos#5127 (the #5114 class). Found by Baron's What's New review, 2026-10-03.

## Finished looks like
When Claude Code is not installed yet, the create refusal a newcomer meets says "Connect a Claude account in
Settings, AI Models, and Kosmos will set it up." (it named no place), and the OpenAI alternative is its own
sentence ("Or create this agent on OpenAI instead."), as the #5126 refusals already read.

## Also
The install refusal in engine/runners.js ("Connecting a Claude account will download and set it up") named no place
either; it now says "in Settings, AI Models". It was first left alone on the belief that it only shows inside the
Connect flow; the page never calls the claude install route, so it reaches people through an agent or a native
client, outside AI Models (review iteration 1).

## Weakest premise
That the newcomer reads "and Kosmos will set it up" as the result of connecting, not a separate step.

## Checks
engine/create.test.js's #548 test pins the whole sentence a person sees in both arms (with and without the OpenAI
alternative); runners.test.js pins the install refusal; web.aimodels-name-5114.test.js keeps both placeless wordings out; the existing #2145 and
create tests match "or create this agent on OpenAI instead" case-insensitively, so the moved capital is covered.
