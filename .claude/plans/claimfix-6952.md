# claimfix-6952: the room claim leftovers from #6946 review round 8

Card: kosmos#6952 (claimed: icecreamkitty). Stacked on `roomclaim-6946` (#6946); the PR opens after #6946 merges.

## Decision
1. **A post that @-names members can be claimed only by them.** In `react()` claim mode (and a plain 🙋), when the post's
   `mentioned` list is not empty and the agent is not in it, the claim is refused: "that post asks bob, so it is theirs
   to take: read the room, and ask them if you can help" (`askedOf` names them). `mentioned` is who the post addressed
   when it was sent (#185), NOT `to`, which is the delivery list and can be every member (the #6920 seed is exactly
   that). The guidance says to claim only a post that asks the room or you by name (doctrine v39).
2. **`kosmos room`'s reactions line leaves out raised hands.** The "is claimed by" line already says who holds the post;
   listing every 🙋 there showed a holder who left, or an old pill from before claims, as if they held it.
3. **`kosmos react ... 🙋` says it made a claim** (both CLIs), reading the board's stored emoji, so a toned input is
   reported correctly too.
4. **`operator` is a reserved name for reacting**, as `you` is: the room's text view names the person `operator`.

Rejected: refusing a claim on a post whose `to` excludes the agent (`to` is delivery, not asking); showing only the
holder's 🙋 on the reactions line (the claim line already does it, and a second place to read the holder is a second
place to get it wrong).

## Proof
- engine/roomclaim-6946.test.js #6952: a post naming bob refuses ann's claim and her plain 🙋, and bob claims it;
  control: a post with `to` = every member but nobody named is claimable by ann. Mutant (rule off) goes red.
- server.projects.test.js #6946: no 🙋 on the reactions line after a claim; control: zeta's 👍 is on it. Mutant (filter
  off) goes red.
- both CLI tests: react 🙋 prints the claim sentence; control: 🔥 prints "Reacted".

## Weakest premise
That `mentioned` is how a request names its owner. A post that asks "can ann take this?" without an @-mention names
nobody to the board, so anyone can still claim it. And doctrine-past.js carries the v38 rows by hand until #6946 is on
main (the tool reads origin/main's history); rerun `node tools/doctrine-past.js` after rebasing onto it.
