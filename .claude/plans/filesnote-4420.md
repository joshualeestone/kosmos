# filesnote-4420: non-Claude agents are told, at the top, where files for the person go

## Why
Josh 2026-09-28 15:29: Gemini-Test2 saved a file for him to its own folder (not Files/), so it never showed on its
page, then said it was in the files panel.

## Measured
In a sandbox, dmfiles.tellAgent writes the Files block into AGENTS.md (Codex, agy, Grok) and GEMINI.md (Gemini)
and invents no CLAUDE.md; it is written at birth and at every board start. So the block DOES reach non-Claude agents
(the card's (a) is ruled out). It is appended at the END (77% down a 300-line file), and it said "This Files folder is
inside your own folder", which names the folder the agent then used.

## Call
- The block (every runner): two new sentences right after the path: directly inside it, not your own folder above
  it and not a subfolder; only files there appear on your page; never say a file is under Files unless saved at that
  exact path. "is inside your own folder" removed (the summaries rule it carried stays).
- A one-line pointer (new marker pair kosmos:dmfiles-top, registered in ALL_MARKERS) right under the first heading
  of a NON-Claude agent's instructions; a Claude agent carries none (one left from another runner is removed), so the
  fleet's CLAUDE.md files are untouched. dmfiles.applyTo is the one composition, used at birth and by tellAgent.

## Rejected
- Showing an empty Files panel ("Files you ask for appear here"): Josh ruled the section hidden when empty (#3757,
  "let's not show this section"). Left to him, said on the card.
- The pointer for Claude agents too: no report of Claude missing it, and it would rewrite every fleet CLAUDE.md.

## Weakest premise
That position and wording are why the model missed it. A model can still ignore a top line; this makes the rule the
first thing it reads and names the exact mistake, which is what is in our control.
