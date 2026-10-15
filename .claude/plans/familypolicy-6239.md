# familypolicy-6239 (kosmos board half of kosmos#6239's first slice)

Card: joshualeestone/kosmos#6239 (Kosmos+Kids). First slice routed by Splinter 2026-10-15 10:32 CDT; Josh's rulings
10:42 (under 13 in scope from the start) and 10:45 (pings stay; a kid's agent is told not to take part in the
community, and the product enforces it). Coordinator half: joshualeestone/kosmos-relay branch familypolicy-6239
(the two keys in POLICY_KEYS / policy_problem, the two rule words, the console's Family preset).

## What this branch does
1. `engine/orgpolicy.js`: shapeOk holds `outside_contact` and `quiet_hours` to the coordinator's exact shapes (a zone
   this runtime cannot read is refused too); `contactAllows`, `quietAt`, `quietAllows`. Windows belong to the day
   they start on; school nights are windows starting Sunday to Thursday. Words name "the policy set for this Kosmos",
   never a company.
2. `engine/agentevents.js`: `recordRefusal` queues the board's own refusals (`outside-contact`: network/network-host;
   `quiet-hours`: run/other; session ref `kosmos-board`) in their own file, at most one per agent and rule in ten
   minutes, under the same consent words; the tick takes them in with no await before its write.
3. Outside contact off:
   - community: `communitysend.switchState()` says `policy` over an ON switch (everything that is not `on` sends
     nothing); its own words (notOnWords, NOT_SENDING.policy); agent acts refused under it are reported;
     `communityswitch.participating()` is false; the person's switch is left as they set it.
   - instructions: the community block gives way to STOPPED_LINES ("You do not take part ..."), at birth, at
     restart and at board start (refreshEveryone), and the block comes back when allowed.
   - Settings: `/api/community-setting` carries `stopped`, shown under the switch.
   - federation: invite, verify, join and own-code refused (403, nothing signed); remove/withdraw still allowed;
     `fedseats.ensure` lets a running seat go and starts none, the link kept.
4. Quiet hours: `chat.deliverWithGap` refuses every new message (the one place all senders pass) except the
   look-after commands (PAUSED_SWARM_COMMANDS); the person's Start/Restart (`quiet: true` on the two routes) is
   refused and reported; `createAgent` refuses. A person's message refused for it is reported (thread route).

## Decided
- Fail directions: a policy read that throws sends nothing to the community (unreadable) and closes rooms, but does
  not stop messages, starts or creation, and does not rewrite instructions.
- Board-made restarts (provider/model change, account move) are not refused at night: they finish a change.
- launchd's own login start is not stopped; an agent that gets no new message sits idle.
- Automatic nudges refused in quiet hours are not reported (noise); only the person's acts and agents' community acts.

## Not done here (named, not missed)
- A policy that arrives while the board runs rewrites instructions only at the next board start or agent restart
  (enforcement is immediate).
- The trust-and-restart route carries `quiet: true` but has no route test; the communityready 'policy' lines and the
  Settings line have no test of their own.
- Under-13 consent and kid-profile pieces; family wording across the console; tamper resistance against the
  computer's own user.

## Validation
- New: engine/orgpolicy-family-6239 (5), engine/agentevents-board-6239 (6), engine/familycontact-6239 (6),
  engine/familyquiet-6239 (4), server.familypolicy-6239 (4). Every gate mutation-proven red (11 engine, 7 server);
  one redundant gate (fedseats.ensureAll) found unwatched and removed.
- Neighbour sweep (74 files naming touched modules); final: full suite through queued-heavy.
