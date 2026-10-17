# railcue-6349: a cue that the capped rail notice has more below

Card: #6349 (PigeonPete's follow-up to #6347). Owner: Angel. Stacked on `railnotice-6347` (45554ebf18); merges only
after #6347 does, rebased onto main then.

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
   box's scroll, a MutationObserver on its content (every painter, the retry handlers included), and window resize.
   The observer does not watch attributes, so toggling data-more cannot loop.
3. [x] docs/browser-checks/render-projects.js: a #6349 arm after #6347's (copies of the notice's own row, removed in
   finally): no cue when short, fade while more is below, none at the end, back when scrolled up, none once short.
   It waits two frames per step for the page's own observer instead of calling railPjMore.
4. [ ] Run render-projects.js (light and dark); mutant (drop the data-more rule): the arm goes red.
5. [ ] Screenshots of the grown box, light and dark, for the PR and the channel.

## Decided, not missed
- A fade, not a "N more" line: no new words, reversible CSS. The card left the cue open as a design call; under the
  night-shift rule a reversible call is mine. A "N more" line stays the fallback if the fade proves too subtle.
- Not the background-attachment `local` scroll shadow: the box has no background of its own, so the shadow's cover
  colour would have to copy the head's, and a mismatch paints a visible band (PigeonPete).
- Bottom only: the card is about rows BELOW the edge; a top cue for rows scrolled past is not asked for.
- Weakest premise: that a 28px fade is noticed as "more below" by everyone. Measured nowhere yet with people.
