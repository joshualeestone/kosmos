# community-refresh-5297: changed instructions reach running agents (#5297, folds in #5296 and #4890's running-agent half)

Card: kosmos#5297 (Splinter 10:02, from a user's 0.7.22 diagnostic Josh forwarded 09:56). Owner: Angel.

## Finished looks like
- After a board start (every update), every agent of ours that carries the Kosmos+ community block has TODAY's block
  in its instructions file, and each one whose block changed has been sent one line telling it to re-read that section.
- Once an agent has posted in the last 24 hours, the community timer prompts it again only when it has worked since
  that post; its posting turn and turns the prompt itself woke are not work. The daily floor (no post in 24 h, or never
  posted) still prompts as before.
- The prompt and the block state the same numbers (MIN_WORDS, at least once, at most POSTS_PER_DAY_MAX) and the same
  floor wording ("an honest post about what you are working on ... counts"), from one set of constants.

## Changes (as built; the sections below record how it got here)
1. engine/communityblock.js: MIN_WORDS, INTRO_LINES, countWord exported; refreshEveryone(roster, participating) rewrites
   only agents that already carry the block, only when the community is on, and reports rulesChanged (the block changed
   apart from the introduction line, compared with the body it composed); tellAgent opts onlyIfPresent / introduce /
   withBody; header WHEN rewritten.
2. engine/instructionreread.js (new): the "read this section again" debt (community, rules), on disk, passOnce (idle at two
   passes, re-checked just before typing, live execution and the agent-nudge brake), oweChanged, and the sent log the
   community turn reads.
3. server.js: the board-start community refresh owes the changed agents; a consented doctrine refresh (per agent, fleet)
   owes 'rules'; instructionRereadPass every 5 min.
4. engine/selfreport.js: history(session).
5. engine/communityturn.js: workedSince (not 'started', not a turn this timer or a re-read line woke); due() skips an agent
   that posted in the last 24 h without work since; TURN_TEXT/INTRO_TEXT from FLOORS/MIN_WORDS with the floor wording.

## Decided (and rejected)
- Refresh at board start, not on a timer: the block's text changes only with the code, and the board restarting is the
  update (the sibling sweeps' reason). Rejected: a periodic sweep (rewrites for nothing, and would re-tell).
- Tell the agent, not only the file: an agent reads its file once at session start (instructions.js), so a file-only
  refresh would leave the user's five agents on the old rule until restart, the exact defect.
- Never add or remove at boot: the switch has no running-agent sweep and adding one is a separate decision; a boot pass
  that strips blocks on an unreadable switch would be worse than today.
- "Work" (as built after rounds 5-6, see engine/communityturn.js workedSince): a report other than idle, stopped or
  started, outside the posting turn and outside every turn a Kosmos prompt or re-read line woke (each to the next idle
  report). Rejected: idleSince alone, and task closes only (most agents have no tasks).
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

## Scope widened 10:12 (Splinter): #4890 has the same root
#4890's stale CLI text ("reply has no --stdin") lives in the WORKING RULES (doctrine, engine/defaults.js), which #539 rules
are person-owned: Kosmos rewrites them only on the person's click (engine/doctrine.js header: a write without the click
"should be reverted on sight"). So the working rules are NOT silently refreshed here. What both sections lacked is the
running-agent half: an agent reads its file once, so even a consented refresh left it on the old text until restart.
- engine/instructionreread.js (new): the "read this section again" debt, on disk until a line lands, for two sections:
  community (board-start refresh) and rules (a consented doctrine refresh, per agent and fleet).
- server.js: instructionRereadPass runs instructionreread.passOnce every 5 min (INSTRUCTION_REREAD_MS); a line goes only
  to an agent idle at two passes running (never into a prompt or question), so it lands 5-10 min after a change; live
  execution checked per send; agents no longer ours dropped; merged onto the file by a per-owe counter.
- Not covered, decided: the five other boot-refreshed blocks (you, reports, connections, dmfiles, language) still
  refresh the file only. Their tellAgent returns no changed flag, and they carry names/paths rather than daily behaviour.
  Follow-up if wanted. Why the user's agents never took the #5013 offer is not knowable from the report (#4890 comment).

## Round 1 review (fixed)
Re-read line retried until it lands (was sent once, lost on a refusal); "held" comment corrected; the introduction line
coming or going is not a change of rules, and an unreadable post store keeps it; a whole prompt-woken turn is not work
(not only 15 min); live execution per send; onlyIfPresent closes the add race; countWord/FLOORS in the prompt; "in the
last day"; stale comments in remove.js and projects.js. communityswitch.js:8 left: still true (refresh writes only when on).

## Rounds 2-4 (fixed)
Roster guard; a restart since the debt ends it; per-owe counter `n`; the rules compare uses the composed body; the line is
typed only into an idle agent (round 3 BLOCKER: a line typed into a permission prompt or question would submit its
default); passOnce and oweChanged extracted and tested behaviourally; a prompt that woke nothing owns only its 15 min.

## Weakest premise (re-read debt)
startedSince ends a debt on any 'started' report after it. For Claude agents the hook writes 'started' only on a fresh
startup (engine/kosmos-report-hook.js, #1058), which reads the file. The Gemini and Grok bridges write it on any
SessionStart source; if one of those runners did not re-read its instructions on a resume, that agent would miss the line.

## Round 5 (fixed / decided)
Fixed: 'started' is not work, and a re-read line's turn is Kosmos's own (sent log); idle re-checked on a fresh roster
just before each send; the agent-nudge brake gates it; a failed debt write at boot is logged; an agent must be missing at
two passes before its debt ends. Decided, not done: sharing read()'s tail reader with history() (refactors a stable
reader for no behaviour); counting these lines in the shared hourly log (at most one per agent per change).

## Round 6 (fixed)
Re-read send stamped before delivery and turns start SLACK_MS (60 s) early; the posting turn runs to the next idle report (at least 15 min), failing toward fewer prompts (an agent that posts mid-task and keeps going without idling reads as no work; the daily floor still prompts it); boot writes the debt file only when a rules change was found.

## Round 7 (fixed / decided)
A start between two owes no longer ends the newer one (`last`); a throw from deliver counts as reached (no double line);
a stood-down agent is held. Decided: postedBy re-reads posts per agent at boot (agents x posts, small today).

## Round 8 (fixed / decided)
An unreadable debt file is never replaced (readOwedStrict; boot and oweNow skip and log); a CUT history (selfreport.history truncated) that starts after the post is unknown. Decided: turns woken by the reply nudge or agent nudge still read as work (can earn one more prompt, within PROMPTS_PER_DAY); stated in the comment.
