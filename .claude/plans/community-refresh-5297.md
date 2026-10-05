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
1. engine/communityblock.js: MIN_WORDS, INTRO_LINES, countWord exported; refreshEveryone(roster, participating) writes
   today's block into every agent of ours with an instructions file (adding it where missing to agents Kosmos made,
   Splinter 11:16; a connected agent is refreshed only, Splinter 11:37), only when
   the community is on, never creating a file or removing a block, and reports rulesChanged (compared with the body it
   composed, introduction line aside); tellAgent opts introduce / withBody / onlyIfPresent (connected agents: refresh, never add); header WHEN rewritten.
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
- At boot: ADD where missing to agents Kosmos made (Splinter 11:16), refresh connected agents only (Splinter 11:37);
  never REMOVE (an unreadable switch must not strip blocks).
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

## Round 9 (fixed / decided)
The re-read line also needs the Prompter switch (as the community turn); a debt naming 'community' is held while the
Community switch is off; the debt file is rewritten only when a pass ends a debt; only outcomes are logged. Decided: these
lines do not count in Agent Communication's hourly limit (at most one per agent per change). Premises: the 64 KB report
tail covers about a day for the busiest agents (measured 21-30 h), so a post older than that reads unknown (no extra
prompt); GIVE_UP_MS counts from the latest owe (round 15).

## Splinter 11:16: agents that never had the block (fixed before merge)
A team's 0.7.22 write-up: 41 of 58 agent folders have no community block (made before the feature, never restarted), and
the community turn only looks at agents whose file carries it. refreshEveryone now ADDS today's block to every agent of
ours that has an instructions file (never creates a file, never removes a block, nothing while Community is off); an
added block is a rules change, so the agent is owed the re-read line, and from then on the community turn sees it.
Decided: a person who deleted the block by hand gets it back at the next board start while Community is on (the managed
blocks all work this way; Community off is the per-install opt-out). No per-agent opt-out exists to honour.

## Round 12 (fixed / decided)
One read of the post store per board start (postTimesAll; a post with no receivedAt is not counted, as that reader
already does); the send gate reads communityswitch.participating(), the refresh's own gate. Decided: each real block
write rotates the file's one-deep `.previous` backup (true of every managed-block write; the person's undo then holds
the pre-refresh file, which is still their text plus the old block); a cut history can only miss a 'started' row, so
the cost is one extra re-read line, never a lost one.

## Round 13 (fixed / decided)
A switched-off section no longer holds the whole debt: the line names the sections that are on, the off ones stay owed.
The Prompter gates only the community line; a working-rules line (the person's accepted refresh) needs only live
execution and the brake. Decided (NITs): INTRO_TEXT keeps "do nothing" (its alternative is the introduction itself);
history() keeps its own tail reader (round 5); a folder that cannot be edited is reported at every boot, as the
sibling sweeps already do.

## Round 14 (fixed / decided)
The working-rules line says "added or updated" (a fleet click can add them for the first time). Decided: the first
board start after this ships owes a re-read to every agent that had no community block (41 of 58 in one team's
folders); delivery is paced by the idle-at-two-passes gate, one agent at a time. Not a defect: the community turn's
tries book is on disk (communityturn.readBook at boot, review 6 of #4947), so a restart keeps its prompt times.

## Round 15 (fixed / decided)
GIVE_UP_MS counts from the latest owe (a held community debt no longer takes a late rules line with it); a failed rules
owe is logged; the unreachable no-line branch is gone. Decided: connected agents (instructions in the person's own folder)
get the block at boot too; the restart path (remove.js) already adds it to them while Community is on, so this only
stops it depending on a restart, and Community (default ON, #5023) is the install's consent. Flagged to Splinter.
Known (NIT): the agent page still offers "restart it so it knows" after a refresh it has been told about.

## Splinter 11:37: connected agents are refreshed, never added to (supersedes the round 15 decision)
A connected agent's file lives in the person's own folder, often a git-tracked repo; a board start (every update) silently
adding text there is an unexplained diff in their project, which costs more trust than the posts are worth. So the ADD
skips an agent whose folder is outside Kosmos's workers folder (create.workerDir vs workersDir; unknown reads as
connected). If it already carries the block, it is refreshed as before. The restart path is unchanged (a restart is a
visible act). Josh can overturn it.

## Round 19 (fixed / decided)
At most MAX_PER_PASS (3) re-read lines a pass, the rest the next pass (the first board start after this ships drains over
several passes instead of one); the repo CLAUDE.md Community row names communityblock's board-start refresh,
instructionreread and communityturn. Decided, duplicates of earlier decisions: the Gemini/Grok 'started' premise; null
history prompts nobody beyond the floor; server wiring is pinned by source and now exercised by the 13 boot tests.

## Round 20 (fixed)
The missing-at-two-passes mark is cleared with the idle marks and kept only for still-open debts; the per-pass cap is
checked before the roster read. Decided NITs: a gate-off pass leaves debts for later (they expire normally); a CRLF block
costs at most one extra line.
