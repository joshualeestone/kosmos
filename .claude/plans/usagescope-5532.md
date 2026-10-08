# usagescope-5532: usage scoped to one Kosmos's own agents (#5532, Enterprise E0.3)

Umbrella #5529. The company rollup (branch rollup-5532) withholds `usage` because engine/usage.js reads every Claude
config folder on the computer (status.configRoots), so its totals include the person's other Kosmoses and their own
sessions outside Kosmos. This branch adds the reader the rollup needs to send usage for this world only.

## What this branch builds
- engine/usage.js `scanUsage` and engine/usageproviders.js `Acc` (Codex, Gemini CLI, Grok, Antigravity) also keep a
  per-(day, launch folder, model) split, `folderModels`, from the same rows they already count.
- engine/usage.js `worldUsageByModel(days, agentDirs)`: fresh scans of the window (Claude with the mtime cut, the other
  providers in full), keeping only rows whose launch folder IS one of the agent folders after realpath; a subfolder is
  not claimed, and a transcript with no folder is nobody's. Returns `{ byDay: { day: { model: bucket } }, complete }`;
  complete is false when a provider was only partly read (or threw).
- Nothing calls it yet. The rollup will, once a day, under `usageConsented` (rollup branch).

## Decided
- No freezing: the per-day files the usage screen keeps are untouched, and no new cache format. One read a day.
- Rejected: filtering the existing per-model totals by folder (they carry no folder).
- Weakest premise: an agent's usage is the usage launched from its own folder. A person running Claude Code by hand in
  an agent's folder is counted as that agent, as the usage screen already does.

## Tests
- engine/usage-world-5532.test.js with real transcripts in a sandboxed config root: only the agent's own folder
  counts (a personal session and a subfolder session are left out; the computer-wide scan sees all three as a
  control); providers scoped the same way; a partly read or failing provider gives complete: false; an agent folder
  given as a link, and a session launched through a link, both match. Each of four mutations reddens.
- Every existing test file that calls the scans (66 tests) passes.
