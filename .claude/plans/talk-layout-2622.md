# Plan - #2622: Agent "Talk to them" screen layout

**Card:** joshualeestone/kosmos#2622 (josh-review, claimed:monalisa). Two asks; this PR ships #1.

## Ask 1 (THIS PR): search bar not full-width, on the caption's baseline

**Bug:** in `#d-sec-talk` (a `.dsec`, which is `display:flex; flex-direction:column`), the
standalone `#d-talk-search-wrap` is a column child, so it stretches to full width as its own row.
Josh: "the search bar should not be full width, put it on the same baseline as 'Just between you
and X'."

**Fix (web/index.html):** pair the caption (`#d-talk-hint`, the "Just between you and X. Nothing
here belongs to a project." line) and `#d-talk-search-wrap` in one flex row `.d-talk-caprow`,
placed under the "Talk to X" label. The caption takes the left (`flex:1`), the search is
constrained (`flex: 0 1 min(260px, 40%)`) and sits on the caption's baseline. On a phone
(max-width:480px) the row wraps so the search drops below rather than squishing. Every id is
unchanged (`#d-talk-search` etc.), so the filter JS (paintTalk / the search filter) is untouched;
the search still sits above the thread and filters it.

**Verified:** rendered old-vs-new via headless Chrome at the section width - the old search spans
full width; the new one is constrained and on the caption's baseline, and the thread is unchanged.

## Ask 2 (NOT this PR - structural, documented for a follow-up): dialog fills 100% to the bottom

Josh: the dialog box should fill the bottom of the screen 100% at any window height (kill the empty
gap). This is NOT a talk-only CSS fix. `#d-sec-talk` sits in `.dsecs`, which is the `1fr` content
column of `.dbody` (a grid with `align-items: start`, so every section is content-height). Filling
`#d-sec-talk` to 100% requires giving `.dbody` a BOUNDED height and stretching the content column,
which changes the height model shared by ALL agent-detail sections (talk, instructions, model,
memory, profile, terminal, remove), not just talk. The correct shape is: `.dbody` fills the
agent-detail content-area height; the visible `#d-sec-talk` is `flex:1` within `.dsecs`;
`#d-dmthread` is `flex:1 1 auto; min-height:0; overflow-y:auto` so the thread fills and scrolls
internally; the `.dmbar.composerbox` stays last in flow, pinned to the bottom.

Two reasons this is a separate change: (1) it is a structural change to the shared agent-detail
layout (Angel's technical lane), needing verification that no other section regresses; (2) "100%
tall at any window height, drag-stable" needs interactive window-resize verification (a live app +
Playwright), which this bot session cannot do reliably (a static screenshot cannot prove
drag-stability). Documented on the card so it is picked up by a Playwright-capable session or paired
with Angel's agent-detail work. The card stays OPEN until ask 2 lands.

## Weakest premise
That shipping ask 1 alone is acceptable while ask 2 (the more visible gap) waits. It is: ask 1 is a
clean, verified, independent improvement; ask 2 is genuinely structural and needs capabilities this
session lacks, and rushing a shared-layout change from here risks regressing the other sections.
