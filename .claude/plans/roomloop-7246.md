# kosmos#7246 slice 2: agents in a room never wake each other in a loop

## Problem (2026-10-27, a person's busy room)
Agents read posts, replied that they had read them and had nothing to do, and the replies woke the others again; it
used up the person's whole provider allowance. Slice 1 (#7260) only throttles big rooms to an hourly digest, and three
paths stay open: a reply to an agent's own post and an @ are typed at once; a member with no hook idle is typed every
post; rooms of 8 or fewer keep the per-post turn-end flush.

## Design (decided on #7246, comment 6448701836, and Splinter's 12:24 check)
- **Addressed** (engine/messages.js `addressedMembers`): a post addresses a member when it @-names them (unchanged,
  `mentionedMembers`), or STARTS with the fleet's header `Sender -> Name[, Name]:` (each name resolved by the same
  `@` rule, so "Mona Lisa" is monalisa), or says `@all` / `@everyone` (every member but the sender). The page's
  highlight stays @-only (web.mention-parity-4642 holds `mentionedMembers`, which is untouched).
- **A.** An agent's post wakes only the members it addresses. Every other member's outcome is `quiet`: not typed,
  not held, in the room to read. A person's posts are unchanged.
- **B.** A reply wakes its author only when the post it answers asked someone something: a person's post, or a post
  that addressed at least one member.
- **C.** Per project, at most LOOP_CAP (40) agent posts that woke anyone in any rolling hour (engine/roomloop.js), decided
  once per post. 40 is about three times the busiest agent hour measured in this fleet's room (13); a guess with that basis. Past it,
  agent-to-agent delivery in that project is quiet until the window has room, the room gets a Kosmos note saying so, at most
  once an hour (roomNote, the person sees it; round 5), and the board log says it. A person's posts are never capped.
- **Old holds, decided:** left as they are. Under A no agent post creates a plain held id (an @all is typed at once,
  round 7), so the flushes of plain ids only tell what was held before the upgrade: at most one more line per member, once. Filtering them in
  `roomhold.take` was tried and rejected: it rewrote every flush suite to buy that one line.

## Controls (fleetbuilders-shaped posts, Splinter 12:24)
- "Ada -> Basil: ..." wakes Basil only; "Ada -> Basil, Cleo: ..." wakes both; "Ada -> Mona Lisa (note): ..." resolves
  the display name; "@basil ..." wakes Basil; "@all ..." wakes everyone but Ada.
- A reply to a post that addressed its author wakes the author; a reply to an FYI wakes no one.
- An FYI with no header, and a "for"/"to" sentence whose sender is not the poster ("Thanks to Kitty:"), wake no one.

## Tests changed for the new contract
55 existing room tests assumed an unaddressed agent post reaches (or is held for) every member. Each was changed one
by one: where the post was only the vehicle for another mechanism, it now @-names the members it needs; where the
test asserted the old fan-out, it now asserts QUIET for the unaddressed member, keeping its controls. Tests of the
flushes of plain or cap-marked held ids now create the hold directly (a hold from before the upgrade, which still
drains). Every edit carries a `kosmos#7246 slice 2` comment.

## Now unreachable from a post (stated)
- The agy cap's mark on a room post (`heldBy === 'cap' ? cappedId`) applied only to an unaddressed member, who is quiet
  now. The flush and retry of cap-marked ids still work for holds made before the upgrade.

## Review rounds 1 and 2 (changes)
- A person's post keeps its @-names alone; the header and @all are for agents' posts.
- The row keeps @-names in `mentioned` (the claim guard, owner rule, owed answers and the #185 nudge read it, and an
  @all there would make every member owed an answer, which the nudge would wake). Who it named is `addressed`, read
  only by rule B (round 6: without @all). @all does not wake a swarm switched off in the project.
- B asks whether the answered post addressed THIS replier (a bystander's +1 wakes no one).
- Quiet posts count as missed in the catch-up line and cost the room valve nothing (reachedCount).
- The sending agent is told: both CLIs say when a post left members quiet and how to address one, and print the
  pause's `because`.
- @all inside a code span, @all-hands and @everyone-else are not broadcasts.

## Weakest premise
That no workflow relies on an unaddressed agent post waking teammates. Remedy: @-name them or use the header.

## Review round 3 (changes)
- The room valve charges an agent's post up front for the members it will wake (addressed, not switched off here, the
  project not paused), the same count reachedCount gives the logged row. It charged the whole room, so a post to one
  member was held as if it reached everyone. 20 valve tests drove the valve with unaddressed posts, which now cost
  nothing; each now says @all (one comment per test), so they still test the valve.
