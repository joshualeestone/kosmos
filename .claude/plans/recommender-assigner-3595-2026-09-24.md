# Plan: #3595 Recommender + Assigner BEHAVIOUR (design first)

Author: April, 2026-09-24. Split from #2619 (settings + persistence shipped in PR #3549; UI shows both
controls disabled with "Not active yet"). UI contract: Mona's spec
`Josh-Brain/Projects/kosmos-automations-recommender-assigner-2619-spec.md`.
Status: DESIGN. No code until this is on the card.

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
**Trigger.** An agent whose roster state is `blocked` or `needs_you`, REPORTED BY THE AGENT
(`stateReportedBy === 'agent'`), with a `stateProject`, sustained past a grace period (default
10 min, so an agent that unblocks itself is left alone). Excluded: `auto` reports (permission
prompts; the class-1 handler owns those), `owner` = provider (outages are not decisions), operator
reports, agents that are held/stopped, and agents with no project (no room to convene in).

**Convene (once per item).** Item key = agent + hash(because|on). For a new item:
1. A `roomNote` in the project room, in the product's voice: "Recommender: <agent> is stuck on
   <because>. @<peer1> @<peer2>: one reply each with the call you would make and why." Peers = up to
   two OTHER project members, preferring ones not themselves blocked. No peers -> the blocked agent
   decides alone (step 2 still runs); that is Josh's standing rule anyway.
2. `chat.deliver` to the blocked agent: the Recommender playbook for THIS item: wait up to N minutes
   for peers, then decide; post the decision to the room with the four required parts (the call,
   what was rejected and why, the weakest premise, what would change your mind); carry it out; clear
   your report (`kosmos report working`). If the item touches an ACTIVE guard, do not act: keep the
   report for the person, post the recommendation anyway, and move to other work.
   Advance item state only when delivery is PLACED (auto-save pattern).

**Consensus, stated honestly.** v1 is "peers advise, the stuck agent decides and documents". No
voting engine, no multi-round loop: the per-pair cap and the colleagues rule ("stop after a few
rounds") both argue against it, and a single documented decision is what Josh asked for.

**Guards, stated honestly.** v1 enforces the three guards at the INSTRUCTION level: they are in the
convening message and in a managed instruction block, only the ACTIVE ones, with the person's own
switches respected. That matches how agents already treat these three limits (defaults.js). The
Recommender does not widen what an agent can do; it shortens the wait before a reversible decision.
A tool-level deny (the PreToolUse hook) is a separate card, not v1.

**Limits.** One convening per item. Global cap (default 6 per hour) and a per-agent cap (2 per hour).
Room notes do not spend the per-pair budget; peer replies do, which is the intended brake.

**Instructions.** A new managed block ("When you are stuck", marker registered in `ALL_MARKERS`),
written to members' instruction files only while the Recommender is on, listing the active guards.
It is rewritten on a setting change. Running agents get the per-item `chat.deliver`, so no restart is
needed for the behaviour itself.

## Assigner design
**Idle = no work.** An agent is idle-for-assignment when ALL of these hold for 20 min (hysteresis):
- the roster state is `idle` (screen or reported), not held, not stopped, not blocked or needs_you;
- commitments are `clear` (a stale `unknown` does NOT count, so no one is handed work mid-task);
- there are no open tasks assigned to it in any project.

**Assign from existing work first.** Pick the oldest OPEN UNASSIGNED task in a project the agent
already belongs to. Order: due date soonest, then oldest. Set `who` through the same path as the
task route, so the agent's instruction file re-syncs and it gets "you were given task N" in the pane.

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
- Assigner: toggle live.
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
1. **Recommender**: a pure `recommender.step(prev, roster, setting, now)` returning `{toConvene, next}`,
   the loop in server.js (Prompter-shaped, inert under test), convening via roomNote plus chat.deliver,
   the managed instruction block, UI enabled, default on. Tests: step unit tests (every trigger,
   exclusion and limit, with controls), route/setting integration, a render check on the live controls.
2. **Assigner idle-assign**: pure `assigner.step`, the idle predicate, the picker, the loop, UI enabled,
   default on.
3. **Assigner goals to tasks**: the BRIEF.md goal read and the draft request.
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
2. That "reported blocked/needs_you with a project, for 10 min" is the right trigger. Agents that
   never report stay invisible to the Recommender (they stay visible to the Prompter).
3. That commitments `clear` is reliable enough to hand out work; an agent that forgets to assert
   commitments reads `unknown` and is never assigned (the safe direction).

## Verification (per phase)
Unit tests on the pure step functions (both arms per rule), route tests, a browser check on the
enabled controls, and a sandboxed end-to-end run: seed a project with 2 agents, report one blocked,
and observe the room note and the delivered playbook; seed an idle agent plus an open task, and
observe the assignment and the pane message. Then served-build eyes-on after a release.
