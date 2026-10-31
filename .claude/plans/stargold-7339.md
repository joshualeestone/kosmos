# stargold-7339: the starred star in the brightest gold (kosmos#7339)

Josh, 2026-10-27 08:22: "If I star an agent can we make the star the brightest gold that we have? This is a pretty dingy-looking gold."

## Finished looks like
- A starred star is filled with --gold-bright (#e3b341) everywhere a star shows on the board: grid tiles, list rows and the consolidated rail, in both themes. The iPhone app sorts by stars but draws none, so it is out of scope.
- Its shape stays at 3:1 against every tile and row ground, at rest and hovered, at 1x/1.5x/2x. The edge carries the contrast: #9c741b on light (#7d5c13 hovered), --gold-bright on dark. It is drawn at 1.5px in screen pixels, and .75px on a 2x screen.
- High contrast keeps the system colour.
- render-star-6719 proves all of it, with controls that fail on the old dingy star and on a too-thin edge.

## Decided
- The bright gold is the fill, and a deeper gold edge does the contrast. A bright star with no edge is about 1.9:1 on white and fails 3:1.
- paint-order: stroke is rejected, because it halves the visible edge.
