# #3758: guide close prompt wording; "This computer" becomes "Computer" (Josh 0.6.94, 2026-09-25 11:07)

## Finished looks like
- The guide's first-x ask has two buttons, "Close for now" and "Close forever" (was "Don't show this again"), and the
  line under them reads exactly "You can turn it back on under Settings > Computer".
- The Settings section is called "Computer" wherever it is named: its nav button, its section label, the setup
  wizard's screen-reader line that points to it, the board's agents tile label that opens it. Prose about the machine
  ("this computer is signed in") is not the section's name and stays.
- Before and after shots on the card; a grep showing no user-facing "This computer" names the section.

## Decided
- The path in the line is held together with non-breaking spaces so "Settings >" and "Computer" never split across
  lines (the words are his, unchanged). Rejected: leaving the wrap (it split exactly at the ">" in the panel's width).
- Code comments that quoted "Don't show this again" now quote "Close forever", so they describe the page as it is.
  Dated plan files keep what was true then.

## Weakest premise
"Everywhere it's named" is read as the Settings section's NAME. Sentences that say "this computer" about the machine are
Josh's own product voice (#1004) and stay.

## Verification
render-assistant-bubble-3034: B7b (the ask's three strings in his words; the nav names the section Computer), B8 (Close
forever turns it off). web.settings-nav, server.setup-guide-page-3034, browser-checks-selectors, install.this-computer
unit tests pass.
