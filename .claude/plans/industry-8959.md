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

### Round 1 (opus, 02:46 CST): no BLOCKER, 2 MAJOR, 6 MINOR
- MAJOR 1 a failed re-read turned a readable setting into "could not be read", and could leave a "Saved." line beside it. The page refreshes quietly when something is shown. Now: a re-read that fails keeps a read setting. When the setting is unread, only a kept refusal may stay; a "Saved." line goes. Also the picker is now a menu, as the Language picker is, so choosing pushes no screen and the way back does not re-read at all.
- MAJOR 2 the UI test read the picker's choice from its label only: it reads the label and the value together.
- M3 the page's pending-choice queue (INDUSTRY_PENDING): not needed, because a menu closes on a pick and the picker is disabled during a save. Said in the code.
- M4 kept: the unread entry is a choice that saves nothing. A Picker's selection must be one of its tags, and leaving it out would show a blank choice.
- M5 a 200 whose body did not read said "could not save": it now says "Saved, but we could not read it back just now." and reads again.
- M6 the pushed list's title and the truncated value: gone with the menu; the hint is its own line.
- M7 kept: no pure reducer for the view's state rules. The rules are now small and spelled out in readIndustry.
- M8 a JSON boolean or fraction counted as a picture count: not any more (Number.isInteger).
- Measured: run-industry.sh PASS 40/40; app and UI-test typecheck 0 errors.

### Round 2 (sonnet, 02:51 CST): no BLOCKER, 2 MAJOR, 4 MINOR
- MAJOR 1 "Saved, but we could not read it back" outlived a re-read that worked, and a failed re-read kept the old choice under it. Now a read that works clears that note, and the re-read after such a save shows the saved choice until it answers.
- MAJOR 2 the picker showed the old choice for a beat after a pick (the saving key was set inside the Task), and after a refusal before the re-read. Now the key is set in the Binding's set, before any await; a refusal shows the old choice again only through its re-read.
- M3 the UI test's picker lookup: a button, else any element with the identifier.
- M4 a refusal hid the unread sentence: both show (a refusal, then why the setting is unread); a "Saved." line still replaces it.
- M5 a missing `unreachable` read as 0: now as null, the board cannot tell.
- M6 a saved key the board's list no longer has showed blank: it stays a choice (as the language picker keeps its own).
- Measured: run-industry.sh PASS 41/41; app and UI-test typecheck 0 errors.

### Round 3 (opus, 02:54 CST): no BLOCKER, 1 MAJOR, 1 MINOR. The reviewer traced every save and read path by hand: industrySaving can never stay set, and a pull, a computer switch or leaving the screen during a save all end right.
- MAJOR after a save whose 200 answer did not read, a failed re-read kept the old business chosen beside "Saved, but ...". Now the shown state turns unread first, as the page's industryPaint({}), so a failed re-read says "could not be read", never a wrong business.
- MINOR a re-read that worked left no line at all: it now says the save's own sentence (savedSaid).
- Loop ends here. Rounds 2 and 3 found no BLOCKER, and round 3's two findings are on one narrow path, now fixed.
- Measured: run-industry.sh 41/41; run-automation.sh 228/228; typecheck 0 errors.
