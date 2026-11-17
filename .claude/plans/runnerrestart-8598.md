# runnerrestart-8598 (kosmos#8598)

Follow-up to #8593 (PR #8606). Measurement and plan are on the card (issuecomments 6932852762, 6939814828).

### What already exists
- `removal.restart(name, cause)` (engine/remove.js) restarts one agent. It is the same path the provider and model switches use. It kills the session, launchd starts it again, and the new Codex starts fresh from the managed path, which now points at the new tree. **It does not resume the conversation**, so every restart costs that agent its context.
- Idle: `assigner.idleCard`. The pattern to copy is engine/instructionreread.js: two idle readings in a row, and one more roster read just before acting.
- Kosmos keeps no record of which Codex version an agent launched on, and nothing fires when an install finishes. The sweep has to read this for itself.

### Decided: a narrow restart, not every Codex agent
Because a restart loses context, the sweep restarts a managed Codex agent only when all of these hold:
1. Its runner is the managed Codex (`job.claude` is the managed bin) and the managed tree is no longer stale (the new version is in place).
2. Its running codex process started **before** the current tree was swapped in. The test is the process start time against the swap time (the `pkg` directory's change time), so it reads what the process actually is, not a memory of it.
3. That process has **no live code-mode host child**. In my measurement (case D), an agent whose host was already running kept working. Only one that has yet to start a host fails.
4. It reads idle on two sweeps in a row, and again just before the restart.

Gated like the other sweeps: inert under test and before the live-execution opt-in, brake `AGENT_WORKFORCE_RUNNER_RESTART_OFF=1`, one try per agent per pin per board run. The cause is `'runner'`, so the board line says why.

Rejected:
- **Restart every old Codex agent.** It costs every agent its context, including those that are safe (case D).
- **A folder per version.** It closes the mid-turn gap, but changes the layout that several readers assume (see my earlier comment).

### The weakest part
Whether real agents use code mode at all. 0.149.1's feature flag is off, but its model metadata has a per-model `tool_mode` field (`code_mode`, `code_mode_only`). So the live model catalog may turn code mode on whatever the flag says. I have no Codex account on this Mac to check.
- **If it is on:** any agent that has made a tool call already has its host, so the sweep mostly restarts agents that have done little since launch. That costs little context.
- **If it is off:** no agent ever has a host, so the sweep restarts every old agent once, for a failure that cannot happen. The restart still moves them to the new version, which gpt-6-astra needs.

What would change my mind: a models_cache.json from a real account showing no model with a code-mode `tool_mode`. Then I would add a check for that and skip the restart.

### Not covered
A host that exits and starts again later (idle timeout, crash). That was not measured, and the sweep cannot predict it. Windows: Homer's lane, and Windows stays on 0.149.1.

### Added while building
- A background job (any non-host child of the Codex process) also holds the restart: an idle card with a running shell job would lose that job (engine/automove.js names the hazard).
- Code mode is in real use: a live models_cache.json carries tool_mode code_mode_only on 5 of 6 models (Liu Kang m7607).
- Validation: targeted tests locally (the local full suite is held on Mortals); the full suite runs in CI.
