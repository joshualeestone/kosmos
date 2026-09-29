# #4627: a markdown link keeps its address

Card: joshualeestone/kosmos#4627 (from #4580 item 8). Owner: PigeonPete.

## Rule
`[label](address)` renders as `label (address)`. A web address (http/https, no space) is linked exactly as a bare URL already is (xlink anchor, new tab, noreferrer); the label is never an anchor, so the destination is never hidden, which is the risk the original label-only rule guarded. A non-web address (mailto:, javascript:, relative) stays visible text and is never linked. Agents are unaffected (they receive raw text).

## Files
- web/index.html pjRichSpans step 3 (both surfaces: dialogue rows and the project room).

## Checks
- render-richtext-2067: the old label-only assertions replaced by: address shown and linked as itself; label never the anchor; relative and mailto kept as text, unlinked; a quote in a linked address stays escaped in the href; inline code inside an address renders as code with no leaked placeholder.
- render-richtext-room-2239: a room markdown link shows its address.
- Controls: both checks FAIL against origin/main's page (6 and 2 failures); mutations (quote decoded into the href; holding an address that already holds a placeholder) each fail 2.
- Found while testing: holding an address that contains inline code leaked a raw U+FFFC placeholder (restore is one pass); fixed by not holding such an address.
- Also run clean: render-mention-blue-2922, render-busy-line, render-plus-blue-1615.

## Blind review round 1 (Opus, separate reviewer): nothing above NIT
Fixed: the fast-path comment still said a link is stripped to its text; the rule comment now says a label that is itself a bare URL is linked to itself (never to the hidden address).
Accepted, written in the rule comment: an address is cut at its first `)` (as a bare URL is); the title form `(url "t")` stays text; an address naming a project file gets no "Show me" chip (it had no address at all before); inline code inside an address leaves the rest of it open to emphasis (cosmetic, no leak, pinned by the placeholder check).

## Blind review round 2 (Sonnet, separate reviewer): nothing above NIT. Converged.
Accepted: an image `![alt](url)` now shows `!alt (url)` with the url linked, not only `!alt` (visible and honest; images are not rendered in this surface); punctuation written inside the parentheses stays in the href; the unheld code-bearing address can take emphasis (cosmetic). The only other `[label](url)` handling found, engine/feedback-triage.js, is the server's feedback surface, not agent dialogue.
Next: full validation, then PR.

## Agent doctrine (Mona Lisa, 16:0x)
engine/defaults.js (lines ~245-248) tells agents a [label](address) link "shows only the label", which this card makes untrue. Left out of this branch on purpose: Mona Lisa's #4631 bumps DOCTRINE_VERSION to 19, and whichever of #4631 and this lands SECOND makes the one-sentence doctrine edit as v20 (Mona owns it), so neither PR waits on the other.
