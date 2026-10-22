# reviewerptr-6817: a board notice when someone in your company is made a reviewer (kosmos#6817 item 1)

**Card.** #6817 item 1: a member who never opens Settings is never told a reviewer was added (#6752 put the list only in
the Settings company block). Item 1 is mine by the card's split (Renet has items 2 and 3); the design call is posted on
the card (10:0x CDT 10-21) and checked against main after #6825.

**Done when.** On the agents tab, a member whose company (or family) granted a reviewer this browser has not seen gets
one notice in the floating stack, in the company's or family's words, with See who and a close. The x, or the reviewers
list in view, counts as seen; See who takes the person to the list. The notice does not come back until a grant this
browser has not seen. Unit tests (web.reviewerptr-6817.test.js, server.reviewergrants-6817.test.js) and a hermetic
browser check (render-reviewerptr-6817.js, chromium and webkit, phone fit) pass, each able to fail.

## The calls

- **One notice in the existing `.utoast` stack**, its own slot (#reviewer-slot), neutral tone (news, not a warning).
  Rejected: a new banner (a new surface on the main board for one sentence).
- **Words:** "Someone was made a reviewer for your company." (plusOrgIn gives the family's words.) Action "See who",
  not "See Settings": the action names what the person gets.
- **Seen is the set of grants seen** (name and grantedAt), per browser on this computer (localStorage is per browser and
  per board address), keeping only those still inside the 30 days. Rejected: one "newest seen" time. That needs a clock
  comparison, and a grant stamped ahead of this computer's clock either hid later grants (compared raw) or could not be
  closed (capped at a moving now, review 3's blocker). A set has no clock in it. A fresh browser, or the first board after
  joining, shows the notice for any grant in the list's 30 days, as the list itself does: decided, not missed.
  Rejected for now: per person (needs the relay to store it). If storage is refused, seen is kept in memory for the
  visit, so a closed notice stays closed until a reload.
- **A new route, GET /api/org/grants.** The board must not read /api/org: a GET there spends the one-time notes
  (stoppedFor, leaveRefused) that the Settings block exists to show, so a board poll would eat them unseen. The new
  route spends nothing and gives grants and the org's kind to the screen only, as /api/org does.
- **Read at most once a minute, only on the agents tab**, from the status poll beside the restart notices. A failed read
  keeps what is on screen; a read that says not enrolled clears it.
- **What counts as new:** a grant's grantedAt inside the 30 days the Settings list shows, and not removed. A removed
  grant raises nothing (an admin's mistake undone a minute later must not tell every member someone was made a
  reviewer); a pending grant taking effect is not new.
- **See who does not mark seen.** The reviewers list in view does (reviewerNoteSeenList, on Settings' repaint), not the
  Kosmos+ section merely being open, so a list that has not caught up or was never scrolled to leaves the notice. See who resets the once-a-minute read so Settings reads /api/org fresh.
- **The x hands focus on**, to the next notice that takes focus, else the board (as the restart notices do).
- **Known gap, decided:** the notice says "Someone", so a member who was themselves made the reviewer reads it about
  themselves without being told so. The grants carry a display name, not an identity this board can match to its
  person; matching it would be guessing. The Settings list names who.

## Accepted, not fixed (review 6)

- The grants are read at most once a minute, failed reads included, so after a failed first read the notice can be a
  minute late. Retrying sooner would poll a struggling board every 5 seconds for news.
- A grant that arrives after the person closed the notice brings it back: that grant is news they have not seen.
- The list counts as seen once 48 px of it is in view; it is newest first, so the top of it is the newest grant.
- The notice's role="status" arrives with its text, as its siblings' does, so some screen readers will not announce it;
  it is found in the stack and by tab order, the same as the restart notices.

- Settings opened another way (not See who) can show a list read up to a minute before the notice's own read; the list
  then marks only what it shows, and the notice stays for the newer grant. That is the rule working (review 8).
- The admin who made a grant, if they also use a work Kosmos, is told "Someone was made a reviewer" about their own
  act; the same decided gap as the reviewer's own case below (the board cannot match a name to its person).

## Weakest premise

That a grant's name and grantedAt identify it. Two grants to the same name in the same second would read as one (the
second goes unannounced); a person granted again later, at a new time, is news again, which is intended. The seen set
is not scoped to a company, so after a move between companies an old key could match only on the same name and second.
Also left out until someone asks: a pending grant taking effect as its own moment.

## Tests run

- web.reviewerptr-6817.test.js 12/12 and server.reviewergrants-6817.test.js 3/3 (iteration 7). Each kind proved able to fail by a deliberate break: `>=` for `>` (2 red), the
  board reading /api/org (1 red), the Settings list counting while hidden (1 red), the route spending a note and
  ungated (1 red).
- Every existing test that touches the stack, the route list or the grants (21 files, 333 tests): pass, after
  web.cert-notice-6613 caught a missing `#reviewer-slot:empty` rule (fixed).
