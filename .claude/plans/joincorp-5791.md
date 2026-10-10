# joincorp-5791: Join Corporate Account joins directly; Lost your phone? leaves the Kosmos+ footer (kosmos#5791)

## Why
Josh, 2026-10-10 14:32 CDT, testing the #5531 join flow: the company has already decided, so the person should not read a consent preview before joining. Enter the code, press Connect Account, joined. The opener should be an outlined "Join Corporate Account" button with a tiny icon, the open pane needs an X Cancel (today it cannot be closed), the copy changes, and "Lost your phone?" does not belong in this pane's footer.

## The change
- `web/index.html`, Settings > Kosmos+:
  - The quiet "Joining a company? Enter its join code" link becomes an outlined button, a tiny building icon and "Join Corporate Account".
  - Opened: no "Your company" label; an "X Cancel" closes it (clears the code and any message, back to the button). Copy: "Enter your company's code to connect your Kosmos to your corporate enterprise account." The code field and a "Connect Account" button.
  - Connect Account calls `/api/org/preview` and then, with nothing shown in between, `/api/org/enroll` with `accepted: true` and the preview's ticket. A refusal at either step shows inline under the field (wrong, used or expired code; another company; no connection). The consent box (what your company sees / backed up / who can read / never) is no longer shown on a join.
  - The joined view drops "Your other Kosmoses on this computer are not part of it" (Josh: that concept is gone).
  - "Lost your phone?" leaves the bottom row. It moves next to the second-step status it resets (decided below).
- `engine/orgenroll.js` (and its route in `server.js` if the ticket is held there): when the company refuses a report because its words changed (409 `org_consent_changed`), the board fetches the current words and re-enrolls with no code under the new hash on its own (the review path, without a screen). The page's "Review what your company sees" button and the "check the code again to read the new words" message go.

