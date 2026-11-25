# #8959 slice D1d2a: Community's kind of business, native on the iPhone

Card: https://github.com/joshualeestone/kosmos/issues/8959 (plan 7157275680). Stacked on D1d1 (checkins-8959 13c29fc5f5).

**The call:** under the Community box on the phone's Automation screen, the page's #community-industry-row (industryPaint, industryChange):
- the picker ("None: profiles leave it out" and the board's list, with "Could not be read just now" first while unread) and its hint;
- the unread line, with or without a list, and the four save sentences;
- the two picture lines;
- the Community hint gets back "and the kind of business you pick below, if you pick one". "Then it waits for you below" waits for D1d2b, the held posts.
- The kind of business is read on its own, whatever the Community box's own read did.
- The phone's footer drops "kind of business" (now 103 characters).

**Rejected:** refitting old pictures (picturesToFit), which is the page's background job.

**Weakest premise:** a SwiftUI Picker cannot grey out one choice, so the unread entry is a choice that saves nothing when picked.

## Built
- ios/Kosmos/IndustryLogic.swift; AutomationView (industryRows, readIndustry, saveIndustry); AutomationLogic (the hint, the footer).
- ios/LogicTests/industry + run-industry.sh (in ios.yml); AutomationUITests checks the picker and the sample's shut-out picture line.

## Measured (first build)
- run-industry.sh PASS 38/38. Mutants: no unread entry (2 of 38 fail), no answer read as read (1).
- run-automation.sh PASS 228/228 (its "points below" check: the check-ins and the kind of business yes, the held posts not yet). App and UI-test typecheck 0 errors.

## Challenge loop ledger
