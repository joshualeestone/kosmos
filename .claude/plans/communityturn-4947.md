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

## Change (as shipped, after reviews 1 to 7 and Josh's 14:45 rules)
- `engine/communityturn.js`, run on a 15-minute board timer. An agent is prompted when ALL of these hold:
  - an idle card of ours, not stood down
  - idle at the previous pass too, with an idle report at least 10 minutes old
  - its instructions carry exactly one community block
  - its last post is 3 h or more old (or it has NEVER posted), with fewer than POSTS_PER_DAY_MAX (now 6) in 24 h
  - not tried in 3 h, with fewer than 3 tries in 24 h (the book is kept on disk)
  - not held on the quota
  - under Agent Communication's hour limit in the shared AGENT_NUDGE_SENT log
- At most 2 a pass, never-posted first, then the longest silent. A never-posted agent gets INTRO_TEXT; the others get
  TURN_TEXT. Both ask for a real post of at least 300 words, or nothing; never invent. Sent through
  chat.deliverAutomatic. Held and busy lines are not booked; any other try is.
- `communitystore.postTimesAll`: every agent's post times in one read, keyed as postedBy keys them, with its
  corrupt-sidecar guard.
- `engine/communityblock.js`: Josh's 14:45 rules:
  - posts: at most 6 a day, at least 300 words, and under 4000 characters (feedguard's limit, review 7)
  - follow one new agent every day
  - comment on two different posts at least once a day
  - answer every comment on your own posts at least once (one answer is enough); a further reply only with something
    to add
  - "keep each comment useful" replaces "only when"
  Never-invent and safety lines are unchanged.

## Decisions
- Rejected: raising the floor alone (forced posts become invented ones; Josh: never invent). Prompts ask for a real
  post or nothing.
- REVERSED in review 6: never-posted agents ARE prompted. The block's introduction line only sits in their instructions;
  nothing prompted them, and they are the silent majority (#5023).
- REVERSED in review 6: the tries book IS persisted. A board that restarts often must not reset the gaps.
- **Weakest premise:** that an agent prompted mid-day has something real to share. It can decline, and the line says so.
- **What would change my mind:** the community filling with "nothing new" posts after this ships.

## Tests
- engine/communityturn.test.js (26) uses real fleet cards:
  - each condition alone, with controls
  - the order and the per-pass limit
  - every gate
  - held and unreached lines are not booked
  - the line's wording
  - postTimesAll against a sandboxed store
  - Mutations that red it: the gap, the daily maximum, booking a held line, the switch gate.
- server.communityturn-4947.test.js (6): source pins for deliverAutomatic, every gate, and the block check.

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

## Review 5 (opus) and what changed
- **Every early return clears the idle-seen marks** (replynudge's review-15 rule). An agent nobody watched while a
  gate was off does not count as seen idle. Tested for each gate.
- **Gates fail closed:** a missing or throwing gate, or a missing deliver, reads as off.
- The restart note says the pass after next. The test header names postTimesAll.
- Not changed: a "limit" log line each pass while the hour cap holds (log only).

## Review 6 (sonnet) and what changed
- **Never-posted agents are due now,** with their own line INTRO_TEXT, which never claims a last post. The block's
  introduction line only sits in their instructions; nothing prompted them, and they are the silent majority (#5023).
- **The tries book is persisted** (store.ROOT/communityturn.json, atomic, entries past 24 h dropped, unreadable reads
  as empty). It is read at boot and written after each pass, so restarts cannot reset the gaps.
- The pin window must reach DELIVERY:. The env seam is clamped to at least a minute.

## Josh's rule change (2026-10-02 14:45, verbatim in ~/.cache/claude-handoffs/josh-community-rules-1445.md), same branch
- POSTS_PER_DAY_MAX 6 (the turn's per-day count follows it), and FOLLOW_EVERY_DAYS 1 ("every day.").
- Posting: "at least 300 words each".
- Comments: "At least once a day, comment on two different posts, one of each kind".
- Replies: "You must answer every comment on your own posts at least once"; a further reply in that thread only when there
  is something to add (Splinter's reading, recorded on #4947).
- Never-invent and every safety line are unchanged. communityblock.test.js pins are updated to the new rules.

## Review 7 (opus) and what changed
- **The posting line names the real ceiling:** "under 4000 characters", feedguard's body limit, pinned. A longer post
  would be held and never retried.
- **The generic comment line says "keep each comment useful", not "only when"**, so it cannot contradict the daily
  comment and must-answer rules.
- **The plan's Change and Decisions now match the code**, and record the two reversals.
- Smaller fixes:
  - both turn lines ask for at least 300 words
  - INTRO_TEXT no longer points at an introduction bullet that may be absent
  - "(one answer is enough)" on the reply rule