## Decided
- No server change (answered on the card, 14:45): the coordinator still binds each member to the hash of the words it served, so reports keep matching the company's current statement; the board supplies that hash itself.
- The words are still fetched and kept on the board (the engine's consent store), only not shown before joining. They are what the board's reporting gates read (NAMES_EVERY_KOSMOS, NAMES_POLICY, the event and manipulation phrases), so dropping them would stop reports.

## Measured before building
- The ticket lives in server.js (`ORG_TICKET`, one use, 10 minutes, bound to the code and the company previewed). The page can call `/api/org/preview` and then `/api/org/enroll` with `{ code, accepted: true, ticket }` back to back, so the join needs no new route and no server change; the consent hash and words ride the ticket as today.
- Two strings still send the person to read the words: server.js `org_ticket` ("Check the code again first, so you can read what your company would see.") and orgenroll.js `SAY.org_consent_changed` ("... Check the code again to read the new words."). Both are reworded.
- `consentWithdrawn` is called from engine/orgrollup.js and engine/agentevents.js when the company refuses a report (409 org_consent_changed). After it clears the old hash, a new `reacceptWords` in orgenroll.js runs `reviewHere` and a codeless `enroll` under the served hash (review: true), so reporting resumes with no screen. The page's "Review what your company sees" button and the review flow's prompts go.

## Decided before building
- **"Lost your phone?" moves into "Devices that can reach this computer"** (#plus-devices), under the device list. A lost phone is a lost device, so that is where a person looks; the section shows exactly when the old footer did (a connected computer), and the dialog it opens is unchanged. Rejected: View account (an external link, so the reset would leave Kosmos) and Your Profile (not Kosmos+). The sign-in screen's "Can't get a code?" line names the new place.
- **The opener is a `.btn`** (already outlined) with a tiny building icon: "Join Corporate Account". The joined view keeps its "Your company" title; the entry pane loses it and gains an X Cancel.

## Updated with it (they referenced the old UI)
- Browser checks: render-orgenroll-5531.js (rewritten), render-plus-panel-3829.js (the bottom row; Lost your phone? under the device list), mobile-shots.js (plus-org-consent became plus-org-connect), README.md (the row).
- Web tests: web.lost-phone.test.js, web.plus-stale.test.js.
- Checked and left alone (no reference to a removed id or string, measured by grep for plus-org-consent, plus-org-join, plus-org-review, plus-org-notnow, plusOrgCheck and Check code): render-plus-gate-1615.js, render-plus-signin-3478.js (its "Lost your phone?" assertion is the sign-in recovery path, unchanged), web.modal-way-out-1316.test.js (passes).
- Design shots (light/dark, desktop/phone) via /design-shots before asking for review.

## Found while building, and decided
- **A failed re-accept had no way back.** With the Review button gone, a re-accept that could not reach the company (or a record from before terms were kept here) left the board with no terms on record, so the rollup and the event sender sent nothing for good and nothing ever asked again. Fixed in `engine/orgrollup.js` tick: a work Kosmos with no terms on record (or none readable) asks for them again by itself, at most once per `RETAKE_EVERY_MS` (15 minutes, stamped before the ask so a silent company is asked once per window). Terms on record that ask for no reports are an answer, not a gap, and are left alone. Pinned in orgrollup-5532.test.js with a control; mutated three ways (no retry, no throttle, retry on no-report terms), each red.
- **The page's not-reporting line** said "its words were not accepted on this computer", which no longer has a remedy a person can take. It now says "It reports to your company once Kosmos has your company's current terms." (the 15-minute retry is what makes that true).
- **The review path's refusal sentences** pointed at a Review button and an Accept press that no longer exist; they now reach only the board's log, and say "Kosmos tries again on its own."
- **Lost your phone?** sits under the device list on a phone too; it renders a little larger there than the device hint (the phone tap-size rule for that link class). Left as is.

## Gaps, stated
- The coordinator's audit line still records a join as the member accepting the words; a relay follow-up can reword it (card comment, 14:45).

## Challenge loop notes
- Iteration 1 (Opus), on 4a4fb12ad:
  - [BLOCKER] FIXED. Terms that ask for no reports could never pick up new terms: such a board never sends, so it never gets the 409, and the Review button was its only way. The rollup tick now also checks those terms once per RECHECK_NO_REPORTS_MS (a day), and reacceptWords leaves terms the company still serves under the recorded hash alone ({ ok: true, same: true }, nothing sent). Test: orgrollup-5532 "terms that ask for no reports are checked once a day". Mutations, each red: no daily check; no same-terms skip (first green: the fixture's no-report terms had nothing backed up, which cleanConsent treats as no terms at all, so the skip was never reached; fixed the fixture, then red); a 15-minute cadence.
  - [WARNING] FIXED. X Cancel could not close a pane that a "stopped naming this Kosmos" note held open, and the next read wrote the note back. PLUS_ORG.dismissed now records the closed note. Browser check O8b. Mutations of both halves, each red.
  - [WARNING] DECIDED, not changed. The board now accepts widened terms silently, and nothing on screen shows the terms. Josh's 14:32 ruling ("the company decided") is about the company's terms as a whole, not only the first join; a read-only "what your company sees" view is a reversible addition he can ask for. This is recorded on the card so he can overrule it.
  - [WARNING] DECIDED, not changed. A member whose work Kosmos is elsewhere moves with one press and no confirmation. That is Josh's ruling ("Connect Account joins directly"; "other Kosmoses" is gone). Recorded on the card.
  - [WARNING] NOT A DEFECT, now pinned. The worry was that the event sender keeps its failure wait after a re-accept. It does not: the new hash changes the sender's enrollment key, and a recorded withdrawal resets its state too (failAt: null). The agentevents test now asserts that a later event is sent. A mutation keeping failAt on reset turned red. Removing withdrawn=true alone stays green, because the hash change already resets the state.
  - NITs taken: the stale consentWithdrawn comment moved and rewritten; the two move refusals now say Connect Account instead of Join; the event sender's log line; reacceptWords sits in the export list. Not taken: the /api/org/preview { review: true } branch no longer has a page caller. It stays as API surface, since the engine's own reacceptWords uses reviewHere directly.
- Iteration 2 (Sonnet), on b51eea6a1:
  - [WARNING] FIXED. A closed note stayed suppressed for the page's life, keyed by the company name, so a later stop by the same company never showed. The dismissal is now forgotten when the engine stops carrying a note, or when this Kosmos joins. Browser check O8c. Removing the reset line turned it red.
  - [WARNING] DUPLICATE of iteration 1's silent-terms item (decided, on the card, 16:40).
  - [WARNING] NOT THIS BRANCH. The web.*.test.js files need the repo root as cwd. That is pre-existing, and run-tests.sh runs them from the root.
  - [CONVENTION] FIXED. This plan's "to update" list named files that needed no change; it now says which were changed and which were checked and left alone.
  - [NIT] not taken: the Cancel link reuses the plus-lost-link style on purpose (the same quiet link look). The browser check pins the Cancel by its id, not its class.
- Iteration 3 (Opus), on c880a59c0:
  - [WARNING] FIXED. After a join, plusOrgConnect called plusOrgMaybe while still busy, so the engine's answer (whether it reports yet) was never read until a repaint. The call now runs after the finally. Fixing it showed the browser check's stand-in /api/org always answered "not joined", which the bug had hidden: the stand-in now remembers a join and a leave. Check O2b. Moving the call back inside the busy window turned it red.
  - [WARNING] DECIDED, comment added. The terms re-check in the rollup tick runs before the run lock. Two runs at once cost one extra status read and at most one repeated codeless enroll, and accepting the same words twice changes nothing.
  - [WARNING] DECIDED, not guarded. A 409 while the company serves the hash already on record would re-enroll under it about once an hour. Rejected the reviewer's guard (skip a re-enroll under the hash just withdrawn). A 409 means the company's record for this member is bound to other words, and re-enrolling under the served hash is exactly what rebinds it, so the guard would block the real repair. Only a coordinator that keeps contradicting itself loops, and the failure wait (failHash unchanged) caps that at once per RETRY_AFTER_FAIL_MS. Weakest premise: that the coordinator records the hash a codeless enroll sends (contract v1.4, as stated in reviewHere's comment).
  - [CONVENTION] FIXED. The review branch's no-confirm refusal still said "Press Accept again". It now says "Kosmos tries again on its own", and the comment that pointed at it is updated.
  - NITs taken: the mayReport comment, the stale "bottom row" and "reading a consent" comments, PLUS_ORG declares dismissed, and Cancel focuses the first visible control when the opener stays hidden.
- Iteration 4 (Sonnet), on d66dc5d3a:
  - [WARNING] FIXED. The re-check stamp was a read-modify-write of the shared org-rollup-state.json before the run lock, so it could drop another run's fields. It now lives in its own file (RETAKE_FILE), and a lost stamp costs one extra ask. The test asserts the shared state is untouched and the stamp file is written. Putting the stamp back in the shared state turned two tests red.
  - [WARNING] NOT A DEFECT. The worry was that a record with no hash but words on file would be refused by reviewHere for good. acceptedConsent returns null unless mayReport (a hash) holds, so such a record never reaches that refusal. It is exactly the state the 15-minute test builds (the withdrawal removes the hash and the words stay), and that test recovers.
  - [WARNING] DUPLICATE of the silent-terms item (decided, on the card).
  - NITs not taken: the optimistic joined state before the read-back (accepted by the reviewer); the reused link class (iteration 2); the repeated log wording in two senders (two modules, one sentence each).
- Iteration 5 (Opus), on 49c66200b:
  - [WARNING] FIXED. tick read acceptedConsent twice, and a change between the two reads could dereference a null. tick is documented never to throw, so it now reads once. Not pinned by a test: the race needs another process writing between two synchronous reads, and a test could only fake it by stubbing the function it guards.
  - [WARNING] FIXED. A company that keeps answering without terms this board can record (a print it will not pin) got an enroll every 15 minutes forever. The window now doubles with each miss, up to a day, and resets once terms are recorded (misses in RETAKE_FILE). Tests: no ask one window after a miss; an ask after the doubled window; misses reset on success. Two mutations (no miss counted; misses never reset), each red.
  - [NIT] taken: a spent code (outcome unknown, undo pending) leaves the field, so a second press is not told "already used" under "this screen will show it". Browser check O14. The mutation turned two arms red.
  - NITs not taken: the org_ticket sentence for the (page-less) review caller of /api/org/preview; the static-source web test (the browser check is the behaviour pin); the reacceptWords docblock length.

