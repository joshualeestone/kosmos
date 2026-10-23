# claimfix-6952: the room claim leftovers from #6946 review round 8

Card: kosmos#6952 (claimed: icecreamkitty). Stacked on `roomclaim-6946` (#6946); the PR opens after #6946 merges.

## Decision
1. **A post that asks particular members can be claimed only by them** (the rule as it stands after review 6; reviews
   2, 4 and 5 each narrowed it, see below). In `react()` claim mode, and for a plain 🙋, the asked members are:
   - the members the post @-named (`mentioned`, who it addressed when sent, #185; never `to`, the delivery list, which
     can be every member), unless an @-word was ambiguous (`ambiguousMentions`) or the post asks the room for the work
     (CLAIM_ROOM_ASK: a room word where it is the one asked, "can someone...", "anyone free to...", "whoever can...",
     "who can...", "any takers"; not in passing, as in "@bob fix the bug someone reported"); "one of you" and the like
     mean the named members;
   - else, for a post naming nobody that answers an agent's post (`replyTo`), that post's author, unless the replier is
     that author or the reply asks the room (CLAIM_ROOM_ASK, or "one of you" and the like).
   Only members still in the room count. A hand-off, by the person or an agent, is a post of its own that asks whoever
   it names, and they claim that post. A refused claim says "that post asks bob, so it is theirs to take: read the room,
   and ask them if you can help (if they hand it to you, claim the post where they do)" (`askedOf` names them). The
   guidance (doctrine v39) says to stand down when `kosmos claim` says the post asks someone else, and to claim a
   hand-off where it is made.
2. **`kosmos room`'s reactions line leaves out AGENTS' raised hands.** The "is claimed by" line already says who holds
   the post; listing every agent's 🙋 there showed a holder who left, or an old pill from before claims, as if they
   held it. The person's 🙋 stays on the line: it is not a claim, it says "yes, you do it".
3. **`kosmos react ... 🙋` says it made a claim** (both CLIs), reading the board's stored emoji, so a toned input is
   reported correctly too.
4. **`operator` is a reserved name**, in any case: refused when an agent is created (engine/create.js nameProblem,
   beside `kosmos-connect`) and when an agent reacts, as `you` already was. The room's text view names the person
   `operator`, so such an agent read as the person on every line.

Rejected: refusing a claim on a post whose `to` excludes the agent (`to` is delivery, not asking); showing only the
holder's 🙋 on the reactions line (the claim line already does it, and a second place to read the holder is a second
place to get it wrong).

## Proof
- engine/roomclaim-6946.test.js #6952: a post naming bob refuses ann's claim and her plain 🙋, and bob claims it;
  control: a post with `to` = every member but nobody named is claimable by ann. Mutant (rule off) goes red.
- server.projects.test.js #6946: after zeta claims and the person clicks the pill, the reactions line shows the person's
  🙋 and not zeta's; control: zeta's 👍 is on it. Mutants (filter off; person's 🙋 dropped) each go red.
- engine/roomclaim-6946.test.js #6952 review 1: a post naming only a departed bob is claimable by ann (control: with bob
  in the room it is not); `operator` in any case is refused at creation (control: `operators` is allowed).
- both CLI tests: react 🙋 prints the claim sentence; control: 🔥 prints "Reacted".

## Review 1 (blind, 0 BLOCKER, 3 WARNING): fixed. A post naming only a departed member was unclaimable forever (now
filtered by the room); the reactions filter hid the person's own 🙋 (now kept); `operator` was reserved only for
reacting (now at creation too, any case). doctrine-past.js sections re-sorted as the tool writes them; the claim
sentence names the real project and post. Noted, not changed: a post that @-names bob and also asks the room for
something else is bob's alone to claim; a claim made before this rule on a post naming bob still holds.

