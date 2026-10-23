# claimhelp-6974: room-claim round-8 leftovers of #6957

Card: #6974. Base: origin/main 0bef7f948e (#6946, #6952, #6957 all merged).

## Scope
1. CLAIM_ROOM_ASK "who" rule: negative lookahead so "who can help you?", "who is around to help him?",
   "who wants to help @bob" do not read as a room ask (the helper invited is not who the work is for).
   The card's suggested lookahead had no optional "to"; "is around to help him" needs it, so it is added. Review 1: the
   same lookahead (CLAIM_HELP_FOR) is applied to the sibling forms, "can someone help you?" and "anyone around to help
   him?", and allows "come/please/also help". Review 2: it ends on a word boundary (Herman, Youssef are not him/you)
   and "you guys/you all/you folks" is the room. Review 3: "else", "here", "pls" and "quickly" may sit before help ("Can someone else help
   you?" after a clause start), and the whoever and volunteers forms carry the same lookahead.
2. "around to" and "someone (else) <free|available|has time|...>" count only at a clause start (CLAIM_LEAD, optionally
   followed by "if") or after so/and/or/but/then/can/could/is there/does/do/is/are (is/are not after "there", so
   "let me know if there is anyone free" stays bob's). Review 3: bare and/or are dropped as lead-ins ("@bob ask Ann or anyone free
   to pair on it" is bob's), and ", or" after a comma is kept for this rule only (not added to CLAIM_LEAD, where it
   would open "broken for you, or anyone else?"). Accepted cost: "@bob is out and anyone free can take it" with no
   comma now locks to bob for up to 30 minutes, the bounded direction. Review 1: the anchor covers the non-else form too, so
   adding "else" never moves a post toward the named member ("let me know if anyone has time" and "...anyone else has
   time" both stay bob's), and the question lead-ins ("is anyone around to...", "does anyone else have time...") still
   ask the room. Decided deviation from the card: "someone else PLEASE" stays unanchored, because it is an
   imperative to the room wherever it sits (an existing #6957 review 4 test, "@bob is swamped so somebody else please
   grab the login bug", pins it), and a passing "else please" is not a real phrasing.
3. server.js: the person's latest 🙋 per post is mapped in one pass per room read (lazy, only when a claim exists),
   instead of rescanning every row per claimed post. Latest-wins is pinned by a new arm in server.projects.test.js.

## Not in scope
- A bare member name after help ("who can help bob?"): asksRoom sees only @-words, so it opens; and "who can help you or
  take it over" stays bob's (the lookahead stops the clause). Both are word-pattern limits; the first is the unbounded
  direction and is left for a follow-up if it shows up in real rooms.
- "help him/her/them" is read as help for the named member; when it names a third party ("who can help them with
  their billing question?") the post now locks to bob for up to 30 minutes. Accepted: bounded, and with one member
  named the pronoun is usually them. An @-named third party ("who can help @ann with the tests?") makes ann an
  asked member too, so the post locks to bob and ann: also bounded.
- Mid-sentence lead-ins other than the listed ones ("hopefully someone free will take it", "we need someone free") now lock to bob: bounded by the
  30-minute window, the direction the card prefers.
(Stated on the card, unchanged:)
- The legacy unmarked-pill edge (needs pre-claim data).
- claimAgreed on the person's own page and an end-to-end sendPost test.
- No guidance text change, so no doctrine bump (engine/defaults.js untouched).

## Weakest premise
The word pattern still misreads some phrasings; the 30-minute window remains the real bound on a wrong lock.
A misread open is still unbounded, and this card only narrows the phrasings it names.
