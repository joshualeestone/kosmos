# railnotice-6347: the consolidated rail's project notice no longer runs under the agents list (kosmos#6347)

## Change
web/index.html: `body.consolidated #rail-agents > .alist-pjn:not(:empty) { max-height: 40vh; overflow-y: auto;
scrollbar-width: thin; }`. The rail head's height comes from the grid row, so a long notice (measured by April: 638px
in a 600px head; 1580px with ten failing members) ran under the list. Capped, it scrolls in its own box.

## Decided
- The cap and own scroll, as April proposed on the card.
- The scrollbar stays VISIBLE (thin): a deliberate exception to #867's hidden tracks, which cover the long lists. This
  is a needs-you surface (#5688), and a hidden track could hide a row that needs the person.
- Rejected: scrolling the whole head (moves the Team map button and the head's own controls); an "N more" summary
  (more code; reversible later if the box proves too small).

## Checks
web.project-notice-3923.test.js: a new arm asserts the cap, the scroll, and no hidden track (red with
scrollbar-width: none). Browser check render-project-done-4583 passes (24).

## Weakest premise
That 40vh leaves the agents list usable on a short window. Not measured at small heights.
