# #8625: report and block for messages from outside your Kosmos (App Store guideline 1.2)

Card: joshualeestone/kosmos#8625, from the #7352 refresh. Shared rooms are live in production (`federation_live: true`
on the coordinator's /v1/meta, read 11-17), and the iPhone shows outside messages, so the age rating answers Yes to
user-generated content and 1.2 asks for report and block.

## What finished looks like

On the iPhone (and the desktop room), a message from outside your Kosmos can be reported to Kosmos and its sender
blocked. A blocked person's messages are gone from your rooms on every computer they use and in every room, new ones are
not kept or pushed, and you can unblock them in Settings. A report reaches Kosmos with the message, who sent it and the
room. The submitted build carries this.

## Decided

- **Block is kept by the account the relay stamps** on every outside message (`member`: an account, or
  `account:computer`). It covers the person across rooms and computers. The phone and page name a message by its id; the
  board resolves the sender, since the stamp never leaves the board (`withoutStamp`).
- **Where it applies:** new messages are dropped in `messages.externalPost` (the one function every arriving outside
  message passes), so nothing is stored, shown, pushed or read by an agent; rows kept before the block are left out of
  the room route as it is read. Unblock brings those back.
- **Report is a pre-filled email to hello@installkosmos.com** (the published contact on the privacy page), sent from the
  phone with the message, sender name, room and message id. Rejected for v1: a new coordinator route (a relay change
  and a Mortals turn for a channel the published address already provides); the daily feedback send (scrubbed, and the
  person can switch it off, so a report could silently not go).
- **Rejected:** answering No to user-generated content (false); hiding shared rooms on the iPhone (removes a working
  feature).

## Weakest premise

That an email to the published address meets "timely responses": it does only if someone watches that inbox. That is
an operational dependency, said on the card.

## Not covered yet

- Rows kept before a block are filtered in the room route (both its arms, so an agent's `kosmos room` too) and in the
  unread counts. The quiet-run and acknowledgement logic (messages.js, rows of the room as stored) still sees them;
  they never reach a person or a pane from there. New rows never reach anyone.
- A block lives on the one board the phone shows; a person with several computers blocks on each.
- The desktop board's room has no Report or Block buttons yet (App Review reads the iPhone app; the routes are the
  board's, so the desktop page can add them later). A follow-up card.

## The phone (slice 2)

- The long-press sheet (ComposerExtras.swift) gains optional Report message and Block rows, set only for a message from
  outside this Kosmos and never in the archive view (RoomView.swift). Block asks first, in plain words, and says they
  are not told. Existing callers are unchanged (both default to nil).
- Report opens the person's mail app with a message to hello@installkosmos.com: from, room name and id, message id, time
  and the words (Board.reportMail). Block posts to the board's block route by message id (Board.roomBlockRequest; only
  x- ids go into a path), then re-reads the room; the line under the composer says done or why not.
- Settings gains Blocked: the list from the board, with Unblock; a failed read shows no section, never an empty list.
- The store texts say so: the review notes (Guideline 1.2 paragraph) and age-rating.md.

## Tests

- `server.room-block-8625.test.js` (8): precondition; an unstamped row cannot be blocked (409); unknown 404 and agent
  token 403; blocking hides the person on both computers and not someone else, and the list holds no text; a blocked
  person's new message is not kept (CONTROL: another person's is); unblock brings them back and refuses a bad account.
- Controls: removing the room-route filter fails the hiding test; removing the arrival drop fails the new-message test.
- Neighbours and guards (messages, fedseats, room and federation route tests, fixture-discipline, sandbox-data,
  brand and name refs, engine.reachable): 887 pass.

- Phone: room suite (#8625 section: the block request and its path guard, the report mail's fields, a post is not
  reported, refusal sentences) and settings suite (the list and unblock requests, a malformed account, empty vs failed
  read). Every iOS logic suite passes; both typechecks (release and DEBUG) pass; server.ios-routes-6838 passes with the
  three new phone requests; the 85 repo tests that read the iOS sources pass; check-listing.sh passes.

## Review

- Round 1 (blind, opus): 1 BLOCKER, 6 WARNING, 1 CONVENTION, 3 NIT.
  - BLOCKER fixed: Block's question in the in-chat panel (keyboard up) vanished with the panel, so the block never ran;
    it is asked by the host now (panelBlock, askBlock), as Delete's is.
  - WARNING fixed: the person's own post from another computer (same_account) was offered Report and Block, and could be
    blocked; the row keeps sameAccount, the phone hides both, the block and sender routes refuse it (409). Tested.
  - WARNING fixed: a report could not name who to act on (the message id is this computer's own); a new sender route
    gives the account, which the mail carries as "Sender account". Tested both sides.
  - WARNING fixed: a mail that no app takes failed silently; the report is copied and the room says where to send it.
  - WARNING fixed: a blocked sender still spent the room's minute and day budget; fedseats drops them first
    (deps.isBlocked). Tested with a control that shows the harm without it.
  - WARNING fixed (words): Block covers the whole outside Kosmos (its person and agents) and the computer the phone shows;
    the question, Settings and the review notes say so.
  - WARNING fixed: unread counts left blocked rows in; filtered. Tested.
  - CONVENTION fixed: the plan's "not covered" line was wrong about `kosmos room`.
  - NITs fixed: a full block list is 409, not 503; agent tokens refused on every new route (header and body), tested.
    Not acted on: isViaScreen on unblock (the routes follow the room delete route's guard).
- Round 2 (blind, sonnet): no BLOCKER, 4 WARNING, 3 NIT.
  - WARNING fixed: the mail link left "+" unencoded (many mail apps read it as a space); encoded with a strict set,
    tested on the raw link with +, &, # and a line break.
  - WARNING fixed: the archive view had no Report or Block; offered there too.
  - WARNING fixed: an own-account row kept before the mark was stored could be blocked; the block route also refuses an
    account any kept row marks as the person's own. Residual: an own account with no marked row at all; Unblock undoes it.
  - WARNING recorded: quiet-run and acknowledgement logic still read a blocked person's stored rows (stated above).
  - NITs fixed: wording says the person's account (their agents and other computers), not "their Kosmos"; test count.
