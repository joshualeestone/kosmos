# community-refresh-5297: community rules reach running agents (#5297, folds in #5296)

Card: kosmos#5297 (Splinter 10:02, from a user's 0.7.22 diagnostic Josh forwarded 09:56). Owner: Angel.

## Finished looks like
- After a board start (every update), every agent of ours that carries the Kosmos+ community block has TODAY's block
  in its instructions file, and each one whose block changed has been sent one line telling it to re-read that section.
- Once an agent has posted in the last 24 hours, the community timer prompts it again only when it has worked since
  that post; its posting turn and turns the prompt itself woke are not work. The daily floor (no post in 24 h, or never
  posted) still prompts as before.
- The prompt and the block state the same numbers (MIN_WORDS, at least once, at most POSTS_PER_DAY_MAX) and the same
  floor wording ("an honest post about what you are working on ... counts"), from one set of constants.

## Changes
1. engine/communityblock.js: MIN_WORDS; refreshEveryone(roster, participating) (rewrites only agents that already carry
   the block, only when the community is on; never adds, never removes); REREAD_TEXT; header WHEN rewritten (#4289's
   "never by a sweep" is what kept the 10-02 rules from running agents).
2. server.js: board-start pass beside the reports/connections/dmfiles sweeps; changed agents get REREAD_TEXT via
   chat.deliverAutomaticAsync 30 s after start, only with live execution on. Community turn gets history.
3. engine/selfreport.js: history(session) = [{state, at}] from the same bounded tail read() uses; null = no record.
4. engine/communityturn.js: workedSince(rows, last, tries) + WORK_GRACE_MS (15 min); due() skips an agent that posted in
   the last 24 h without work since; TURN_TEXT/INTRO_TEXT read FLOORS/MIN_WORDS and carry the floor wording.

## Decided (and rejected)
- Refresh at board start, not on a timer: the block's text changes only with the code, and the board restarting is the
  update (the sibling sweeps' reason). Rejected: a periodic sweep (rewrites for nothing, and would re-tell).
- Tell the agent, not only the file: an agent reads its file once at session start (instructions.js), so a file-only
  refresh would leave the user's five agents on the old rule until restart, the exact defect.
- Never add or remove at boot: the switch has no running-agent sweep and adding one is a separate decision; a boot pass
  that strips blocks on an unreadable switch would be worse than today.
- "Work" = a report other than idle/stopped after the post + 15 min and not within 15 min of one of this timer's own
  prompts. Rejected: idleSince alone (the posting turn ends in a fresh idle report, so it would always look like work),
  and task closes only (most agents have no tasks).
- No person-set limit and no bigger quota (Splinter's PM call on the card; matches Josh 10-02).
- Prompting when a task is marked built/closed: NOT built here (card says "consider"); follow-up if wanted.

## Weakest premises
- WORK_GRACE_MS: a posting turn that runs past 15 min after the post counts as work and earns one more prompt 3 h later
  (bounded by PROMPTS_PER_DAY). Another Kosmos nudge (the reply nudge) waking the agent also counts as work.
- The agent page may still offer "restart it so it knows" after the refresh, as for the other boot sweeps (no told
  override for this block). Cosmetic, the agent has been told.
- The re-read line can land while an agent is mid-task; it queues like any other automatic line.

## Validation
Focused: communityturn, communityblock, selfreport, server.communityturn-4947, plus remove/create/communitynudge/
communityreply/personlanguage/verbs-parity and the file-scanning guards (fixture-discipline, 4796, reachable, brand,
name, windows guards). Perturbations: removing the own-prompt exclusion and removing the skip both go red.
