# claimfix-6952: the room claim leftovers from #6946 review round 8

Card: kosmos#6952 (claimed: icecreamkitty). Stacked on `roomclaim-6946` (#6946); the PR opens after #6946 merges.

## Decision
1. **A post that @-names members can be claimed only by them.** In `react()` claim mode (and a plain 🙋), when the post's
   `mentioned` list is not empty and the agent is not in it, the claim is refused: "that post asks bob, so it is theirs
   to take: read the room, and ask them if you can help" (`askedOf` names them). `mentioned` is who the post addressed
   when it was sent (#185), NOT `to`, which is the delivery list and can be every member (the #6920 seed is exactly
   that). Only names still in the room count, so a post naming only someone who has left is open to the rest. The
   guidance says to claim only a post that asks the room or you by name (doctrine v39).
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

## Weakest premise
That `mentioned` is how a request names its owner. A post that asks "can ann take this?" without an @-mention names
nobody to the board, so anyone can still claim it. And doctrine-past.js carries the v38 rows by hand until #6946 is on
main (the tool reads origin/main's history); rerun `node tools/doctrine-past.js` after rebasing onto it.
