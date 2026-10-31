# reportline-7586: a computer that cannot report says its company (or family) requires reports

Card: kosmos#7586 (Enterprise pilot 6/6), the board half of "reporting required". PigeonPete's commit (reportreq-7586, 9bd0b8da40), carried onto main and finished here. Decisions per item are on the card (comment 6505730806): backup required stays hidden (done by #6365); the page is softened on a separate relay branch.

## Finished looks like
On a board enrolled in a company whose policy requires reporting, when the computer is not reporting, the joined view adds: "Your company requires this computer to report, and its console shows a computer that is not reporting." (a family reads "Your family ..."), including the family branch still waiting on its words. Not when the company asks for no reports.

## Change
web/index.html: PLUS_ORG_REQUIRED_WAIT and plusOrgRequiredWait in the joined view's not-reporting branch (through plusOrgIn); PLUS_ORG_REQUIRED_WAIT_FAMILY on the family words-needed branch. web.joined-required-7586.test.js.

## Measured
- web.joined-required-7586.test.js 4/4; the 11 tests that read the joined view and reporting code 86/86.
- Browser checks: CI's selector (tools/bc-pr-select.js) picks render-orgenroll-5531 and render-org-family-6239 (selector plus-org-say) plus four page checks; their fixtures never set reportingRequired, so the existing sentences are unchanged.

## Weakest premise
That an admin looks at the console. The line says the console shows it, which is true; it does not promise anyone is told.

## Ledger
- Pete's blind review (opus, on his branch): nothing above MINOR. Taken: the "sees ... yet" wording (false for a day); the family waiting on its words gets a line; the no-reports comment corrected. Deferred: a browser check rendering the new line (the logic is tested; CI runs the selector's checks); the requirement is read from the last applied policy (same lag as #6367).
- My blind review (sonnet): 0 blockers, 2 warnings: the same wording (taken); family reachability (checked: the family console requires reporting, so the line is real). Nits deferred: the leave-refused message does not carry the line; test 3 pins source text.
- Final review (sonnet, blind): 0 blockers, 0 warnings, 0 nits; temporal dead zone checked safe (plusOrgPaint runs only after the constants). CONVERGED.
- CI red on #7591 (suite shell macOS): the #1720 browser-check gate (web/ changed, no docs/browser-checks assertion). Fixed with O15r in render-orgenroll-5531.js (company, family, the family waiting on its words; controls reporting and no-reports). Run headless on the real page: all pass; with plusOrgRequiredWait returning '' O15r FAILS. Both gates (#1720 coarse, surface) pass locally. This closes the deferred 'no rendered check' nit.
