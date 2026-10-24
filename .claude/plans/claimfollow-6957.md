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
4. **No author exemption** (added in the first version, removed in review 4). An author holding its own request
   ("@bob can you take the login bug?") would lock bob out of it with no time limit, since a claim, unlike the asked
   window, does not end on its own. An author who means to do the work waits out the window (30 minutes at most).
5. **The reserved-name refusal says what to do** for an agent named `operator` from before #6952. An agent's session
   name cannot be changed (the profile changes only its display name), so it says to ask the person to make a new
   agent under another name.
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

## Review 4 (blind, 0 BLOCKER, 2 WARNING + 1 low): fixed. "Someone ELSE" plainly excludes the named member, but
"Thanks @bob! Can someone else take...?" and "someone else please take this" read as bob's; "can someone else" now
asks the room wherever it sits, and the subject form allows "else". The author exemption is removed (above).
Noted: the person's page still shows their 🙋 pill beside a newer claim while the text view hides it.

## Review 5 (blind, 0 BLOCKER, 2 WARNING): fixed. "Will/would anyone else...?" is a question to bob, not a request, so
the "someone else" rule is "can/could" only; the every-asked-member half of the release rule had no test (a mutant to
"some" passed) and now has one. A name in the @-strip cannot end in a dot. Accepted, bounded by the window: "@bob does
this reproduce for you? Anyone else?" opens the post.

## Review 6 (blind, 0 BLOCKER, 2 WARNING): fixed. The refusal sent agents to ask for a rename that changes nothing;
"could someone else have changed this?" and "can anyone else see the logs?" are questions to bob, so "can/could
someone else" no longer counts before a possessive or have/be/see/know/think/use/access. Two rules got their first
test (a name cannot end in a dot; only a marked claim given back counts), and two comments were brought up to date.
Noted, bounded by the window: "@bob, quick question: who can approve deploys?" opens the post (a "who" question after
a clause start).

## Review 7 (blind, 0 BLOCKER, 2 WARNING): fixed. The @-name strip worked only at the start of the post, so "The deploy
failed again. @bob, who can look at it?" and "Morning @bob, who...?" opened bob's post; it now runs at every clause
start with a wider greeting list. "Can/could someone else" kept a growing skip list of question verbs, mostly untested;
it is inverted to a short allowlist of hand-off verbs (take, grab, pick, handle, own, cover, do, look, jump, help, step),
so "can anyone else reproduce this?" is bob's. Two unreachable lines in the release replay are removed.

## Review 8 (blind, the cap; 0 BLOCKER, 1 WARNING): the loop ends here by the usage rule. One narrowing after it, NOT
re-reviewed, because it only takes back an opening this branch added: `help` is removed from the "can/could someone
else" hand-off verbs, so "@bob can someone else help you with this?" stays bob's (a helper's claim there locked bob out
with no time limit). The rest is follow-up #6974: "who can help you?" after a clause start, "around to" and the
"else" subject form without a clause anchor, a single-pass person's-🙋 scan, and the legacy pill edge.

## Proof
engine/roomclaim-6946.test.js #6957 (each with a control that can return the dangerous answer) and
server.projects.test.js #6946 (the person's 🙋 after a release and beside a newer claim, through the real route).
Mutants checked red (each confirmed to change the file): the release rule, its order, its every-member half and its
claim mark; the future-dated rule, its one-minute threshold and the window clamp; the "who's" form and "has time";
"around to"; the clause-led bare ask; the new line, bracket, em dash and comma clause starts; the @-name strip (its
clause-start reach, the greeting, the dash, the "!", the word replacement, the no-trailing-dot name); "can/could
someone else" and its hand-off-verb allowlist; "need someone to" on replies; the reserved-name sentence; and the
person's-🙋 filter. NOT individually pinned: the en dash, each greeting word, each "who" verb, each hand-off verb.

## Weakest premise
That a give-back means the asked member is done with it. A member who releases to hand it to a specific colleague
would do that in a post of its own, which asks the colleague; this rule opens it to anyone instead.
