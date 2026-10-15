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
- Fail directions: a policy read that throws sends nothing to the community ('policy', its own words and log line)
  and closes rooms, but does not stop messages, starts or creation. At a restart it reads as not taking part, so the
  community block is removed (as with the switch off) and the stopped lines are not written.
- Hot paths (every message, every community send check, instruction composition, room seats) read the applied
  policy (orgpolicy.current: no signature check, no write); the routes, Start and create apply a fresh bundle first
  (inForce). A bundle arrives on the board's status pass, as before.
- A zone a computer cannot read is held to its shape only, as the coordinator holds it, so it never refuses the
  bundle (it would take outside_contact down with it); quiet hours then last all day, said in those words.
- Answering an agent's question (the menu) in quiet hours is refused like a message, and reported.
- A shared room under the policy tells its agents it is closed, and a post there gets a note that it stayed here.
- Board-made restarts (provider/model change, account move) are not refused at night: they finish a change.
- launchd's own login start is not stopped; an agent that gets no new message sits idle.
- Automatic nudges refused in quiet hours are not reported (noise). Reported: the person's message, question
  answer, Start/Restart and create in quiet hours (an agent calling Start through the CLI reads as the same act),
  and every agent community act under the policy, reads included.

## Not done here (named, not missed)
- A policy that arrives while the board runs rewrites instructions only at the next board start or agent restart
  (enforcement is immediate).
- The trust-and-restart route carries `quiet: true` but has no route test; the communityready 'policy' lines and the
  Settings line have no test of their own.
- A connected agent (the person's own folder) that never carried the community block is not given the stopped
  lines at board start, only at its next restart: the board never adds text to a person's own file (Splinter
  11:37 on #5297). The community itself is refused to it either way.
- Items made under the policy read 'policy' while it is in force and "before it was on" after it lifts (no policy
  window is recorded, unlike an unreadable switch's).
- Under the policy the send sweep still runs its take-down housekeeping (deletes, take-down reads, settling an
  unconfirmed send): it only removes content, never sends any.
- engine/win32inbox.js (fleet tooling behind an operator's ps1, not a customer path) types into Windows agents
  without deliverWithGap.
- Under-13 consent and kid-profile pieces; family wording across the console; tamper resistance against the
  computer's own user.

## Validation
- New: engine/orgpolicy-family-6239 (5), engine/agentevents-board-6239 (6), engine/familycontact-6239 (6),
  engine/familyquiet-6239 (6), server.familypolicy-6239 (5). Every gate mutation-proven red (11 engine and 7
  server, then 9 more for challenge round 1's fixes); one redundant gate (fedseats.ensureAll) found unwatched and
  removed.
- Neighbour sweep (74 files naming touched modules); final: full suite through queued-heavy.
