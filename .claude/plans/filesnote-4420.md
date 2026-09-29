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
- ROOT CAUSE (the agent's own account, on the card 15:33): the doctrine's EARLIER "### Where the files you make go"
  (engine/defaults.js) said work not tied to a project goes in "your own folder", and the agent stopped there. That
  section now says: project work in the project's folder; a file for the person in the Files folder (the only place
  they see it), naming the dmfiles section with the path; working notes in your own folder. DOCTRINE_VERSION 16.
  Same heading, so it reaches new agents and managed spans; the doctrine is the person's text once born, so existing
  agents get the rule from the pointer below, which is Kosmos's to keep current without consent.
- A one-line pointer (new marker pair kosmos:dmfiles-top, in ALL_MARKERS) for EVERY agent (Splinter 15:34: all
  agents): right BEFORE the working rules' heading when the file has them (read before the earlier rule; the person's
  own words stay first, #591), else under the first heading. dmfiles.applyTo is the one composition (birth, tellAgent).

## Rejected
- Showing an empty Files panel ("Files you ask for appear here"): Josh ruled the section hidden when empty (#3757,
  "let's not show this section"). Left to him, said on the card.
- Rewriting an existing agent's doctrine text without consent: the doctrine is the person's once born (#122).

## Weakest premise
That position and wording are why the model missed it. A model can still ignore a top line; this makes the rule the
first thing it reads and names the exact mistake, which is what is in our control.

## Where the pointer goes, and the exception it is (review iteration 1)
- Before the working rules' heading line; if that line is inside a managed span (a consented refresh), before the
  span's start marker, never inside it (inside, the refresh read as out of date forever and the two blocks deleted
  each other in turns). Tested with a real accepted-refresh file: planFor stays current, a second sync is a no-op.
- ⚠️ An EXCEPTION to #1071: plain-text rules are the person's (#122), and the pointer is inserted into them. It is
  insert-only (exactly block + blank line at a line start; cutting that out gives the file back byte for byte,
  tested on three shapes). Chosen because it is the only placement an existing agent reads before the old sentence
  it obeyed. Rejected: appending (the Files block was already at the end, and the agent still obeyed the earlier
  sentence). Weakest premise: that position in the file changes what a model obeys.
- No working rules in the file: appended like any managed block.

## Review iteration 2
- (WARNING) A file with Windows line endings (CRLF, e.g. saved from Notepad) never matched the heading line, so the
  pointer was appended after the rules: the exact placement this card fixes, for good. The heading match now allows
  the trailing CR, and the pointer is written in the file's own line ending, so the insert-only cut-out holds byte for
  byte on CRLF too (tested; dropping either half reds it).
- ACCEPTED: a pointer appended to a file with no working rules stays at the end if rules arrive later (replaced in
  place, never moved); the comment now says so. ACCEPTED: the pointer adds about 450 bytes, so an instructions file
  already at the size cap is refused whole (reported as could-not, visible), same as any other managed block.

## Review iteration 3 (converged: nothing new at BLOCKER or WARNING)
- Precise claim: the POINTER is written in the file's line ending; the Files block spliced just before it by applyTo
  is always LF (pre-existing, projects.spliceBlock), so a CRLF file comes out mixed. A model reads both the same.
- ACCEPTED NITs: the line ending is read from the whole file, so an LF file with a pasted CRLF line rewrites the
  pointer once in CRLF (one write, no loop); a copy of the heading inside a code fence above the real rules would
  draw the pointer into the fence (an unusual file, little harm). create.js comment corrected.
