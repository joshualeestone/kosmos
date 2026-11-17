# runnerrestart-8598 (kosmos#8598)

Follow-up to #8593 (PR #8606). Measurement and plan are on the card (issuecomments 6932852762, 6939814828).

### What already exists
- `removal.restart(name, cause)` (engine/remove.js) restarts one agent. It is the same path the provider and model switches use. It kills the session, launchd starts it again, and the new Codex starts fresh from the managed path, which now points at the new tree. **It does not resume the conversation**, so every restart costs that agent its context.
- Idle: `assigner.idleCard`. The pattern to copy is engine/instructionreread.js: two idle readings in a row, and one more roster read just before acting.
- Kosmos keeps no record of which Codex version an agent launched on, and nothing fires when an install finishes. The sweep has to read this for itself.

### Decided: a narrow restart, not every Codex agent
Because a restart loses context, the sweep restarts a managed Codex agent only when all of these hold:
1. Its runner is the managed Codex (`job.claude` is the managed bin) and the managed tree is no longer stale (the new version is in place).
2. Its running codex process started **before** the upgrade's swap. The swap time comes from a record a proved upgrade writes beside the tree (`upgraded.json`: from, to, at; engine/runners.js). A same-version repair or a first install writes none, so it restarts nobody (review 1 replaced the `pkg` change time, which any reinstall moves).
3. That process has **no code-mode host child that started before the swap**. In my measurement (case D), an agent whose host was already running kept working. A host started after the swap is the new tree's and fails, so that agent is restarted too (review 1).
4. It reads idle on two sweeps in a row, and again just before the restart.

Gated like the other sweeps: inert under test and before the live-execution opt-in, brake `AGENT_WORKFORCE_RUNNER_RESTART_OFF=1`. One restart per agent per pin per board run; a refused restart is tried again, at most three times. An agent an account move holds is left to the move (`remove.heldByMove`, review 1: `restartAsync` does not refuse a held agent). The card shows a plain restart (`'restart'`, a word engine/disruption.js knows); the board log line `runner-restart:` says why.

Rejected:
- **Restart every old Codex agent.** It costs every agent its context, including those that are safe (case D).
- **A folder per version.** It closes the mid-turn gap, but changes the layout that several readers assume (see my earlier comment).

### The weakest part
Whether real agents use code mode at all. 0.149.1's feature flag is off, but its model metadata has a per-model `tool_mode` field (`code_mode`, `code_mode_only`). So the live model catalog may turn code mode on whatever the flag says. I have no Codex account on this Mac to check.
- **If it is on:** any agent that has made a tool call already has its host, so the sweep mostly restarts agents that have done little since launch. That costs little context.
- **If it is off:** no agent ever has a host, so the sweep restarts every old agent once, for a failure that cannot happen. The restart still moves them to the new version, which gpt-6-astra needs.

What would change my mind: a models_cache.json from a real account showing no model with a code-mode `tool_mode`. Then I would add a check for that and skip the restart.

### Not covered
A wall-clock step between the swap and a later pass (an NTP correction after sleep) shifts the comparison of a process's start time with the recorded swap time by the size of the step. Not handled: at worst one extra restart, or one missed, per board run (review 7).
Not measured on a live Codex pane: whether Codex keeps a long-lived SHELL child for the whole session (a tool server started through a shell, a persistent exec session). If it does, that agent reads as busy with a job on every pass and is never restarted. The board logs `runner-restart: <agent> has-job` at the first pass and then hourly, so this shows up in the log rather than staying silent (review 5).
A host that exits and starts again later (idle timeout, crash). That was not measured, and the sweep cannot predict it. Windows: Homer's lane, and Windows stays on 0.149.1.

### Added while building
- A background job holds the restart: an idle card with a running shell job would lose that job (engine/automove.js names the hazard). Only a SHELL that is a direct child of Codex counts (review 3); a long-lived child that is not a shell, such as a tool server, does not hold it.
- Code mode is in real use: a live models_cache.json carries tool_mode code_mode_only on 5 of 6 models (Liu Kang m7607).
- Validation: targeted tests locally (the local full suite is held on Mortals); the full suite runs in CI.
