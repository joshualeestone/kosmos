# claimfollow-6957: room claims, the leftovers of #6952's review round 8

Card: kosmos#6957 (claimed: icecreamkitty, by Renet's night-shift --claim). Stacked on claimfix-6952 (#6952); the PR
opens after #6952 merges.

## Decision
1. **Released means released.** When every asked member still in the room has claimed the post and then given it
   back themselves, the post is open (`gaveBack`: a `claim: true` add from them, a remove they made with no `takenBy`,
   and no live claim now). Before, bob
   releasing "because I am out of usage" left cy sent to ask bob for up to 30 minutes.
2. **More room phrasings count** (CLAIM_ROOM_ASK): "Who's free..." (straight or curly apostrophe), "who has time...",
   "anyone around TO...", and a bare "anyone?" or "anyone else?" standing as its own clause ("If you cannot, anyone
   else?"). "Need someone to..." is not a room ask at all: said to bob or in a reply to his post it is bob's, and a post
   naming nobody is open anyway. Leading @-names (after an optional greeting, and before a comma, colon, dash or "!")
   address them, so "@bob, who has time...?" is bob's. Passing mentions still do not:
   "@bob ping anyone around in billing", "@bob I need someone to review this, can you do it?", "@bob is the build
   broken for anyone else?", "the bug someone else reported".
3. **A post dated more than a minute ahead of this clock is open** (a clock stepped back): its age cannot be read, and
   holding it until the clock catches up could be hours. Fails open, as before #6952. Up to a minute ahead is read as
   just posted, so a small clock adjustment keeps the hold.
4. **The author of an @-named post can always claim it** ("@bob I am taking the parser, FYI"). Not the writer of a
   reply, whose reply asks the answered author.
5. **The reserved-name refusal says what to do** ("rename this agent to react or claim"), for an agent named
   `operator` from before #6952.
6. **The person's 🙋 shows only beside the claim it agreed with** (the room row's `claimAgreed`: their latest 🙋 add is
   newer than the live claim). With no claim live it would read as theirs; beside a later holder's claim, as approving
   someone they never did.

Not done, recorded: an end-to-end test through sendPost (the engine tests still write `mentioned` by hand); one clause
asking the room ("@bob fix X. Can someone review it after?") still opens the whole post (fails open, as before #6952);
an agent named `operator` can still post, and its posts read as the person's in the text view.

## Review 1 (blind, 1 BLOCKER, 4 WARNING): fixed. The "cap" changed only the refusal's number, so a post dated
ahead still held for hours (now open); "anyone around", "need someone to" and "anyone else?" opened requests plainly for
bob (now anchored or group-only); the person's old 🙋 attached to the next holder (now only beside the claim it agreed
with); the author exemption covered replies; a claim ended for bob by a newer one counted as bob giving it back.
Accepted, bounded by the 30-minute window: "Need someone to take the login bug, @bob is out" now reads as bob's.

## Review 2 (blind, 0 BLOCKER, 3 WARNING): fixed. "Need someone to" opened a go-ahead reply to bob (now top-level posts
naming nobody only); the clause start missed a new line, a dash and a bracket ("@bob is out\nAnyone?"); "@bob, who has
time...?" read the vocative comma as a clause start (leading @-names are now replaced by a word before testing). Also:
"gave back" replays bob's rows in order, and the reserved-name refusal tells the agent to ask the person to rename it.
Noted: `claimAgreed` is used by the text view only; the person's own page still shows their 🙋 pill.

## Review 3 (blind, 0 BLOCKER, 2 WARNING): fixed. A dash after the leading name ("@bob - who has time...?") opened
bob's post, a regression from review 2's clause starts; a greeting before the name ("Hey @bob, who...?") defeated the
strip. Both are now part of the strip, as is "!". The never-reached CLAIM_NEED_ASK and its test arm that could not fail
are removed. A post up to a minute ahead of the clock keeps its hold.

## Proof
engine/roomclaim-6946.test.js #6957 (each with a control that can return the dangerous answer) and
server.projects.test.js #6946 (the person's 🙋 after a release and beside a newer claim, through the real route).
Mutants, each red: the release rule and its order, the author rule (and its @-named-only scope), the future-dated rule,
the "who's" form, "around to", the clause-led bare ask, the new clause starts, the @-name strip, "need someone to" on
replies, and the person's-🙋 filter.

## Weakest premise
That a give-back means the asked member is done with it. A member who releases to hand it to a specific colleague
would do that in a post of its own, which asks the colleague; this rule opens it to anyone instead.
