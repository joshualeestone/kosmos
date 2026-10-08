# orgreview-5531: "Review what your company sees" (#5531 follow-up a0)

**Card:** #5531 (merged as #5595). Raised in #5531 review 34.

**Problem:** a Kosmos can be the work Kosmos with no consent recorded on this computer. This happens to a record re-adopted by refresh, or one rebuilt after an undo the company refused. `mayReport()` then fails closed: it sends nothing, and the joined view says so. Its only way out was to leave and join again with a fresh code.

**What this builds:**
- `engine/orgenroll.js` `reviewHere()`: answered only when this world has a record AND the company names this world here, for the company on that record. It returns that company's consent with `move: true, review: true`. It binds nothing.
- `server.js`: `POST /api/org/preview` with `{ review: true }` calls `reviewHere()`. The one-time ticket is the move kind (no code), so Accept goes through the existing enroll with no code. The page may see `review` (allow-list).
- `web/index.html`: a "Review what your company sees" button in the joined view, shown only while `reporting === false`. The consent shows in place of the joined view, and the primary button reads "Accept". Not now says "Nothing changed. This Kosmos still sends your company nothing."
- **Accepting:** this is the existing codeless enroll, built on follow-up b (stacked on consenthash-5531). The coordinator (relay `mac_enroll`, `code: None`) re-enrolls the same Mac and world, and stores the `consentHash` the enroll carries, exactly as sent.
  - So Accept sends the hash the company SERVED with these words, from status, through the ticket.
  - With no hash to echo, the review is not offered at all: Accept could not make this Kosmos report, on either side.
  - The board records the same hash, so `mayReport()` becomes true. The company holds the same words.

**Rejected:**
- Showing the button to every joined Kosmos. A Kosmos that reports has its words on record; re-accepting would be a second path to the same state, with no use yet.
- A new coordinator route. Status already serves the consent to a member, and the codeless enroll already records a re-acceptance.

**Weakest premise:** that a codeless enroll for the SAME world always answers `thisComputer: true`. It does when this computer's signer is the enrolled one. A full copy of the data folder (the same signer) passes as well, and #5532's computer print is what closes that.

**Tests:**
- `engine/orgenroll-5531.test.js`:
  - with no record, the company is not asked;
  - another company's words are refused;
  - a world named elsewhere is refused;
  - accepting with no code lets the Kosmos report.
  - Each guard's mutation makes it fail.
- `server.orgenroll-5531.test.js`: the real routes. The page gets the name and slug only. Accepting sends no code. Dropping `review` from the allow-list makes it fail.
- `render-orgenroll-5531.js` O15: offered only when sending nothing (with a control); Accept sends no code; Not now changes nothing. Making the button always visible makes it fail.

## Review 1 (blind, Opus)
- FIXED: the company recorded no accepted words. The enroll sent no `consentHash`, so `mac_enroll` stored none: only the local gate flipped. Now stacked on follow-up b. Accept sends the served hash, and a review with none is not offered. Engine and server arms pin the hash sent; mutating the no-hash guard makes them fail.
- FIXED: a timed-out Accept was recorded as accepted. The status read finds "here", which was true before Accept was pressed. A review's lost answer now records nothing, asks nothing more, and says to press Accept again; accepting again is harmless. Pinned; mutation makes it fail.
- FIXED: code-flow words in the review flow. An expired ticket now points at the Review button (O15 arm; mutation makes it fail). A refused or unrecordable Accept says "press Accept again", not "Join".
- NITs taken: an Accept keeps the original join date (pinned); Not now says only "Nothing changed." (the joined view already says it sends nothing).
- NIT kept: no arms for "status unreachable" and "no consent in status". They are plain refusals, with the same shape as preview's.


## Review 2 (blind, Sonnet)
- FIXED, the same class as review 1's third finding, one step over: a review's Accept refused WITH a reason fell into the join wording ("Type your join code again", "Nothing was joined"). Every refusal of a review's Accept is now said in review words before any join branch runs: a changed consent points at the Review button, as does any other code, and an unsent request or a lost answer says press Accept again. An engine arm per case asserts no code or join wording; mutating the branch away makes it fail.
- FIXED: the page brings back the joined view (with its Review button) on ANY coded refusal of a review, not only the listed codes (O15 arm with an unlisted code; mutation makes it fail).
- NIT taken: an accepted review sets `reporting: true` on the page state explicitly.
- NIT kept: reviewHere is not serialized with enroll/leave/refresh (same as preview; Accept re-validates).

## Review 3 (blind, Opus)
- FIXED: the server's wiring of the review flag (ticket -> enroll) was unguarded; the reviewer removed it in a scratch copy and every test stayed green. A server arm now drives a review's lost Accept through the real routes (records nothing, may not report, "press Accept again"). Removing the flag at the ticket or at the enroll call each makes it fail.
- FIXED: the engine now refuses a review for a Kosmos that already reports (mayReport), instead of relying on the page hiding the button. Pinned; mutation makes it fail.
- NITs taken: no sayFor call that never logs; a refusal because the account is no longer in the company says so, instead of pointing at a Review that would be refused too (pinned).
- NITs kept: a first join's page state leaves `reporting` unset until the next read (older than this branch); a re-armed ticket after org_bad_world is unused (harmless); O-list order in the header.

## Review 4 (blind, Sonnet)
- TAKEN as a guard rather than a comment: the enroll trusted a ticket's `review` flag on its own. (Superseded by review 5: as first written, a flagged Accept with no record fell into the ordinary path, and a YES there completed a move on review words.)
- NITs kept: no hint when the company names another org; two ifs on one condition in the page; the page's optimistic `reporting: true` (the next read corrects it).

## Review 5 (blind, Opus)
- FIXED, my review-4 guard (SELF): a review ticket whose record went while the words were open fell through into a codeless MOVE, and a yes bound a new world id on words that never described a move (the case #5531 review 15 closed for code joins; the reviewer measured it with a probe). A review's Accept with no record for this world is now refused BEFORE anything is sent or any world id is made (`org_not_here`, "nothing was sent"). Arms for a lost answer AND a yes each assert nothing was sent and no id was made; mutation makes them fail.
- FIXED: the plan's review-4 line overstated the guard (C).
- NITs kept: the org_bad_world re-armed ticket vs the page's way back; the Review button not disabled while out (busy already ignores a second press).


## Review 6 (blind, Sonnet)
- FIXED: after an accepted review the page set `reporting: true` itself, a second copy of the engine's mayReport rule. It now reads the state back from the engine (O15 asserts the re-read, the Review button gone, and no "sends nothing"; removing the re-read makes it fail).
- DECLINED, with reasons: clearing the board's one ticket when a review preview is refused. A refused code preview already leaves the previous ticket. The board holds one ticket, so clearing it could cancel another screen's valid ticket. And enroll re-checks the record (`org_not_here`), so the worst case is a refused Accept.
- NITs kept: an Accept clears a refused-leave note (the record is enrolled here and reporting resumes, so the note is stale); the Review button is not disabled while out; reviewHere is not serialized (enrollNow is, and re-checks).
