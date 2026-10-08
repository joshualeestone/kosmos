# consenthash-5531: the board echoes the company's served consent hash (contract v1.4) (#5531 follow-up b)

Stacked on orgenroll-5531 (#5531); rebased onto main once that merges.

## Why
The coordinator now serves `consentHash` with the consent words (kosmos-relay `coordinator/src/org.rs`, v1.4) and pins the
hash an enroll sends; its rollup refuses (409 org_consent_changed) unless the recorded hash is the one it serves now.
Its own comment: boards ECHO the hash, never recompute it. #5531 recorded a hash computed on this side, which the company
would never match.

## What (as it stands after review 5)
- `preview` returns `served`: the company's hash when it served a 64-hex one (redeem, and status for a move) AND
  the person was shown exactly the served words (all four lists are arrays, cleaning changed no line; reviews 4, 5).
- The server ticket keeps that hash (or null). Enroll takes ONE option, `consentHash` = the served hash: it is sent to
  the company and recorded with the enrollment, so what is recorded is always what was sent. No served hash: nothing is
  sent or recorded, and mayReport fails closed (the company would refuse every rollup); the server logs it.
- The page never sees the hash (the route's allow-list has no such field; pinned).

## 409 org_consent_changed
- The ENROLL can receive it too (the company refuses a stale hash at the enroll itself, org.rs:529): it is a refusal
  with a reason, said plainly ("changed what it would see... Nothing was joined. Check the code again"), and the page
  goes back to the code field. (My first version of this plan scoped it out as rollup-only: review 1 found that wrong.)
- The rollup's 409 (show the new words, re-enroll with no code) stays with the rollup branch.

## Proof
- server.orgenroll-5531.test.js: the served hash goes back on enroll and is the one recorded; a company that serves
  none, or a malformed one, gets nothing sent or recorded and mayReport is false; the page never sees the hash.
  engine: the move path keeps the served hash; org_consent_changed is a plain refusal (a move has its own sentence).
  Each mutation reddens its own assertion.

## Weakest premise
That the hash the company serves is the one its rollup will expect. Its own comment says so (boards echo, never
recompute). Measured: both redeem and status (the move path) serve `consentHash` beside the consent
(kosmos-relay org.rs:493 and :789 at 98cb579c).

## Review 1
- Sending the hash made the enroll able to get 409 org_consent_changed, which the board read as a lost answer ("not
  known yet", a join marker). It is now a refusal with its own sentence, the page goes back to the code field (O14), and
  nothing is kept as unknown. Pinned; removing the sentence reddens it.
- A malformed served hash (uppercase, say) is never echoed; the local hash is recorded (pinned).
- servedHash's comment states that the echo assumes cleaning leaves the served words as they are (true today).

## Review 2
- A missing or malformed served hash still recorded a hash computed here, so mayReport read true while every rollup
  would be refused (the company records no accepted words). Now nothing is recorded without a served hash: mayReport
  fails closed, and the server logs that the company served none. #5531 review 5's test now has its fake company serve
  a hash, as the live one does. Pinned (the local-fallback mutation reddens it).
- A MOVE refused because the words changed says "Nothing moved. Type your join code again" (it typed no code). Pinned.
- Kept (nits): two stacked comments above servedHash; the 64-hex pattern repeated in three places.

## Review 3
- One option, not two: `consentHash` is the served hash, sent AND recorded (the old split let a caller record a hash it
  never sent). The ticket keeps one field. Stale test comment and title, the plan's What/Proof, and consentHash()'s
  comment brought up to date. The reason for echoing is the contract (the encodings could drift), not "would never match".

## Review 4
- The served hash names the RAW words; the person is shown the CLEANED ones. It is echoed only when cleaning changed
  nothing (same lists, same lines); otherwise the join records none and nothing is sent on words the person did not
  see. Pinned (a line cut past LINE_MAX, a line with a zero-width character; a control that today's words keep it).
- Decided, not changed: with no valid served hash the join still goes through but this Kosmos sends nothing, and the
  joined view says so ("It sends your company nothing: its words were not accepted on this computer", the
  `reporting` flag from #5531). Refusing the preview instead would block joining on any company that serves no hash.
  A move in that state also stops an earlier reporting record (visible the same way).

## Review 5
- The review 4 guard let a non-array list through (both sides cleaned it to []), so a hash was echoed for words the
  person did not see (measured by the reviewer). Any non-array list now means no echo. Pinned with a string backsUp.
- The stale "the echo assumes" comment is gone; consentHash() is "tests only"; the server's log names all three causes.
