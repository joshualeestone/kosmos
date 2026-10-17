# railcue-6349: a cue that the capped rail notice has more below

Card: #6349 (PigeonPete's follow-up to #6347). Owner: Angel. Was stacked on `railnotice-6347`; #6347 merged as #6356
(60cd0ab9ea) and this branch is rebased onto main.

## Done means
In the consolidated layout, while some of the Agents rail's project notice (#alist-pj-notice) is below its scrolling
box's bottom edge, the box's bottom fades into the rail head's own background, so a needs-you row there is signalled
even where the platform hides the scrollbar at rest (macOS). Scrolled to the end, or with a notice short enough to fit,
there is no fade. The cue follows the box's own scroll, whatever sets the cap.

## Steps
1. [x] web/index.html CSS: `.alist-pjn[data-more]::after`, a sticky 28px block at the box's bottom, linear-gradient
   from transparent to `var(--k-bg, #faf9f7)` (the head's background; redefined for dark and high contrast),
   pointer-events none. No scrollbar-width (the #3443 win32 bar; web.project-notice-3923.test.js pins it), and no
   fixed height (PigeonPete's cap may change from 40vh to "fill the head").
2. [x] web/index.html script: railPjMore() sets data-more when scrollHeight - scrollTop - clientHeight > 2; run on the
   box's scroll, a MutationObserver on its content (every painter, the retry handlers included), a ResizeObserver on
   the box and on each row (the rail unfolding, a column width, a row reflowing; reviews 1 and 2) and window resize.
   The observer does not watch attributes, so toggling data-more cannot loop.
3. [x] docs/browser-checks/render-projects.js: a #6349 arm after #6347's (copies of the notice's own row, removed in
   finally): no cue when short, fade while more is below, none at the end, back when scrolled up, none once short.
   It waits two frames per step for the page's own observer instead of calling railPjMore.
4. [~] render-projects.js: first run red on the arm's premise (the base notice already overflows the cap at this
   viewport); the arm now measures what is below with the cue off and passed at af59859250 (light and dark). Review 1
   added the unfold and gradient-colour steps, review 2 the row-grew step, review 13 the cap-shrank step. Mutant
   (fade rule removed, on edf576c7): red in light and dark, as required. Rerun at 20520675: red only on row-grew (rows
   were watched by content box; fixed to border box in fac88d81). A green rerun on the final head is still needed.
5. [ ] Screenshots of the grown box, light and dark, for the PR and the channel.

## Decided, not missed
- A fade, not a "N more" line: no new words, reversible CSS. The card left the cue open as a design call; under the
  night-shift rule a reversible call is mine. A "N more" line stays the fallback if the fade proves too subtle.
- Not the background-attachment `local` scroll shadow: the box has no background of its own, so the shadow's cover
  colour would have to copy the head's, and a mismatch paints a visible band (PigeonPete).
- Bottom only: the card is about rows BELOW the edge; a top cue for rows scrolled past is not asked for.
- Text in the faded 28px strip is deliberately below full contrast while more is below: that dimming IS the cue.
  Nothing is lost, because scrolling brings any row up to full
  contrast. Rejected: a cue that does not cover text (a "N more" line), kept as the fallback. Review 8.
- Weakest premise: that a 28px fade is noticed as "more below" by everyone. Measured nowhere yet with people.
- No scroll padding and no focus nudge (reviews 1 to 9). A control focused under the fade is dimmed, not hidden, which
  meets WCAG 2.4.11 at AA ("not entirely hidden"); keeping it fully clear is 2.4.12 (AAA). The padding and the JS
  nudge that chased AAA produced a new defect in five reviews running, including a click that could be moved
  mid-press, so they were removed. Weakest premise: that a dimmed focused button is clear enough to a keyboard user.
- Forced colors (Windows high contrast): the fade is hidden, so there is no cue there (review 14 suggested a Canvas
  gradient; review 13 found a gradient unreliable in that mode). Known gap, chosen over a wrong-coloured band.

- 16 sonnet (after rebasing onto main with #6324's team-map cap): the arm now shows the real Team map button, checks the
  box's cap really drops and the fade follows (more below), then hides it again (cue off at the end). The comment says the
  fade's last pixels are fully covered. Not changed: the sticky strip's 2px padding offset (cosmetic).
- 17 opus: the fixture's project already shows Team map, so the step now hides it first, reads the full-cap height,
  then shows it (the box must shrink and more be below); the page's Team map repaint is held during the step and the
  button restored in finally. Still owed before merge: a green render-projects on this head (queued, else PR CI) and the
  rail-notice-more shots retaken on the rebased page.
