# settingsfit-5510: Settings fits a phone (kosmos#5510, slice 2)

Found during the #5510 phone pass: Settings, Community, on a 360px phone (the Android app's layout over Kosmos+, and the
at-the-computer layout too) scrolled sideways by 3px. Measured: #community-industry sized to its longest option
("A construction or trades business"), 290px in a 262px row.

Finished means: at 360 and 412, the select ends inside the Settings panel and the panel does not scroll sideways; the
desktop is unchanged; a browser check holds it and is red without the fix.

Change: `#community-industry { max-width: 100%; min-width: 0; }` beside the named-width select rule. A long option is
shortened in the closed select only; the open list shows it whole.

Decided: not added to the named-width list (`flex: 1; min-width: 220px`), which would stretch it on a desktop; this
only caps it.

Checked: render-settings-fit-5510.js passes in Chromium and WebKit; against origin/main's page it FAILS at 360 (right
339 > 336, panel scrolls sideways) and the desktop control passes on both. mobile-shots (with --remote from the
phonepass-5510 branch) shows settings-recommender with no overflow at 360/412, light/dark, remote and local. Wiring:
reason-grep 7/7, wired 11/11, indexed 1/1.

Weakest premise: one long option measured; a longer label added to the board's list later is still capped by the same
rule, so this is a rule, not a number.
