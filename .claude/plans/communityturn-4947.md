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
- Sent through chat.deliverAutomatic (held on the shared-quota pause).
- Gates: live execution, the community switch, the Prompter's agent-nudge switch, and the brake
  AGENT_WORKFORCE_COMMUNITY_TURN_OFF=1.
- `communitystore.postTimesAll`: every agent's post times in one read, matched as postedBy matches. Null when unreadable.

## Decisions
- **Rejected:**
  - raising the floor (forced posts become invented ones; Josh: never invent)
  - prompting agents that never posted (the introduction already does)
  - a persisted prompt book: in memory is enough, because the gap is counted from the last POST and a restart
    re-prompts only an agent that is still silent (it can come before the 3 h since its last TRY; the gap since its last post still applies)
- **Weakest premise:** that an agent prompted mid-day has something real to share. It can decline, and the line says so.
- **What would change my mind:** the community filling with "nothing new" posts after this ships.

## Tests
- engine/communityturn.test.js (22 after reviews 1 to 4) uses real fleet cards:
  - each condition alone, with controls
  - the order and the per-pass limit
  - every gate
  - held and unreached lines are not booked
  - the line's wording
  - postTimesAll against a sandboxed store
  - Mutations that red it: the gap, the daily maximum, booking a held line, the switch gate.
- server.communityturn-4947.test.js (5): source pins for deliverAutomatic, every gate, and the block check.

## Review 1 (opus) and what changed
- **BLOCKER, starvation:** agents held on the quota (or unreachable) sorted first and took both slots every pass. Now
  quota-held agents are skipped BEFORE the per-pass cut, and any non-held try (reached or not) is booked, so an
  unreachable agent backs off 3 h instead of being retried every pass. Tested with two held agents ahead of two free
  ones; mutations red it.
- **Now the same gates as the sibling nudges:**
  - agentnudge.nudgeableCard (no switched-off swarm member)
  - replynudge.stoodDown (no agent whose projects are all paused for it)
  - idle at least replynudge.IDLE_FIRST_MS by its own idle report
  - Agent Communication's per-hour limit, counted in the board-wide hour log AGENT_NUDGE_SENT
- **At most PROMPTS_PER_DAY (3) tries per agent in 24 h,** so "do nothing" does not become 8 paid turns a day.
- **postTimesBy keeps postedBy's corrupt-sidecar guard** (null). postTimesAll reads posts.json once per pass.
- **Comments:** they no longer claim a Gemini cap (that is #4588, unmerged). The line starts "Kosmos here:", like the
  sibling nudges.
- Noted, not changed: the service's default cap of 3 posts a day vs the block's 5 (consistent with the block;
  postWaits says when a post goes later).

## Review 2 (sonnet) and what changed
- **The agent-nudge brake applies too:** tickOnce gates on agentnudge.nudgeEnabled (live execution and
  AGENT_WORKFORCE_AGENT_NUDGE_OFF), then its own brake. Tested, with a control.
- **The idle gate is strict:** no idle report (null, or a latest report that is not idle) is not due. Tested, with a
  control.
- **Smaller fixes:**
  - the garbled header line
  - the line's "3 hours" is built from TURN_GAP_MS and pinned
  - posts.json is read only once the gates pass and an agent is looked at
- Unchanged: a malformed per-hour limit reads as unlimited, the same as replynudge's capOf.

## Review 3 (opus) and what changed
- **A busy pane (another message still being placed) is not booked:** act pane-busy, no try spent. That is the
  replynudge rule, from chat.js's own contract. Tested.
- **A throw counts as UNCONFIRMED** (it may come after the paste): booked and counted in the hour log, as replynudge
  does.
- Smaller fixes:
  - the limit default comes from limits.DEFAULTS
  - the line says "3 hours ago or more", matching the gate
  - a comment says the tick must stay synchronous (no overlap guard)

## Review 4 (sonnet) and what changed
- **An agent is due only if its card was idle at the previous pass too** (replynudge's review-14 rule). The tick keeps
  this pass's idle cards for the next. Tested: the first time an agent is seen idle, it is not prompted.
- **Header reworded:** what guards a working agent is the card reading idle from its pane now, plus the previous
  pass. The age of the idle report is a lower bound only.
- **postTimesBy removed** (nothing in production called it). The board and the test both use postTimesAll.
