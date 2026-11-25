# #8959 slice D1c1: the computer's Updates, native on the iPhone

Card: https://github.com/joshualeestone/kosmos/issues/8959 (plan comment 7154958145). Stacked on D1b2 (aipolicies-8959 74cbcd8227). D1c is split: D1c1 Updates (this), D1c2 Token usage.

**Measured (board):**
- `/api/status` carries `version`, `update`, `updateLook`, `updateManual`, `updateChannel`, `updateAttempt`, `updateLog` and `bootedAt`, the fields paintUpdateCard and the install overlay read.
- POST `/api/update/check` answers `{running, offer, reached, readable, manual, channel, rollback}`. The page gives up on it after 10 s.
- POST `/api/update` installs. GET/PUT `/api/autoupdate` is the switch.
- From a phone, every write is in REMOTE_STEP_UP_EXACT (403 `remote_step_up` with the computer's sentence).
- The page knows the platform and whether it is a cloud computer only from its own meta tags, which a phone cannot read (the page is 7 MB). So `/api/status` now says them too: `platform`, `cloudMachine`.

**The call:** an Updates row in Settings opens a native card in the page's words:
- the version and "Staging channel";
- paintUpdateCard's arms in its order: offer, command (Linux) and download (Windows) done at the computer, checking, up to date only once asked, unreadable, unreachable, and the last "Checking.";
- Check for Update. A failed check reads the step-up's own sentence or "Kosmos X. Could not check just now.", with Try again;
- Update behind the page's confirm. Then the overlay's wait: every 2 s, judged as updateVerdict. Done is the phone's "Kosmos is now on X." (the page reloads instead). Failed, did-not-take and the deadline use updateSettleText's sentences, including the installer's refusal lines. Slow reads "Still updating.";
- the automatic-updates switch where the page shows it (not on Windows, on Linux only on a cloud computer), with the page's hints and unread sentences.

**Rejected:**
- Roll back (Windows only, its own confirm; noted for D2).
- The "this page is older" arm (the phone is no page).
- updateAbort's stuck-machine notice: the page shows it elsewhere (the update toast), not in this card. Noted for D2.

**Weakest premise:** the step-up sentence is written for the page ("Press Sign in again at the foot of the page"). Shown as is, it still says what is needed.

**What would change my mind:** Josh wanting updates started only at the computer. The screen then becomes read-only.

## Built
- server.js: `platform`, `cloudMachine` in /api/status. server.test.js: cloudMachine in UNREAD_ON_PURPOSE (the page reads the meta tag).
- ios/Kosmos/UpdatesLogic.swift and UpdatesView.swift; an Updates row under AI policies in SettingsView.
- ios/LogicTests/updates + run-updates.sh (in ios.yml); ios/KosmosUITests/UpdatesUITests.swift (in ui-sample.sh); server.status-platform-8959.test.js.

## Measured (first build)
- run-updates.sh: PASS 104/104. Three planted mutants each fail: the slow limit at 80 s (1 fails), the channel sentences swapped (2), step-up codes matched exactly so `remote_step_up_clock` is missed (1).
- server.status-platform-8959: a real board serves both fields. Control: with the line removed, it fails.
- The ios*, server.ios* and web.ios* tests, plus every test file that lists *.test.js files (70 files) from the repo root: 1795 pass and, before the UNREAD_ON_PURPOSE line, 1 fail ("no field the board sends is unknown to the page"). With it, server.test.js and statusword-7004 pass 374, 0 fail.
- The app and the UI test type-check.

## Challenge loop ledger

### Round 1 (opus, 00:57 CST): no BLOCKER, 2 MAJOR, 4 MINOR
- MAJOR 1 an install press with no answer (status 0) read as a refusal; the page waits (#7207, waitForUnansweredPress), since it is very often the board restarting to install. Fixed: `.unanswered`, then the page's wait, judged by unansweredPressVerdict (done, restarted, answering, deadline), with the version and boot taken before the POST. The waiting sentence is the page's, its "this page" said as "this screen"; the deadline's Reload is said as pull down. Control: without the status-0 rule, 1 of 115 fails.
- MAJOR 2 the switch showed a false Off, which could be changed, when the setting had no answer: now `.noAnswer` shows no switch, only its sentence (the page's paintSwitch(null)); `.unreadOff`, a saved setting that could not be read, shows Off as the page does.
- M3 the wait outlived the screen (an unstructured Task): the install is now a kept Task, cancelled when the screen goes or the computer changes; the loops check for cancellation.
- M4 the switch snapped back during a save: it shows the value being saved until the answer.
- M5 "already on" named the offer; it now names the running version, as the page's served one.
- M6 a 200 whose body did not read counted as not reached: reached is now status 200, as the page's ping.ok.
- Kept: "Checking." without the version (the version is on the row above, and the page's own card arm has none); the Windows "Downloading X." lead (the phone's download arm is done at the computer, so a phone never starts a Windows download wait it could lead).
- Measured: run-updates.sh PASS 115/115; app and UI-test typecheck 0 errors.
- Correction to round 1's "kept" line: a Windows computer whose updater is armed DOES get the [Update] offer, so the phone can start a Windows install. Round 2's MAJOR 2 below is that case.

### Round 2 (sonnet, 01:02 CST): no BLOCKER, 2 MAJOR, 2 MINOR
- MAJOR 1 a settled failure replaced the card and nothing cleared it: it now shows above the card arm, whose button stays (Update or Check), and any press clears it.
- MAJOR 2 the Windows install wait did not lead as the page's overlay: updateOverlayLead ported ("Downloading X." while the board answers, "Updating." once it goes; "Updating." elsewhere), the version from the install's own answer (`updating`, measured in server.js's POST /api/update answers), and no "Still updating." relabel on Windows. One deliberate difference: with no version named, "Updating.", where the page would print "Downloading .".
- M3 a cancelled wait left "This screen will wait" up, and its defer could clear a newer action's busy: the note goes with a cancelled wait, and busy is held by a token (`acting`), cleared only by the action that set it, reset on a computer change.
- M4 no retry for an unanswered switch other than pull to refresh: kept, as the page (it has none at all).
- Measured: run-updates.sh PASS 118/118; typecheck 0 errors.

### Round 3 (opus, 01:08 CST): no BLOCKER, 1 MAJOR, 5 MINOR
- MAJOR 1 "already on" named the version the screen had shown, which is stale in exactly the case this 409 exists for (the computer updated itself since): `.already` now reads the status again and names what the computer runs, or "the latest version".
- M2 a request cancelled because the screen went came back as status 0 and read as unanswered: a cancelled install now stops without waiting or saying anything.
- M3 leaving mid-wait lost the wait: a wait cut short that way is kept (`resume`, with its own start time) and resumes when the screen comes back; a computer change drops it.
- M4 a switch save on one computer could clear another's, and a read sent before a save could land after it: the save holds a token (`autoActing`) and reads carry the page's AUTO_EPOCH.
- M5 "Checking." never cleared without a pull: while the first look is under way the screen asks again every 5 s, as the page's poll repaints. An older board with no updateLook keeps the page's last arm.
- M6 the check now lays its answer over the current state, not the snapshot from before; the suite reads the page first (and asserts it was read); the UI test reads the done sentence by identifier; a misplaced comment moved.
- Measured: run-updates.sh PASS 121/121; app and UI-test typecheck 0 errors.

### Round 4 (sonnet, 01:14 CST): no BLOCKER, 2 MAJOR, 3 MINOR
- MAJOR 1 a resume could start after the screen had gone (load returns on cancel, the unstructured Task did not inherit it) and a second resume could start beside the first: it starts only while the task is not cancelled, and cancels any earlier one first.
- MAJOR 2 an install cancelled while its POST was out was never waited for, though the computer may have started: it now keeps a resume, judged as unanswered (by version and boot), and says nothing until the screen is back.
- M3 a switch read started during a save could land over it: the epoch moves again when the save ends.
- M4 and M5 the 5 s re-read could fire during a press or a check, and never restarted: it now checks after each sleep (no wait, no resume, not busy, first look under way) for as long as the screen is shown, asking nothing otherwise.
- Measured: run-updates.sh PASS 121/121 (view-only changes); typecheck 0 errors.

### Round 5 (opus, 01:18 CST): no BLOCKER, 1 MAJOR, 2 MINOR
- MAJOR 1 round 4's resume of a cancelled install was judged as unanswered on return, so it said "not answering" and then "press Update again" to a computer answering fine. Removed: whether a cancelled press reached the computer cannot be told from the phone. The screen comes back to a fresh card, and pressing Update again is safe, because the route joins an install under way (the page's own "If the update already started, this joins it", index.html:26885). The resume stays for a wait that had started (an answered press, or a real no-answer).
- M2 a resumed unanswered wait kept an earlier settled block: waitUnanswered clears it, as wait does.
- M3 "already on" could name the old version when its read was cut short: it says nothing if cancelled.
- Measured: run-updates.sh PASS 121/121; typecheck 0 errors.

### Round 6 (sonnet, 01:21 CST): no findings. Loop ends here.
- The reviewer verified round 5's change and the tokens, the epoch, the 5 s loop and the CI wiring. run-updates.sh PASS 121/121, typecheck 0 errors.
- Limitation, deliberate (round 5): a press cancelled by leaving the screen is not waited for. The screen comes back to a fresh card, and pressing again joins any install under way.
