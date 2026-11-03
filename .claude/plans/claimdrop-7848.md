# claimdrop-7848: a request claimed by one addressed agent leaves the others' --unanswered

Card: joshualeestone/kosmos#7848 (Renet Tilley, from Splinter, 11-03). Follows #4926.

## Why
A room post addressed to several agents, claimed by one of them (`kosmos claim`), still showed in the other addressed
agents' `kosmos room <id> --unanswered`. Each had to answer the claim or the original to clear it: chatter, and a risk of
a second claim.

## The call
In the `--unanswered` view only (server.js room route, text arm): an ask whose live claim (the shaped row's `claim`,
messages.claimOf, the same holder the room and `kosmos claim` agree on) is held by another agent the post asked is
handled for the reader. It is left out of the list and the count, and named on a line under the list with who claimed it
and when, so the reader can still read it.
- "Asked" is the same reading as the reader's own ask: named in the post (messages.namedIn), or the person's post that
  reached that agent.
- A bystander's claim (an agent the post did not ask) does not answer for the agents that were asked.
- The reader's own claim is no answer: an ask it claimed and has not answered stays on its own list.
- A claim taken back puts the ask back. A later post that names the reader again is its own ask and is listed, which is
  the card's "unless a later post @-names one of them".
- No CLI change: both CLIs pass the text through.

Rejected:
- Counting any member's claim: a bystander claiming would silently drop an ask the asked agents still owe.
- Treating the reader's own claim as an answer: the claim says it is taking the work, not that it has answered.
- Changing the full room view: it already shows the claim pill on the post.

## Weakest premise
That a claim's holder is the right signal of "handled". A holder that claims and then goes quiet leaves the ask off the
others' lists until the claim is freed (the person can free it, #6949). The line under the list names the holder and how
long ago, so a stale claim is visible.

## Tests
server.roomread-claimed-7848.test.js: claimed by an asked agent (with a before-claim CONTROL; the claimer's own list
keeps it); a bystander's claim; a claim taken back and a later naming post; the person's ask. Mutations, each red:
no skip (3), any claimant (1), own claim counted (1), no person-post branch (1), no line (2). Related files 97/97.

## Review round 1 (opus, fixed)
- "Asked" now matches the reader's own reading on the person's post: an agent it went quiet for or could not reach was
  not asked, so its claim does not answer. And a post that names agents (a person's @name too) asked only those it names.
- The person's-ask test now asserts the ask left the list and the head line, not just that the claimed line appeared.
- Tests: the person naming only me; an unreached claimant; a claimant no longer on the project; the -n cap (count leaves
  claimed asks out, the claimed line is capped with how many older); every ask claimed (its own head line).
- The claimant's name is flattened as the post line's is; the claimed line is capped at -n with "and N older"; the head
  line when every ask is claimed says so; a comment says claimed asks are deliberately not dropped from the hold.
- Each fix mutation-checked. Weakest premise, added: with the registry unreadable, nobody is filtered as a non-member,
  so a removed claimant still takes the ask off; the trailing line keeps it visible.

## Review round 2 (sonnet, fixed)
- The asks named as claimed (at most -n) are dropped from the idle reminder's hold, as shown posts are: the reader has
  been told they are handled, so the reminder should not raise them again. Test with a CONTROL (an open ask that was
  not shown stays held); dropping the fix reds it.
- Copy: the all-claimed head line is "nothing waiting on you in this room; the ask named below was claimed by another
  agent it asked" (singular and plural); the claimed line reads "Claimed by an agent the post also asked". Test
  messages corrected.

## Review round 3 (opus, fixed by reverting round 2's hold drop)
- Rounds 2 and 3 pulled opposite ways on the idle-reminder hold. The call: claimed asks stay held. The list entry is
  reversible (it comes back by itself if the claim goes: given back, freed, or the claimant leaves), a dropped reminder
  is not, and the asks that are held are mostly the addressed holds that say "names you and asks for your answer". It
  also removes the case where an unreadable registry (nobody filtered as a non-member) would have deleted a hold.
  The test now holds the ask in its addressed form and asserts it stays held; putting the drop back reds it.
- Copy: "Claimed by another agent each post also asked"; the all-claimed head line "the ask below is claimed by another
  agent it also asked" / "the asks below are claimed by agents they also asked".
- namedReader and namedBy are built in one pass.

## Review round 4 (sonnet, no defects)
- Answered, no change: "the idle reminder repeats while an ask stays claimed". It does not: flushOnIdle takes the held
  ids, which clears them (engine/roomhold.js:557), and restores them only if the line could not be typed. So a claimed
  ask is raised once by the reminder, then lives only in --unanswered's claimed line.
- Copy: the trailing line is "Claimed, each by an agent the post also asked"; the plural head line names "the asks named
  below" (true when -n names fewer). Plural head line tested.
- Declined: a comment on claimOf's earliest-claimant rule (react() refuses a second claim on a held post, #6946).

## Review round 5 (opus, fixed)
- Both CLIs' --unanswered help now says "and that no other agent they asked has claimed".
- A claim covers the whole post for everyone it asked, which is what the card asks for; the all-claimed head line reads
  "nothing else waiting on you" so it claims no more than that. A post that asks two agents for two different things is
  the weakest case: the claimed line names it, and kosmos room shows it in full.
- When the project's members cannot be read, the claim rule is not applied (the ask stays listed): claimMembers fails
  toward "held", right for the page, wrong here. REASONED, not measured (no test makes the registry unreadable).
  Not covered: a removed-list read that fails inside claimMembers keeps removed agents as members.
- The claimed line says kosmos room shows them in full and an ask comes back if its claim is given up.
- Tests: an ask I answered and another agent claimed is on neither line; the hold test asserts the exact addressed form.
- Related and CLI test files: 2582 tests, 0 fail.

## Review round 6 (sonnet, fixed)
- The membersKnown guard was untested. Measured that it is reachable on a token-authenticated --unanswered read (a
  project record with no member list answers 200), then added a test with a CONTROL (members known: the claim takes it
  off); deleting the guard reds it. Round 5's REASONED note is now MEASURED.
- install/kosmos's comment beside the usage names the claim rule.
- Declined: dropping "else" from the all-claimed head line (round 5 chose it so the line claims no more than it knows).

## Review round 7 (opus, fixed)
- The claimed line no longer promises kosmos room shows them (it shows the last 40 rows; --unanswered walks the whole
  live room): "They are still in the room, and one comes back here if its claim ends" (given up, freed, or the
  claimant leaving all end it).
- Pinned the one case where the two "asked" readings meet: the person's post naming only the claimer, delivered to the
  reader too. Intended: the claim answers it (the person asked the claimer by name). Test added.
- The "Review N" comments are rewritten as plain kosmos#7848 rules.
- Declined: rewording the could-not-read head beside a claimed line (both are true as written).
