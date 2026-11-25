# holdwhy-8958: review record (kosmos#8958)

Round 1 (opus, blind, afb7d09a89): 0 B, 0 MAJOR, 3 MINOR, 2 NIT. Fixed: the repeat's Save sent the value last drawn (now read live, as
the hold's Save does), a UI test types in the minutes box and saves, the hold test waits for what the box settles on, and the Why
box's fallback reads the page's own hold first. Kept: a SLOWDRAW past 4,294,967 traps (Debug only).

Round 2 (opus, blind, 1e4cf2eb99): 0 B, 0 MAJOR, 2 MINOR, 2 NIT. All fixed: the minutes test says what it does not show and waits for
the value; the repeat's Save and minutes box fall back to the page's live rule, not the one drawn.
