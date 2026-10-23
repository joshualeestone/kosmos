# claimhelp-6974: room-claim round-8 leftovers of #6957

Card: #6974. Base: origin/main 0bef7f948e (#6946, #6952, #6957 all merged).

## Scope
1. CLAIM_ROOM_ASK "who" rule: negative lookahead so "who can help you?", "who is around to help him?",
   "who wants to help @bob" do not read as a room ask (the helper invited is not who the work is for).
   The card's suggested lookahead had no optional "to"; "is around to help him" needs it, so it is added.
2. "around to" and "someone ELSE <free|available|has time|...>" count only at a clause start (CLAIM_LEAD) or after
   can/could/is there. Decided deviation from the card: "someone else PLEASE" stays unanchored, because it is an
   imperative to the room wherever it sits (an existing #6957 review 4 test, "@bob is swamped so somebody else please
   grab the login bug", pins it), and a passing "else please" is not a real phrasing.
3. server.js: the person's latest 🙋 per post is mapped in one pass per room read (lazy, only when a claim exists),
   instead of rescanning every row per claimed post. Latest-wins is pinned by a new arm in server.projects.test.js.

## Not in scope (stated on the card, unchanged)
- The legacy unmarked-pill edge (needs pre-claim data).
- claimAgreed on the person's own page and an end-to-end sendPost test.
- No guidance text change, so no doctrine bump (engine/defaults.js untouched).

## Weakest premise
The word pattern still misreads some phrasings; the 30-minute window remains the real bound on a wrong lock.
A misread open is still unbounded, and this card only narrows the phrasings it names.
