# #3755: tips pass 2 (Josh 0.6.94, 2026-09-25 11:07)

Stacked on #3737 (tour-copy-3737): same files. Rebase onto main once #3737 merges.

## Finished looks like
- Projects list tip reads, verbatim: "Setup a Project" / "Add multiple agents to work together in one conversation with
  shared files and tasks."
- Inside a project (tab layout) the tip is four steps, each ringing its own area: Members, Conversation, Files, Tasks,
  with the four existing lines (Josh: fine with the text, wants it spread out).
- An agent's page is one stepped tip: the memory ring first (#3737's words, beside the ring), then five steps, one on
  each button, in Josh's words: Direct Message, Profile, Instructions, AI Settings, Advanced. With no memory reading
  the ring step is left out (1 of 5).
- No tip on Create Agent.
- No "?" in the header, no help menu, and nothing (tips, the Settings tips line) points at one.
- A check fails if the "?" comes back (T5), and before/after shots are on the card.

## How
- The tour's step machinery (ring, dim, N of M, Skip/Next/Got it) serves any tip with `steps`; the welcome tour is
  just the one with id 'tour' (new-board rules, "Close the tour"). A step may carry html words and ask to sit beside
  its target (the ring step).
- engine/tips.js allowlist drops 'newagent' and 'ring' (read() already drops unknown stored ids).
- Ids kept: 'project' and 'agentpage', so someone who already closed those does not get them again.

## Decided
- Stepped tips dim the page like the tour, because Josh asked for each area to be highlighted, and the tour's ring
  and dim is the highlight this app already has. Rejected: a screen tip moving between targets with no dim (no
  highlight). Would change my mind: Josh finding the dim heavy on an agent's page.
- Focus after closing an auto tip from the keyboard goes to the page (there is no "?" to hand it to).

## Weakest premise
Reusing the ids means a person who saw the old one-card agent-page tip in 0.6.93 never sees the new buttons tour. Few
people have 0.6.93 tips state yet; new ids would re-show to everyone who closed them.

## Verification
render-help-tips-3574: T3/T34 (agent page: ring 1 of 6 beside the ring, then the five buttons in his words, each
ringed and pointed at, Got it records), T3c (no reading: 1 of 5 from Direct Message), T35 (project: four areas), T9
(Create Agent shows no tip, Projects in his words), T5 (no "?", no help menu, no words pointing at it), T28, T31.
engine/tips.test.js: the allowlist and the page's TIPS table stay equal.