- The header is read by hand (postHeader): it ends at the first ':' outside parentheses, takes "->", "→", or the
  word "to" or "for" (then the sender must name the poster, so "Thanks to Angel:" is a sentence), a leading ** or *,
  and targets split on ',', ' and ', '&'. A one-word target names the one member whose display name has that word
  ("Renet", "Baron", "Kitty"); two members sharing it, neither. Controls are real Fleet Builders posts.
- Agents are born with "Post to the room (it wakes only the members it addresses: ...)" instead of "Post to everyone
  on it", in the instructions and the two join lines.
- A person's post clears the project's agent-wake count (roomloop.clear), so the pause note's "Your own messages
  still reach them" is true and the agents can answer them.
- KEPT: the catch-up line on most wakes ("This room has been talking without you: N earlier posts"). It is accurate,
  and it is the one pointer a woken member gets to the quiet posts it did not see.
- Small: install/kosmos reads `because` only at the route's own opening (a nested because is never printed); the
  pause note and the board log print the live cap; two messages.test.js titles say what they now test; rule B's
  reply reaches its author marked (#4642).

## Review round 4 (changes and decisions)
- The cap's count is taken once per post, synchronously, before any member is typed (the members it wakes are
  `charged`). The async route types members over several event-loop turns, so a count taken afterwards let posts started
  meanwhile all read "not paused" and run past the cap. A post that then reaches nobody still counts: the cap is a
  backstop, and it errs toward quiet.
- Both CLIs: when the board says why (a pause), the post DID address its members, so they print only "Posted to X."
  and the Note, never the advice to address someone.
- "Ada -> all:" and "Ada -> everyone:" are the header's @all.
- Tests added: the window freeing and a new pause said again, a pre-upgrade row's charge, two async posts at the cap.
- KEPT (round 3, again): the catch-up line. It counts posts; it does not quote them or ask the member to read them.
- NOT DONE, stated: agents already born keep "Post to everyone on it" until an event rewrites their projects block
  (a task or membership change); there is no start-up rewrite of every boot file, and adding one is a bigger change
  than this card. They learn the rule from the CLI on their first quiet post, and the rule is posted in the room.
- Follow-up, not this card: a per-pair limit (A woke B N times in an hour with no person post). Today two agents
  answering each other by header are stopped only by the project's 40, which also quiets everyone else there.
- Accepted: the arrow form does not check that the sender names the poster ("Note -> Angel:" addresses Angel); a
  sender name of four or more words is not a header.

## Review round 5 (changes and decisions)
- A header target is its longest leading run of one to three words that names a member, so "-> Mona Lisa on m702:",
  "-> Angel re #12:" keep their names; the word form tries every "to"/"for" split ("Ada to Basil for review:").
- Both CLIs say "It woke no one: it addresses no member" when every outcome is quiet, and a folded retry of a quiet post
  is described as quiet, never as "everyone on it has it" (the shell CLI reads the outcomes object alone).
- The pause note is said at most once an hour per project (a person's post resets that): the window slides, so each
  wake that aged out let one post through and re-said it, 41 notes in 80 minutes in the reviewer's run.
- (Reverted in round 7: an @all held for a busy member waited for a turn end a hook-idle agent never has.)
- `kosmos room` names the members a post woke ("the room" when it woke no one), not every member it was in the room for.
- The note says "their posts woke one another 40 times" (it counts posts).
- Accepted: an @all inside a quotation ("Josh said \"@all please confirm\"") is a broadcast; only `code` is excluded.

## Review round 6 (changes)
- `addressed` (rule B's set) leaves out @all, so the answers to a broadcast do not each wake its author; an answer to
  a named ask still does.
- The catch-up line goes to every member the post wakes, a rule-B author included.
- A person's post clears the agents' count only once it reached the room (a refused one does not).
- Removed an unread counter.

## Review round 7 (changes)
- BLOCKER, fixed by reverting round 5's hold: an @all is typed at once, like an @-name. Held, it waited for a turn end
  that an idle agent with the turn-end hook never has, went to the hourly digest as "not addressed to you" in a big
  room, and was dropped as stale after two hours. Losing an ask is worse than interrupting a busy member with a
  broadcast its sender chose. The test now uses a hook-idle member (the fleet's usual state) and a working one.
- An author woken by rule B gets "[message from your colleague ...]" with "FYI, no reply requested" (unless the answer
  also names it), never "not addressed to you".
- Who a row asked by name (namedIn: @-names plus header names, never @all) is read by the claim guard, the #6608 owner
  rule and the answer-quote audience. Owed answers and the #185 nudge keep to @-names.
- Reopen, and a post from the person's other computer, clear the agents' count, as a post here does.
- The header is read from the post as written: cleanMessage joins every line, so the "first line" was the whole post.
- `kosmos room` leaves out members a post could not reach (could_not); a held one is listed (it is told later).
