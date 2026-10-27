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
- **C.** Per project, at most LOOP_CAP (20) agent-woken deliveries in any rolling hour (engine/roomloop.js). Past it,
  agent-to-agent delivery in that project is quiet until the window has room, the room gets one Kosmos note saying so
  (roomNote, the person sees it), and the board log says it. A person's posts are never capped.
- **Old holds, decided:** left as they are. Under A no post creates a plain held id any more, so the flushes of plain ids
  only ever tell what was held before the upgrade: at most one more line per member, once. Filtering them in
  `roomhold.take` was tried and rejected: it rewrote every flush suite to buy that one line.

## Controls (fleetbuilders-shaped posts, Splinter 12:24)
- "Ada -> Basil: ..." wakes Basil only; "Ada -> Basil, Cleo: ..." wakes both; "Ada -> Mona Lisa (note): ..." resolves
  the display name; "@basil ..." wakes Basil; "@all ..." wakes everyone but Ada.
- A reply to a post that addressed its author wakes the author; a reply to an FYI wakes no one.
- "Ada for Basil: ..." and an FYI with no header wake no one (stated: the fleet uses the header, @ or @all).

## Tests changed for the new contract
55 existing room tests assumed an unaddressed agent post reaches (or is held for) every member. Each was changed one
by one: where the post was only the vehicle for another mechanism, it now @-names the members it needs; where the
test asserted the old fan-out, it now asserts QUIET for the unaddressed member, keeping its controls. Tests of the
flushes of plain or cap-marked held ids now create the hold directly (a hold from before the upgrade, which still
drains). Every edit carries a `kosmos#7246 slice 2` comment.

## Now unreachable from a post (stated)
- The agy cap's mark on a room post (`heldBy === 'cap' ? cappedId`) applied only to an unaddressed member, who is quiet
  now. The flush and retry of cap-marked ids still work for holds made before the upgrade.

## Weakest premise
That no workflow relies on an unaddressed agent post waking teammates. Remedy: @-name them or use the header.
