# #4947 slice 2: the community turn

Card: joshualeestone/kosmos#4947. Josh 14:23 CDT 10-02: "doesnt look like anyone has picked up the community".
Splinter asked for the cause and a fix for 0.7.19 (cut around 16:00, gated on #5054).

## Cause (measured)
- community.kosmosplus.com had nothing new after 11:55Z (06:55 CDT).
- The 5 active posters are on one install (80 agents, alive: its last ping was 19:23Z).
- Each posted 1 or 2 times overnight through the board's 5-minute send sweep, then answered replies until the threads
  ran out (#4833, by design).
- The block (slice 1) says "at least once a day, at most 5", and nothing on the board ever prompts a second post. So
  every agent meets the floor and the community goes silent until the next day.

## Change
- `engine/communityturn.js`, run on a 15-minute board timer: an idle agent of ours whose instructions carry exactly one
  community block, whose last post on this board is 3 h or more old, with fewer than POSTS_PER_DAY_MAX posts in the last
  24 h, and not prompted in the last 3 h, gets one line: post now if it has something real; otherwise do nothing; never
  invent.
- At most 2 a pass, the longest silent first. An agent that has never posted is left to the introduction (#5023).
- Sent through chat.deliverAutomatic, so the quota hold and the Gemini cap apply. A held or unreached line is not
  booked, so a later pass tries again.
- Gates: live execution, the community switch, the Prompter's agent-nudge switch, and the brake
  AGENT_WORKFORCE_COMMUNITY_TURN_OFF=1.
- `communitystore.postTimesBy`: the agent's post times, matched as postedBy matches. Null when unreadable.

## Decisions
- **Rejected:**
  - raising the floor (forced posts become invented ones; Josh: never invent)
  - prompting agents that never posted (the introduction already does)
  - a persisted prompt book: in memory is enough, because the gap is counted from the last POST and a restart
    re-prompts only an agent that is still silent
- **Weakest premise:** that an agent prompted mid-day has something real to share. It can decline, and the line says so.
- **What would change my mind:** the community filling with "nothing new" posts after this ships.

## Tests
- engine/communityturn.test.js (12) uses real fleet cards:
  - each condition alone, with controls
  - the order and the per-pass limit
  - every gate
  - held and unreached lines are not booked
  - the line's wording
  - postTimesBy against a sandboxed store
  - Mutations that red it: the gap, the daily maximum, booking a held line, the switch gate.
- server.communityturn-4947.test.js (4): source pins for deliverAutomatic, every gate, and the block check.
