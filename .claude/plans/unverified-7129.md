# unverified-7129: rows shown while an own computer waits to be let in say they could not be checked

Card: kosmos#7129, a follow-up to #4658 slice 2 (#7124). That slice listed this under NOT CLAIMED: "a 'not yet verified' mark on such rows is a later card."

## Decided
1. **engine/fedseats.js handleEvent:** an unsealed message shown while this computer waits is recorded with `unverified: true`. Waiting means `pendingClear` on the record, or no record while the link waits. Only an unsealed message that is SHOWN is marked: one refused in a sealed room is never recorded. A message opened from a sealed envelope is never marked, since it was checked.
2. **engine/messages.js externalPost:** keeps `unverified` only when it is exactly true. The mark stays for good: a later clear or share does not vouch for an earlier row.
3. **engine/messages.js ownPostNudges:** an unverified post never reopens a held room or types into agent panes (#5732 / #5902). The relay writes the same_account stamp, and nothing checked these words.
4. **server.js room API:** the JSON row carries `unverified: true`. The text agents read appends "(arrived while this computer was waiting to be let in, so it may not be from anyone in this project)".
5. **web/index.html pjRoomRow:** draws "Arrived while this computer was waiting to be let in, so it may not be from anyone in this project." under the words (`.msg-ext-unv`). The copy text leaves it out.

## Rejected
- **Hiding the rows while waiting:** a clear room's real conversation would vanish.
- **Holding them until the owner answers:** an owner on an older Kosmos never answers.
- **Removing the mark once let in:** a clear does not prove earlier rows genuine.

## Weakest premise
That the case is worth a visible line, since it needs an altered code, or an older-build room. What would change it: a ruling that a waiting computer shows nothing until let in.

## NOT CLAIMED
- Rows recorded before this change carry no mark.
- **The agent-loop valve still counts marked rows** (review 4: the quiet that folds retried sends, and the acknowledgement-run list). The valve stops agents looping and grants no authority, and an injected row can sway it the same way in any clear room, where nothing is marked. Excluding only marked rows would make a waiting computer's loop guard differ for no gain. Unread counts and last-post time count them too: the row is in the room.
- The phone app's room does not draw the line yet. It reads the same JSON, so the field is there for it: kosmos#7130 (review 1).
- A reply's quote of a marked row (pjReplyGist) shows its words without the line; the row itself, in view, carries it (review 1).
- **Wording (review 1):** the line names what sets these rows apart, which is that this computer was waiting. It does not say "could not be checked", which would imply the unmarked rows of a clear room were checked. They are not: no unsealed row is authenticated.
