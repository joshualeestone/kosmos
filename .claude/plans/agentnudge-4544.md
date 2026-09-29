# agentnudge-4544: the Prompter nudges the stopped AGENT (kosmos#4544)

## Ask (Josh's Automation spec, 2026-09-29 07:51)
"Prompter / Checks on your agents / Automatically checks on your agents to ensure they continue working if they have
tasks to complete." On main the Prompter only shows the PERSON a check-in (engine/prompternudge.js); it never types to
the agent (#2623 removed that half, #3508 rebuilt only the person's).

## Decision (posted on the card 07:56; first written here as 08:12 from memory, corrected)
- Runs inside the Prompter's tick (server.js heartbeatTick) after heartbeat.step, so it follows the Prompter's switch
  and interval. The person's check-in is unchanged. New pure module engine/agentnudge.js; delivery via chat.deliver.
  Gated on live execution and the brake AGENT_WORKFORCE_AGENT_NUDGE_OFF=1.
- Who: in this tick's toAsk (which already excludes needs_you, blocked, rate_limited); card idle, ours, not a paused
  swarm; holds an open part in a live project (openParts, the same rule as assigner.hasOpenWork, held to agreement by a
  test); no open part given within the last interval.
- How often: one nudge per stall episode; the book entry is dropped when the Prompter's record closes the episode.
  COULD_NOT is retried, at most 3 tries. While Agent Communication's limit is on, nudges board-wide are capped at its
  per-hour number in any hour.
- Rejected: typing into stopped/unknown/auth_failed/connection_lost cards (the agent cannot act on text there);
  charging a pair budget (a nudge has no agent pair); a separate timer (it would drift from the Prompter's interval).
- Weakest premise: idle is the only state worth typing into.

## Verified
- engine/agentnudge.test.js (first commit): 11 pass (24 after the review rounds), real cards (test-support/fleet), real projects/tasks, toAsk from the real
  heartbeat.step.
- Mutations, each on the module in place with a byte-compared restore: once-per-stall, open-parts check, built rule,
  freshness, cap, idle card, episode release, MAX_TRIES, the hour window: every one fails a test. A first gate on
  assigner.hasOpenWork survived its mutation (openParts already decides), so it was removed rather than shipped.
- Control, measured on source: the Prompter tick in origin/main's server.js makes 0 deliver calls; on this branch 1
  (then agentnudge.sweepOnce; now inside agentnudge.prompterTick, pinned by a source test).
- Related suites green: heartbeat (18), prompternudge (10), assigner (32), web.prompter-nudges-3508 (7),
  engine.live-execution-1598 (3).
- Not measured: a real idle agent receiving the nudge and resuming (needs a live board; observe after the next release).

## Josh's addition (Splinter relayed it on the card, 08:01)
- Each name in Settings > Prompter "Agents that may need you" is a real link, `?tab=detail&agent=<session>` (the push
  deep link), keyboard-reachable; a plain click opens the agent in place via openDetail (prompterNudgeOpen), a
  modified click or an agent not on this board is left to the link.
- The person's list shows only real stalls: toAsk filtered by withOpenWork (the nudge's own openParts rule). If the
  projects cannot be read the whole list is written (too many check-ins rather than hiding a real stall).
- Weakest premise: an agent that is dead (auth_failed, connection_lost) with no open task leaves this list; its card
  still shows the state and #3723's account notice still reaches its manager.
- No browser check covers #hb-nudges; the render and the click handler are executed in web.prompter-nudges-3508.test.js.

## Challenge loop
### Iteration 1 (opus), on the pre-addition commit
- WARNING fixed: "given within the interval" read only movedAt; a task created with who (legacy task.who) or a part
  added with who carries none. Now movedAt, else the part's createdAt, else the task's. Test: a task created on the
  agent is not nudged within the interval, with a control past it.
- WARNING fixed: a project where the agent is switched off (isSwarmOff) is skipped, as the Assigner skips it.
- WARNING fixed: an episode opened on a working-to-idle edge (toAsk from 'working') waits one interval, so an agent
  that just finished a turn is not nudged at once. The backagain test now shows the wait and the later nudge.
- WARNING kept as a named limit (header and here): an agent that works less than an interval after its nudge is never
  seen working, so it is not nudged again. A re-arming timer would re-nudge an agent that answered "waiting" in words.
- WARNING fixed: the control test only checked nudgeEnabled. The whole post-step tick is now prompterTick (server.js
  calls only it), and its gates are tested: off, roster failure, not allowed, allowed() throws, brake, projects
  unreadable, each with a control that the same world IS nudged; plus the unreadable limit keeps the cap.
- CONVENTION fixed: the states test covers every non-idle state the classifier gives, asserting each fixture state.
- NITs taken: a real next Prompter step for "no second nudge"; control characters and quotes out of the typed words,
  cut on a character boundary; nudgeableCard is the Assigner's idleCard; the logged name is flattened.
- Mutations after the fixes, 21 sites: all fail a test except three. The card rule survived because the forced stall
  said from 'working' (the edge rule refused first); the test now says 'idle' and the mutation fails it. Two gates in
  prompterTick (roster array, projects read) were dead behind sweepOnce's own roster check and openParts, and were
  removed.
- Pre-existing, not this branch: tools/test-browser-check-surface-gate.sh fails 3 cases on this machine on main too.

### Iteration 2 (sonnet)
- WARNING fixed: the nudge now also requires the Prompter's own reading to be idle (toAsk to === 'idle'); a card that
  says idle at low confidence is `unknown` to the Prompter and is not typed into. Test with a control.
- WARNING kept as a named limit (header and here): the book and the hour log are in memory, like the Prompter's record,
  so a board restart (every release) nudges a still-stalled agent once more about two intervals later.
- WARNING fixed: the link is underlined at rest (it was invisible until hover, and a touch screen has no hover).
- NIT fixed: the Verified count above is marked as the first commit's (the file now has 19 tests).
- NIT taken: a source test that the Prompter tick calls prompterTick once and has no other deliver or list write
  (a wiring guard; the behaviour is prompterTick's own tests).
- NIT taken: a source test that the click handler is attached to #hb-nudges, after the markup.

### Iteration 3 (opus)
- WARNING fixed: the not-idle states test was refused by the Prompter-reading rule before the card rule (a mutation
  making nudgeableCard always true passed). It now forces from/to 'idle', and new arms cover a switched-off swarm and a
  card that is not ours, with a control.
- WARNING fixed: the Settings hint promised a check-in for every stopped agent and did not say Kosmos messages the
  agent. New copy (Josh's spec wording): "Every so often, Kosmos checks on your agents that have stopped while they
  still have tasks to finish. It can send each one a short reminder to pick its work back up, and shows a check-in below
  so you can look in on it. Everything stays on this computer. On by default." Pinned by a test. Overridable.
- NIT fixed: the restart limit is about one interval, not two (the Prompter opens a never-seen stall on its 2nd tick).
- NIT fixed: a direct test that sweepOnce refuses a null roster and says why.
- NIT fixed: prompterTick reads the projects only when there is a stall.
- NIT deferred: Agent Communication's copy does not say the same number paces the Prompter's nudges. A separate count
  at the same number; reversible later if it confuses.

### Iteration 4 (sonnet)
- WARNING fixed: the hint promised a reminder always; it goes only with live execution allowed and within the cap.
  Now "It can send each one a short reminder"; the test pins "can send".
- WARNING duplicate: the two named limits and "resume" unmeasured (already recorded; the card stays open until a
  resume is observed after release).
- NIT fixed: a broken sentence in the module header, now only what the code does.
- NIT fixed: the link comment said "opens in a new tab" without the condition; it is a modified click that does.

### Iteration 5 (opus)
- WARNING fixed: comments outside the diff (heartbeat.js, prompternudge.js, the server's #3508 block, three web
  comments) still said the list is every stall; each now notes the #4544 narrowing.
- WARNING decided: heartbeat.js asks about auth_failed and connection_lost because they have no other path to the
  person, and the open-task filter was hiding them. Now the person's list (renamed realStalls) keeps those two
  whatever they hold, and filters only the quiet states (idle, stopped, unknown) by open work. Josh's point, no
  every-idle-agent noise, holds; broken agents are not hidden. The hint adds "or that need reconnecting". Reversible.
- WARNING duplicate: "resumes" unmeasured, already recorded.
- NIT fixed: the book is released on every tick (releaseClosed), gated or not, so a stall that closed while the nudge
  was off does not block the next one. Test.
- NIT fixed: a retry that reached nothing is logged like firstreply-nudge (first try, reached, given up).
- NIT fixed: the hour window is pinned at exactly one hour.
- NITs declined: a plain click on an agent not on this board falls through to the deep link (rare; the list comes
  from the board); the link drops dev query params (limit, first-run, mode); the lazy require inside the loop.

### Final validation, 09:16 CDT (from date)
- The full suite ran once the test ports were free: 11,935 tests, 1 failed, fixture-discipline.test.js "no test
  builds an agent card or a roster row by hand": web.prompter-nudges-3508.test.js hand-built LAST as
  [{ sessionName: 'amara-singh' }]. Fixed: the click test takes its LAST from test-support/fleet (a real card) in a
  sandboxed data root. fixture-discipline 20 pass, the web test 11. Loop resumes with one more blind round (6j rule).
