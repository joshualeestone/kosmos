# Plan: #3595 Recommender + Assigner BEHAVIOUR (design first)

Author: April, 2026-09-24. Split from #2619 (settings + persistence shipped in PR #3549; UI shows both
controls disabled with "Not active yet"). UI contract: Mona's spec
`Josh-Brain/Projects/kosmos-automations-recommender-assigner-2619-spec.md`.
Status: phase 1 (Recommender) MERGED (#3617). Phase 2 (Assigner idle-assign) MERGED (#3627). Phase 3 (goals to tasks) BUILT on branch assigner-goals-3595; sub-plan .claude/plans/assigner-goals-3595-2026-09-24.md.

## What exists (surveyed on origin/main 3e3ed52c; file:line in the card comment)
- Settings: `engine/recommender-setting.js` `{on, guards:{money,public,delete}}` (on defaults OFF,
  guards default ON, corrupt guard reads ON); `engine/assigner-setting.js` `{on}` (default OFF).
  Routes GET/PUT `/api/recommender-setting`, `/api/assigner-setting`. Nothing reads them at runtime.
- A loop to copy: the Prompter. `heartbeatTick` in server.js is a self-rescheduling unref'd
  setTimeout that re-reads its setting every tick and calls a PURE `heartbeat.step(prev, roster, on)`.
  The auto-save sweep adds the "act on an agent" half: pure `sweepOnce` with injected deps,
  `chat.deliver` into the pane, state advances only when delivery is PLACED, inert under test
  (`class1Sweep`).
- Blocked signal: agents self-report `kosmos report blocked --on X --owner Y` or `needs_you "q"`
  (stored in `selfreports/<agent>.jsonl`, fields state/because/on/owner/project/auto). The roster
  exposes `state`, `because`, `stateReportedBy` ('auto'|'agent'|'operator'), `stateProject`.
  **Nothing reacts to blocked today** (the Prompter deliberately skips it).
- Idle signals: screen/reported `idle`, `commitments.read(agent).state` ('holding'|'clear'|'unknown',
  stale after 30 min), and open tasks per agent (`tasks.columnTasks`). No combined "has no work".
- Tasks: per-project, `number/sentence/detail/who/dueDate/parts`, no status field, **no priority**.
  Create route caps process-created tasks at 12/hour and pages the assignee ("you were given task N").
- Goals: only each project's `BRIEF.md` `## Goal` / "Done looks like" plus its description.
  **No owner-level goals, no "top goals", no priority anywhere.**
- Messaging: rooms (`kosmos post`, @-mention = request), `messages.roomNote` (product voice, agents
  cannot forge it), DMs. The per-pair hourly cap tells agents to stop after a few rounds.
- Guards: the same three limits already live in every agent's instructions (`engine/defaults.js`
  93-99). Agents run with bypass permissions, so **there is no tool-level enforcement point today**;
  the PreToolUse report hook sees every tool call but only uses it as a heartbeat.
- "Flywheel": the external v2 fleet-monitoring initiative (#3014 idle-by-reason, #3251). No code in
  this repo couples to it. This build does NOT depend on #3014 landing.

## Recommender design
**Trigger.** An agent whose roster state is `needs_you`, REPORTED BY THE AGENT
(`stateReportedBy === 'agent'`), with a `stateProject`, sustained past a grace period (default
10 min, so an agent that unblocks itself is left alone). Excluded: `auto` reports (permission
prompts and provider outages arrive by the hook; the class-1 handler owns those), operator
reports, agents with no project (no room to convene in), and a project carried forward from an
earlier report (`stateProjectInferred`), which the agent did not name for this question. A stopped agent is not `needs_you`,
so it never matches; there is no separate held/stopped check.

**DECIDED during the challenge loop (April, 2026-09-24): `blocked` is NOT a trigger.** Converting the
tests to real fleet cards (fixture-discipline) showed that status.js's blocked branch carries neither
`project` nor `by`, so a real `kosmos report blocked` card has `stateProject: null` and
`stateReportedBy: null`: a `blocked` trigger could never fire, and the hand-built test cards had
hidden that. Rejected: adding project/by passthrough to the blocked branch (it widens what lights
project tiles, outside this card). Kept narrow because `blocked` means "waiting on something that is
not you", a dependency peer advice cannot unblock, while `needs_you` is the decision signal.
Weakest premise: that agents report decisions as `needs_you` rather than `blocked`. What would change
it: rooms showing agents reporting decisions as `blocked`; then add the passthrough and re-add the
state (engine/recommender.test.js pins the current card shape so that change is visible).

**Convene (once per item).** Item key = agent session + the report's `because` (capped at 300
chars). For a new item:
1. A `roomNote` in the project room, in the product's voice, recording the ask. A note is a log row
   only; it is delivered to nobody (challenge loop, iteration 2), so it cannot be the ask itself.
