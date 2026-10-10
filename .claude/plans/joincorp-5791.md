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

## To update with it (they reference the old UI)
- Browser checks: render-orgenroll-5531.js, render-plus-gate-1615.js, render-plus-panel-3829.js, render-plus-signin-3478.js, mobile-shots.js, README.md.
- Web tests: web.lost-phone.test.js, web.modal-way-out-1316.test.js, web.plus-stale.test.js.
- Design shots (light/dark, desktop/phone) via /design-shots before asking for review.

## Gaps, stated
- The coordinator's audit line still records a join as the member accepting the words; a relay follow-up can reword it (card comment, 14:45).

## Challenge loop notes