## Review 2 (blind, 0 BLOCKER, 2 WARNING): fixed. "Asked" is now what the room's own delivery calls asked (asksIt):
the @-named members plus the author of the post it answers (unless that is the person), so a quote-reply "yes, go
ahead" to bob is bob's. And a post can be handed on: a later answer to it by the person or by someone it asks that
@-names others asks them too (control: an agent that was not asked cannot hand it to itself). The refusal says so.
Nits: the claim sentence prints the board's post id (m530 for a typed 530) and is pinned whole in both CLIs; a holder's
🙋 toggle-off says the post was given back; create.js drops a no-op lowercase.

## Review 3 (blind, 0 BLOCKER, 1 WARNING): fixed. An agent answering its own post ("found it, can someone take it?")
became asked by itself and locked the request to the one agent that could not do it; the author of the answered post
is now asked only when it is not the replier, as delivery does (control: the person's answer still asks the author).
Doctrine v39 says not to claim an answer to someone else's post. The reactions line keeps the person by the 'you'
sentinel before renaming. Test controls use posts the product can make, and refusals assert their reason.
Noted, not changed: a person's answer naming ann on bob's question leaves bob able to claim too (matches asksIt).
**Rebasing after #6946 squash-merges:** `git rebase --onto origin/main origin/roomclaim-6946`, then rerun
`node tools/doctrine-past.js` (it will then keep v38 itself).

## Review 4 (blind, 0 BLOCKER, 4 WARNING): fixed by simplifying hand-offs. Three warnings were corners of "a later
answer by an asked member hands it on" (a side question handed the task away; the request's author could not redirect
it; the person's hand-off of an open post was ignored). Now ONLY the person's later answer that @-names members
re-assigns the post, whether or not it asked anyone before. An agent handing work on does it in its own post ("@ann
please take this"), which asks ann, and ann claims that post; the refusal and the doctrine say so. This supersedes the
review-2 hand-off rule. Doctrine v39 no longer forbids claiming "an answer to someone else's post" (the board allows
some of those); it says to stand down when kosmos claim says the post asks someone else. The give-back sentence prints
only when a claim was released (`released: true`), not for an old pill that was never the claim.
Not changed: the printed release command does not quote a project id with a space.

## Review 5 (blind, 0 BLOCKER, 1 WARNING): fixed by narrowing "asked" again, to what is unambiguous. The lock had
used every name a post mentions as an exclusive owner, which locked "can someone review what @bob shipped?" to bob,
an open post to whoever the person's side question named, and "now can someone write the notes?" (a reply to bob's
status) to bob. Now: the @-named members, unless an @-word was ambiguous or the post asks the room
(CLAIM_ROOM_ASK: everyone, anyone, someone, whoever, one of you...; not ROOM_ASK, whose "confirm" and "reply" ask the
named member too, and not "?"); or, for a post naming nobody that answers an agent's post, that author, unless the
reply asks the room. The person's later replies no longer re-assign the original post: a hand-off, by the person or
an agent, is its own post, and the one it asks claims that post. This supersedes the review-2 and review-4 hand-off
rules. The v39 version-log entry now matches the shipped text.

## Review 6 (blind, 0 BLOCKER, 3 WARNING): fixed. The room-ask list opened requests plainly for one member when a
room word appeared in passing ("someone reported", "anyone else", "everyone's tests"), and "one of you" opened a post
naming ann and bob to cy. Room words now count only in the position of the one asked, and group words only on a post
naming nobody. "Who can" and "any takers" count too. The server test pins the departed holder and an old unmarked
pill on the reactions line; the engine test pins `released`. Rebased onto roomclaim-6946 217e00a14b (its
engine.reachable and tmpscope fixes).

## Weakest premise
That `mentioned` is how a request names its owner. A post that asks "can ann take this?" without an @-mention names
nobody to the board, so anyone can still claim it. And doctrine-past.js carries the v38 rows by hand until #6946 is on
main (the tool reads origin/main's history); rerun `node tools/doctrine-past.js` after rebasing onto it.
