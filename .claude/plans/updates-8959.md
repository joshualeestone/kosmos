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
