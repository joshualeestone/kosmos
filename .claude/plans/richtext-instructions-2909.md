# richtext-instructions-2909 -- rich-text formatting standard in generated agent instructions

Card: kosmos#2909. Source: Josh's 6.59 QA -- "even though we support rich text,
almost all of the agents I've talked to will still print in a giant solid block of
text. We need to let them know in their instructions that they should send rich
text-formatted messages into Kosmos in the projects and their direct agent dialogues
too." Plus a fresh-install QA report ("Rich-Text Awareness and First-Message Standard").

## What finished looks like
Every agent's generated instruction block carries a section that tells it to send
rich-text-formatted (Markdown-subset) messages by default, from its first message, in
project rooms AND direct dialogues -- with the actual supported subset, the two things
that do NOT render, and the shell-metacharacter trap. The section reaches EXISTING
agents (not only newly created ones). Node tests pin the section so a later edit cannot
silently drop it, and the doctrine-version ceremony passes.

## Scope decision (my recommendation, per Josh's standing "recommend, implement, continue")
The card recommends four things: (1) generated-instructions change, (2) CLI help,
(3) a machine-readable capabilities endpoint, (4) a `kosmos post --stdin` shell-safe
input path. I ship (1) as a focused, complete, node-testable PR -- it is exactly what
Josh asked ("in their instructions") and it directly fixes "agents print solid blocks."

Deferred to follow-up cards, with reasons:
- `kosmos post --stdin`: a distinct CLI feature touching both `install/kosmos` (bash)
  and `tools/windows/kosmos-cli.js`, with its own test surface. Bundling dilutes the
  instructions change. The instructions still warn about the shell trap with advice
  that is TRUE today (single-quote the message), so agents are not left exposed.
- Machine-readable capabilities endpoint (`kosmos-room-richtext-v1` JSON): nothing
  consumes it yet; speculative infra Josh did not ask for.

## The load-bearing implementation fact
`engine/defaults.js` version log (items 5-8) states, twice: a NEW `### ` heading reaches
agents that ALREADY EXIST (missingFrom() matches by heading; #539's refresh re-offers
missing sections to existing instruction files). An edit INSIDE an existing section
heals none of the fleet. Josh's complaint is about the EXISTING fleet, so this MUST be
a new heading.

## Supported subset -- VERIFIED against the room renderer (web/index.html pjProse/pjRichSpans on origin/main)
Renders in a room: short paragraphs (blank-line breaks), headings 1-6, bold, italic,
strikethrough, inline code, fenced code blocks, ordered+unordered lists, GFM tables,
`---` rule, emoji, bare-URL autolink.
Does NOT render in a room: `[label](url)` (shows label only, url dropped), `>` markdown
blockquote (literal text; the room has its own server quote), raw HTML (escaped).
Dialogue row surfaces (pjRich: DM + project message) render the same subset AND style
`>`. The stale comment at web/index.html:37456 ("room has no inline markdown") predates
#2239, which added pjProse's inline markdown -- trusting the code, not that comment.

## Steps
1. Add a new `### ` section to BLOCK in engine/defaults.js, placed after
   "### Answering the person who messaged you". No em/en dashes.
2. Bump DOCTRINE_VERSION 9 -> 10; add version-log item 10 (change + weakest premise).
3. Run engine/defaults.test.js; take the printed fingerprint; pin {10: '<hash>'} in
   defaults.test.js PINNED map.
4. Add a content-pin test (like the #1253 test) asserting the section's key phrases so a
   future edit cannot silently drop them.
5. Full node suite + the validation helper (test:shell) + browser-check gate (no web/
   change here, but confirm). challenge-loop to convergence. PR, reviewer joshualeestone.

## Weakest premise (named)
The subset list is verified against origin/main's renderer today; if the renderer's
subset changes later, the instructions drift. Mitigation: the instructions describe the
CONTRACT (what to use), and a future renderer change is expected to widen, not narrow,
support. A machine-readable capability endpoint (deferred card) would remove the drift
entirely.