2. The ask, `chat.deliver`ed into each peer's pane once (never retried): who is stuck, on what, and
   `kosmos post <project> "..."` to reply in the room. Peers = up to two OTHER members of a
   non-archived project whose card is on the board `idle` (preferred) or `working`; never an absent
   member and never one at ANY `needs_you` (a typed Enter on a permission prompt picks an option).
   No peers -> the agent decides alone; that is Josh's standing rule anyway. The room note is
   written AFTER the asks and names only the peers who were reached.
3. `chat.deliver` to the stuck agent: the Recommender playbook for THIS item, naming only the peers
   whose ask was PLACED (none reached says so, never "wait for replies"): wait a few minutes
   for peers, then decide; post the decision to the room with the four required parts (the call,
   what was rejected and why, the weakest premise, what would change your mind); carry it out; clear
   your report (`kosmos report working`). If the item touches an ACTIVE guard, do not act: keep the
   report for the person, post the recommendation anyway, and move to other work.
   The item ends on a PLACED or UNCONFIRMED playbook; only COULD_NOT (nothing reached the pane) is
   retried, playbook only, up to 5 times. UNCONFIRMED is not retried because chat.js defines it as
   "something may have arrived; re-sending may duplicate it".

**Consensus, stated honestly.** v1 is "peers advise, the stuck agent decides and documents". No
voting engine, no multi-round loop: the per-pair cap and the colleagues rule ("stop after a few
rounds") both argue against it, and a single documented decision is what Josh asked for.

**Who can change the setting.** `PUT /api/recommender-setting` refuses a caller `isViaScreen` reads
as a process (a presented agent token, or no browser header). This is ADVISORY, not a protection:
a local process can send the header, and the setting file is on disk. It stops the default CLI
path only. The real protection is the tool-level guards card.

**Guards, stated honestly.** v1 enforces the three guards at the INSTRUCTION level: they are in the
playbook delivered to the stuck agent (the managed instruction block is deferred), only the ACTIVE ones, with the person's own
switches respected. That matches how agents already treat these three limits (defaults.js). The
Recommender does not widen what an agent can do; it shortens the wait before a reversible decision.
A tool-level deny (the PreToolUse hook) is a separate card, not v1.

**Limits.** One convening per item: an item that was acted on is remembered for an hour even if
the card flaps away from stuck, so the same question is not convened twice. The memory is in
process and turning the setting off clears it, so a board restart or an off/on can convene a
still-standing item once more (accepted: restarts are rare, the caps still
apply, and a persisted store is more surface than this is worth in v1). Global cap (default 6 per hour) and a per-agent cap (2 per hour).
Room notes do not spend the per-pair budget; peer replies do, which is the intended brake.

**Instructions.** Phase 1 carries the whole playbook, active guards included, IN the per-item pane
delivery, so running agents get it with no restart and it always reflects the current guard
switches. A standing managed instruction block ("When you are stuck") is DEFERRED: it would duplicate
the delivery, and a block written at session start goes stale the moment a guard switch changes.
Add it only if agents are seen ignoring the per-item playbook.

## Assigner design
**Idle = no work.** An agent is idle-for-assignment when ALL of these hold continuously for 20 min
(one tick that fails any of them restarts the clock):
- its card is ours (`isNamedOurs`) and reads `idle` (which already excludes stopped, restarting,
  blocked and needs_you). There is NO "held" state in Kosmos (surveyed 2026-09-24), so the plan's
  earlier "not held" clause is dropped rather than invented;
- commitments are `clear` (a stale or never-reported `unknown` does NOT count, so no one is handed
  work mid-task). Commitments are NOT on the board card, so the runner reads
  `commitments.read(session)` for idle cards only;
- it has no open part of any task assigned to it in ANY project, archived included (picking stays
  live-only).

**Assign from existing work first.** Pick a task NOBODY is on (no part has a `who`), open, in a
live project the agent already belongs to; give it the task's first open part. Order: due date
soonest (a dated task before an undated one), then oldest. Two idle agents never get the same task
in one step.

**The write goes through the part route's own path.** `heardBy` and `tellEveryoneOn` were closures
inside the request handler; they are hoisted to module scope unchanged, and one `givePart()` is now
called by BOTH the part-assign route and the Assigner runner, so the sequence exists once. The
Assigner uses its own mode of it: its writes carry provenance `assigner`, so the agents' shared
12-per-hour parts valve and heard budget are never charged (or blamed) for them; the part must
still be free at the moment of the write (`onlyIfFree`, checked inside the same write); the pane
line is always sent, and if it cannot reach the agent at all the assignment is taken back, so
nobody is left on a task they were never told about. A refused give takes its charge back off the
Assigner's own hourly budget.

**Goals to tasks (only when there is nothing to hand out).** If an idle agent's projects have a
`## Goal` in BRIEF.md and NO open tasks, deliver one request to that agent: "Draft up to 3 tasks
toward this goal with `kosmos task add`, then take the first." It is capped by the existing
12-per-hour process-task valve. No goal and no tasks -> nothing (never invent work: standing rule).

**What "prioritized" means in v1.** Due date, then age. There is no priority field today; adding one
(schema, UI, CLI) is its own card, and ordering by it slots into the same picker later.

**Hard limits.** The Assigner never creates projects, never adds an agent to a project (membership is
the person's call), never reassigns a task that already has a `who`, and assigns at most 1 task per
agent per hour and 10 per hour overall.

## UI and defaults (per the card: "the same PR enables the controls and flips the defaults")
Each automation's controls are enabled in the SAME PR as its behaviour:
- Recommender: toggle plus the three guards live, paint/save wired to the existing routes, following
  Mona's spec (STATUS contract, could-not-read hides the knob, guards hide while off).
- Assigner: toggle live, same status contract; a failed save repaints from the store. The label
  keeps #2619's wording ("Turn your goals into assigned work"); the hint names only what ships.
**DECIDED (Splinter, 2026-09-24 11:08 CDT; Josh can override):**
- **Recommender ships DEFAULT-OFF** until the tool-level guards card lands. Reason: instruction-only
  guards under bypass permissions cannot stop an irreversible action, and real users exist now.
  Its controls become LIVE (a person can turn it on, which is honest because the behaviour is real);
  only the default stays off. The guards stay default ON.
- **Assigner idle-assign ships DEFAULT-ON** when built (Mona's spec; its hard limits are structural,
  not instruction-level: it only sets `who` on existing unassigned tasks in existing projects).
#3549 writes no file until a person changes a setting, so a default reaches every install that never
touched it.

## Build order (separate PRs, each shippable alone)
1. **Recommender** (BUILT on this branch): pure `recommender.step` plus `runOnce` over injected
   effects (engine/recommender.js); the ~1-min runner in server.js, gated on live execution like the
   class-1 sweep; room note once per item, pane playbook, retries capped at 5 and charging no budget;
   Settings control live, default OFF (Splinter), with a disclosure that the guards are instructions
   only. Tests: engine/recommender.test.js (every trigger, exclusion and limit, with controls; runOnce
   glue), web.settings-nav.test.js (live Recommender, still-disabled Assigner, the disclosure).
2. **Assigner idle-assign** (BUILT on assigner-idle-3595): pure `step`/`runOnce` in
   engine/assigner.js, the ~1-min runner in server.js (live-execution gated), `givePart` shared with
   the route, default flipped ON in engine/assigner-setting.js (missing reads on, corrupt reads off,
   as heartbeat-setting), Settings control live. Tests: engine/assigner.test.js on real cards,
   commitments, projects and tasks (every guard proven by removing it); web.assigner-save-3595.test.js
   on the real lifted page functions; docs/browser-checks/render-assigner-live-3595.js (14/14, both
   themes).
3. **Assigner goals to tasks** (BUILT on assigner-goals-3595; see its sub-plan): engine/brief.js reads
   the `## Goal` section safely; with nothing to hand out, an idle agent whose project has no open
   task and a goal is asked once to draft up to 3 tasks, with its own memory and caps (once per
   project per day, 3 asks per hour), so the ask never blocks the assignment it sets up.
4. (Separate card) tool-level guard enforcement through the PreToolUse hook.

## Rejected
- A voting/consensus engine with rounds and tallies: heavier, fights the message caps, and the ask is
  a documented decision, not a quorum.
- Triggering on `auto` needs_you (permission prompts): the class-1 handler owns those, and deciding a
  permission prompt by committee is wrong.
- Guessing priorities from task text, or inventing owner-level goals: no data supports either; say
  so and use due date/age plus BRIEF.md.
- One big PR for both automations: harder to review and verify; the card allows each to ship when real.
- Waiting for #3014 (idle-by-reason): the signals needed here exist now, and #3014 can later refine
  the predicate.

## Weakest premises (name them so they can be overturned in a sentence)
1. **RESOLVED by default-OFF (Splinter 11:08):** instruction-level guards are not enough to ship ON.
   A person who turns the Recommender on gets instruction-level guards only; the Settings hint says so
   plainly until the tool-level guards card lands.
2. That "reported needs_you with a project, for 10 min" is the right trigger. Agents that
   never report stay invisible to the Recommender (they stay visible to the Prompter).
3. That commitments `clear` is reliable enough to hand out work; an agent that forgets to assert
   commitments reads `unknown` and is never assigned (the safe direction).

## Verification (per phase)
Unit tests on the pure step functions (both arms per rule), route tests, a browser check on the
enabled controls, and a sandboxed end-to-end run: seed a project with 2 agents, report one needs_you,
and observe the room note and the delivered playbook; seed an idle agent plus an open task, and
observe the assignment and the pane message. Then served-build eyes-on after a release.
**Phase 1 as evidenced on the branch:** unit tests on real cards, route tests, a behavioural test of
the Settings save paths, and a headless browser check. The sandboxed end-to-end pane run was NOT
done on the branch; it moves to the served-build check after release.
