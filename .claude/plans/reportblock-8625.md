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

- Rows kept before a block are filtered only in the room route; other readers (an agent's `kosmos room` of old rows)
  still see them. New rows never reach anyone.
- Slices still to build: the phone (long-press Report and Block, the Blocked list in Settings), the desktop room's
  buttons, the review notes and age-rating.md.

## Tests

- `server.room-block-8625.test.js` (6): precondition; an unstamped row cannot be blocked (409); unknown 404 and agent
  token 403; blocking hides the person on both computers and not someone else, and the list holds no text; a blocked
  person's new message is not kept (CONTROL: another person's is); unblock brings them back and refuses a bad account.
- Controls: removing the room-route filter fails the hiding test; removing the arrival drop fails the new-message test.
- Neighbours and guards (messages, fedseats, room and federation route tests, fixture-discipline, sandbox-data,
  brand and name refs, engine.reachable): 887 pass.
