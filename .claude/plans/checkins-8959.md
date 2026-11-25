# #8959 slice D1d1: the Prompter's check-ins, native on the iPhone

Card: https://github.com/joshualeestone/kosmos/issues/8959 (D1d plan 7156885894). Stacked on D1c2b (usagecharts-8959 5cee8a463b).

**The call:** under the Prompter box on the phone's Automation screen, the page's #hb-nudges:
- "Agents that may need you" and one row per GET /api/prompter-nudges check-in, each question composed as the page's prompterCheckinQuestion. A lost connection is worded by the agent's reconnect.phase, read from /api/status only when such a check-in exists.
- Any failure hides the list, as the page does.
- A row opens that agent's chat through the push-tap path: SettingsView gets `openAgent` from ContentView, which sets pushManager.agentToOpen. The target is the computer's lower-cased host and the session.
- The Prompter hint is the page's whole line again ("and shows a check-in below so you can look in on it"). The phone's own "elsewhere" footer drops "The Prompter's check-ins" (126 characters, under XCUI's 128 string-query limit that broke D1a's UI run).

**Rejected:** a separate Check-ins screen (the page keeps them in the Prompter box).

**Weakest premise:** that opening from Settings through pushManager.agentToOpen behaves as a push tap does (switching to Agents). It is the same code (ContentView.openAgentChat), reached from a new place. The UI run cannot see the tab switch in a sample build.

## Built
- ios/Kosmos/CheckinsLogic.swift; AutomationView (the rows, readCheckins, open); AutomationLogic (the hint, the footer); SettingsView and ContentView (openAgent).
- ios/LogicTests/checkins + run-checkins.sh (in ios.yml); AutomationUITests checks the sample's two check-ins.

## Measured (first build)
- run-checkins.sh PASS 25/25. Mutants: gave_up worded as reconnecting (3 of 25 fail), the host not lower-cased (1).
- run-automation.sh PASS 227/227 (its "points below" check now allows the Prompter and still guards Community).
- iOS node tests (ios*, server.ios*, web.ios*) 73 pass. App and UI-test typecheck 0 errors.

## Challenge loop ledger

### Round 1 (opus, 02:31 CST): no BLOCKER, 1 MAJOR, 6 MINOR. The reviewer confirmed the target's host is what agentOpening compares with (Board.macURL lower-cases the address), so a tap opens the chat natively.
- MAJOR 1 the check-ins were drawn inside the Prompter box's loaded state, so a failed or slow box read hid them; the page reads them on their own. Now drawn in the Prompter section whatever the box's read did.
- M2 a cancelled read (a tap that leaves the screen) hid the list or dropped the phases as if it had failed: a cancelled read changes nothing.
- M3 the list was never read again while shown (the page repaints from its poll): read every 30 s while the screen shows.
- M4 a row whose session the board's names do not allow was a button that did nothing: it is plain text then.
- M5 the opened chat's title differed from a push tap's: the session capitalised, as agentToOpen names an agent with no name.
- M6 one non-object entry in /api/status dropped every phase: such entries are skipped.
- M7 the plan's ledger was empty: this.
- Measured: run-checkins.sh PASS 26/26; run-automation.sh 227/227; typecheck 0 errors.

### Round 2 (sonnet, 02:34 CST): 1 BLOCKER, 1 MINOR
- BLOCKER the UI test looked for the check-ins after scrolling down to the Recommender's guards. reveal() only swipes down, and the Prompter box is near the top, so the lazy rows were gone and the test would fail. The check-ins are now asserted right after the first shot, where the Prompter box is, with a wait for the sample's async read.
- M kept: the check-ins show under a Prompter box that is reading or failed. They have their own read, and the 30 s read retries them.
- The reviewer verified the 30 s loop: it blocks nothing, ends with the screen, and a pull starts no second loop. The cancellation guards hold.

### Round 3 (opus, 02:36 CST): no BLOCKER, 1 MAJOR, 1 MINOR, both in the UI test. The reviewer walked the whole test against the box order and the sample: every lookup moves down the page, and the app code holds.
- MAJOR one reveal for three rows of a lazy List could leave eli's row unbuilt (or the heading scrolled out), a CI flake. Each element (heading, dana, eli) is now revealed and waited for on its own, top to bottom.
- MINOR reveal ran before the sample's read had landed: each lookup now waits after its reveal, and the sample's read lands with the boxes' reads.
- Loop ends here: round 3 found nothing in the app code, and its test findings are fixed.
