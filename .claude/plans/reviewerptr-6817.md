# reviewerptr-6817: a board notice when someone in your company is made a reviewer (kosmos#6817 item 1)

**Card.** #6817 item 1: a member who never opens Settings is never told a reviewer was added (#6752 put the list only in
the Settings company block). Item 1 is mine by the card's split (Renet has items 2 and 3); the design call is posted on
the card (10:0x CDT 10-21) and checked against main after #6825.

**Done when.** On the agents tab, a member whose company (or family) granted a reviewer they have not seen gets one
notice in the floating stack, in the company's or family's words, with See who and a close; the x, See who, or the
Settings list on screen counts as seen and the notice does not come back until a newer grant; See who lands on the
Settings list. Unit tests (web.reviewerptr-6817.test.js) and a hermetic browser check (render-reviewerptr-6817.js,
chromium and webkit, phone fit) pass, each able to fail.

## The calls

- **One notice in the existing `.utoast` stack**, its own slot (#reviewer-slot), neutral tone (news, not a warning).
  Rejected: a new banner (a new surface on the main board for one sentence).
- **Words:** "Someone was made a reviewer for your company." (plusOrgIn gives the family's words.) Action "See who",
  not "See Settings": the action names what the person gets.
- **Seen is per browser on this computer** (localStorage is per browser and per board address), as the newest grantedAt
  seen. So the Mac app and a browser tab each show it once. A fresh browser, or the first board after joining, shows
  the notice for any grant in the list's 30 days, as the list itself does: that is the same news, decided, not missed. Rejected for now: per person (needs the relay
  to store it). If storage is refused, the notice clears for this visit and may show again next visit.
- **A new route, GET /api/org/grants.** The board must not read /api/org: a GET there spends the one-time notes
  (stoppedFor, leaveRefused) that the Settings block exists to show, so a board poll would eat them unseen. The new
  route spends nothing and gives grants and the org's kind to the screen only, as /api/org does.
- **Read at most once a minute, only on the agents tab**, from the status poll beside the restart notices. A failed read
  keeps what is on screen; a read that says not enrolled clears it.
- **What counts as new:** a grant's grantedAt inside the 30 days the Settings list shows, and not removed. A removed
  grant raises nothing (an admin's mistake undone a minute later must not tell every member someone was made a
  reviewer); a pending grant taking effect is not new.
- **See who does not mark seen.** The Settings list on screen does (reviewerNoteSeenList), so a list that has not caught
  up leaves the notice for next time. See who resets the once-a-minute read so Settings reads /api/org fresh.
- **The x hands focus on**, to the next notice that takes focus, else the board (as the restart notices do).

## Weakest premise

That "newer than the last seen grantedAt" is enough. If a pending grant taking effect matters as its own moment, that is
a second notice; left out until someone asks.

## Tests run

- web.reviewerptr-6817.test.js: 8/8. Each kind proved able to fail by a deliberate break: `>=` for `>` (2 red), the
  board reading /api/org (1 red), the Settings list counting while hidden (1 red), the route spending a note and
  ungated (1 red).
- Every existing test that touches the stack, the route list or the grants (21 files, 333 tests): pass, after
  web.cert-notice-6613 caught a missing `#reviewer-slot:empty` rule (fixed).
