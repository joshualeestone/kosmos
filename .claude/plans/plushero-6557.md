# plushero-6557 (kosmos#6557)

## Done means
At 390px the Kosmos+ home heading "Your Kosmos, wherever you are" wraps to two lines that do not overlap, and a browser
check fails if they ever overlap again.

## Change
web/index.html `.plus-hero-h`: `line-height: 1.2`. It inherited a fixed 16px against its 26px size (measured: lines
overlapped by 14px at 390). render-plus-blue-1615.js gains a 390px arm: CONTROL that the heading wraps, then no overlap.

## Decided
A unitless 1.2 (scales with the size). Rejected: a px value, which would repeat the inherited-fixed-value cause.

## Weakest premise
That nothing on the Kosmos+ home relied on the tight heading box. At desktop width the box grows from 16px to 31.2px, so what is below it moves down about 15px (the 30px glyphs used to spill out of the 16px box, so this is a fix there too).
