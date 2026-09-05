# #2242: remove the timezone subline from the first-run step

## Ask (Josh, 0.6.35 fresh-install feedback, item 7)
"Delete the subline underneath your time zone that says 'so your agents know your
local time when you write to them.' Just remove that subhead."

## Change
Remove the `<div class="fhint">So your agents know your local time when you write
to them.</div>` from the FIRST-RUN timezone field (fr-you-tz) in web/index.html
(the JS string-concat that builds the fresh-install you-step). Label + select
unchanged.

## Decision (documented)
The identical subline also exists on the SETTINGS timezone field (index.html:9562,
id you-tz), the field's original home. Josh's feedback named the fresh-install
screen, so removed only the first-run one; left Settings, flagged on the card for
his optional call. Weakest premise: he may want both gone (one-line follow-up).

## Verification
Pure copy removal, statically verified: concat still valid, fr-you-tz label+select
intact, no test/browser-check asserts the removed text. Browser test not run (bot
session, no Playwright); no real risk for a copy-string removal.
