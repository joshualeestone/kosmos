# agent-page-nav: the agent page gets Mona Lisa's left nav

**2026-08-23.** Josh, 09:14: "once we get you switched to Fable I want the agent
subpage design and settings subpage design implemented." This branch is the
agent page. Settings is the next branch, not this one.

The mock is `~/work/chaoskosmos-site/design/agent-page.html` (live at
installkosmos.com/design/agent-page.html). It is a drawing of the page that
ships today with the boxes sorted into seven sections behind a left nav, plus
a set of rulings written into its dashed flags. This plan says which rulings
ship here, which wait, and why.

## What finished looks like

- Opening an agent lands on a page with a sticky left nav reading
  `Talk to <name> · Model · Memory · Instructions · Profile · Terminal ·
  (rule) · Remove <name>`. One section is visible at a time; the nav says which
  (`aria-current="true"`, `.on`).
- Every control that works today still works from inside its section: model
  change, account move, instructions save, picture, name/role/reports-to,
  restart, remove, the talk box, answering a question.
- The five-second poll keeps painting into every section, open or hidden
  (painters write by id), and never flips the section back. The one painter
  that measures layout (the thread's scroll-to-newest) is re-run when Talk is
  arrived at, because a hidden section measures zero.
- `openDetail(name, section)` lands on a section. Default is Talk. No caller
  passes a section yet (the card's stale-instructions mark is the candidate,
  its own card); the parameter is exercised by the browser check, including
  the unknown-section fallback and that a deep-link to Terminal captures the
  window once, not twice.
- Switching sections moves keyboard focus to the section itself (visible
  focus ring), so a keyboard user's next Tab is the first control of what
  they asked for rather than the next pill. The pills are ordinary buttons:
  seven tab stops, no arrow-key roving.
- Talk and Instructions carry the mock's dot when they need the person: Talk
  when there is an open question, Instructions when the running copy is older
  than the file (the header's banner, visible from every section, and the
  dot says which section the fix is in) or the file changed under the open
  editor (the section's own note). The dot is a shape with a visually-hidden "(needs you)".
- Below 56rem the nav is a wrapping row above the content, not a column.
- Both themes checked in a real browser, screenshots in the PR and in the
  channel.

## Which of the mock's rulings ship here

Ship (markup or a one-line behaviour, all ruled by Josh or Mona Lisa on 08-22):

1. **Terminal always shows on the agent page**, whatever Engineering mode says.
   Today `paintAgentWindow` hides the box when the switch is off, which would
   make the Terminal nav item open an empty section. The switch keeps gating the
   PROJECT page only, and its own copy changes to say so (mock: "Show agents'
   windows on project pages ... Each agent's own page always shows its
   window."). The cap goes to 560px, scoped to `#d-window`, not `.pj-screen`.
2. **Restart moves under Memory as "Fresh start."** Compact and Clear are not
   drawn: there is no route and no engine, and a mock that draws them is a
   promise. #214 stays open for those two.
3. **The Model sentence names the cost.** "Changing this starts the agent again,
   so it picks up the new one" becomes the mock's wording: the restart empties
   its memory and ends anything it was part way through, including anything it
   agreed to. The button reads `Change & Restart <name>` (Josh's wording
   verbatim, the one ampersand in the build, recorded as a decision).
4. **Remove section copy: KEPT AS SHIPPED, not the mock's.** The mock's
   sentence is a generic "stops running and leaves the board, nothing is
   deleted". The engine already paints a state-specific one
   (`engine/remove.js:636`, tested): it says whether this agent is set to
   start on its own, which the generic wording loses. The section holds the
   existing block unchanged.

Wait (each is its own card, none is a restyle):

- The three-rung Model picker (provider / account / model) that absorbs Move.
  Engine work plus the could-not-look middle rung. Today's two controls stay,
  inside the Model section.
- The Profile port of the create screen's Reports-to (#298 shape: you first,
  leave her out of her own menu, loop guard, empty resolves to you).
- "Saved. April will not answer to Ava until you restart her" after a rename.
- The picture-rejected sentence and current-picture fallback.
- The Talk receipt rule (silent on success), #215's way forward, #212's
  explanation: all need the section to exist first, which is what this branch
  gives them.

## How

All in `web/index.html`, which is the whole front end.

- Markup: inside `#panel-detail`, after `.dhead`, a `.dbody` grid: `nav.snav`
  with seven `button[data-go]` plus a `.sep`, and a column of
  `section.dsec[data-sec]` wrappers. The existing `.dbox` elements move into
  the wrappers unchanged, ids intact, so every painter keeps working. The
  `.dgrid` wrapper goes.
- Script: `detailGo(section)` toggles `hidden` on the wrappers and `.on` /
  `aria-current` on the buttons, then focuses the section heading
  (`tabindex="-1"`). `openDetail(sessionName, section)` calls it with the
  section or `'talk'`. The poll never calls it. Nav labels that carry a name
  (`Talk to`, `Remove`) are painted from `a.name` on open and on rename.
- Dots: `detailDots()` reads the same two facts the page already renders
  (`#d-qask` visible, `#d-instr-outdated` or `#d-instr-stale` visible) and sets
  a `data-dot` attribute on the two buttons. Driven by a MutationObserver on
  those three elements' `hidden` attribute rather than a call from each
  painter, so a painter added later cannot forget to call it.
- CSS: `.dbody`, `.snav`, `.dsec`, `.snav .dot`, the media query, with the
  app's tokens (`--k-surface`, `--k-rule`, `--gold`, `--k-ink-2`).

## Checks

- `yarn test` green (text tests; the restart-reach slice between
  `d-restart-agent` and `d-remove-agent` may need re-anchoring, not weakening).
- A new `web.agent-nav.test.js` pins: seven buttons in the ruled order,
  every one of the seven original box ids inside exactly one `.dsec`, the
  wrappers default to hidden except Talk, the Terminal box no longer gated by
  Engineering mode on this page, the settings switch copy changed with it.
- A browser check `docs/browser-checks/render-agent-nav.js`: open an agent,
  click each section, assert the visible section is the clicked one and the
  others are not, in both themes, with screenshots. Visibility by
  `getBoundingClientRect`, never `offsetParent`.
