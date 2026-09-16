# Plan: agents list status = colour, not text (#3131 + #3187)

## Goal / done-condition
On the agents LIST (lrow / #alist), in BOTH the tab and consolidated layouts, an
agent's status reads as a GROUND COLOUR (grey = idle/neutral/offline, green =
working, red = needs-you) instead of a waiting/idle/busy TEXT word. The red-!
needs-you triangle still shows. The state word is kept in a `.vh` span for screen
readers (a11y), not deleted. Done when a render shows: no visible state word, the
correct wash per state, the red-! for needs-you, in both layouts, and the browser
checks pass.

## Why (two paired 6.70 cards, one design move)
- #3131 (Josh 6.68/6.70): consolidated Agents column should not show
  waiting/idle/busy text, only the red-! when an agent needs something.
- #3187 (Josh 6.70): show grey/green/red BACKGROUNDS for agents in the agents list.
Together they are one move: replace text-status with colour-status on the agents
list. #3131's earlier fix (hideState on pjMember/#pj-one-agents) hit the wrong
surface; the text Josh still saw is in lrow()/#alist, a different render.

## Supersession (documented, not silent)
This SUPERSEDES kosmos#1191 (Josh 2026-08-27: "include a single text line ... to
indicate what they're doing, working/idle/etc") for the agents list. That is Josh's
OWN newer 6.70 instruction superseding his 08-27 one (#3131 removes the text, #3187
adds the colour), not a reversal chosen here. The `.vh` keeps the word for screen
readers, so the trail to restore visible text is one CSS line if Josh ever wants it.

## Changes
- `web/index.html` `lrow()` (running row `.lstate`): wrap `glyphOf(a) + copy.label`
  in a `<span class="vh">` so the state glyph+word are kept for screen readers but
  not shown. `answerBtn` and `alsowork` stay (actions, not status text). The red-!
  (`LROW_WARN`) is in `.lav`, untouched.
- `web/index.html` CSS: add `.lrow` grey wash (default), `.lrow.working` green,
  `.lrow.attn` red, reusing the exact `.acard.working/.attn` rgba values so list and
  grid agree. Placed after the base `.lrow` rule so source order wins.
- `web/index.html` consolidated CSS: remove `background: none` from
  `body.consolidated .lrow` so the washes show on the rail (rounded look kept).
- `docs/browser-checks/render-agent-lines.js`: #1191's three-line-stack check
  updated to the new design (name + title visible lines + tight leading; the state
  word asserted present-but-.vh-hidden; the row asserted to carry a colour wash).

## Scope decisions (reversible; Splinter owns relaying if Josh overrides)
- WIDENED per Splinter: remove the text on the tab-view list too (not only
  consolidated). lrow() is shared, so one JS change covers both.
- The GRID card view (card()/#grid) is UNCHANGED: it already carries a wash and
  keeps its state label (it has room, and was not the "status line" Josh flagged).
  If Josh wants the grid text gone too, it is a one-line follow-up.
- The not-running / needs-trust rows keep their diagnostic text ("Not running",
  "Needs trust") -- they are offline/error states, not the waiting/idle/busy the
  card names, and they were not flagged.

## Colour mapping (Josh's grey/green/red)
working -> green; needs-you (attn) -> red; everything else (idle, paused, offline,
unknown) -> grey.

## Verified
- Direct render of lrow() (idle/working/needs-you), both layouts: no visible word,
  correct wash, red-! only for needs-you.
- render-agent-lines.js (full-app server render, consolidated): PASS.
- render-workindicator-2146.js, render-restarting-2019.js: PASS (alsowork + the
  not-running rows unaffected).
- render-list-row.js: reads the OFF row text (unchanged) + the ON row .lstate cell
  geometry (grid track, unchanged) -> unaffected; only fails here for lack of the
  external server it needs.

## Weakest premise
The list/grid inconsistency (list = colour-only, grid = colour+text) is a
deliberate scope call, not covered by a test. If Josh reads it as half-done, the
grid extension is one change. Flagged to Splinter.
