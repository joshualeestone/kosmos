# #2245: route the agent brief to AGENTS.md for codex agents (runner-aware writer)

## The bug (Josh launch-blocker; root cause by PigeonPete)

Agent outputs were not landing in the project folder. An agent produced files,
was told the folder path, but saved to its own cwd and the folder stayed empty.
Root cause: the two single sources that would tell an agent to save into the
project folder are BOTH written only to CLAUDE.md:

- the "where the files you make go" DOCTRINE (`engine/defaults.js`, appended at
  birth via `defaults.appendTo` and self-healed via `missingFrom`) -- the single
  source of the save-here instruction;
- the per-project BLOCK (`engine/projects.js blockBody`, spliced via
  `engine/instructions.js` whose `FILENAME='CLAUDE.md'`) -- the single source of
  the per-project folder path.

A codex/OpenAI agent boots from `AGENTS.md` (`engine/discover.js`), which nothing
in the engine writes. So a codex agent got NEITHER: no folder path and no
save-here instruction.

## The fix (one runner->filename mapping, applied at every brief seam)

`create.briefFilename(runner)` -> `'AGENTS.md'` for codex, `'CLAUDE.md'` else.
The SAME doctrine and block reach the file the agent actually reads; no codex-only
copy, single source of each preserved.

- **`instructions.fileFor`** resolves the filename from the RECORDED runner
  (`create.readJob(name).runner`, the plist arg -- never a live pane), defaulting
  to CLAUDE.md for any agent with no job. This is the chokepoint: `read`/`write`
  become runner-aware, carrying `projects.tellAgent`, the doctrine refresh, and
  `you.tellAgent` along for free. The `store.safeKey` sanitisation and the
  `file.startsWith(dir + path.sep)` containment assertion are unchanged -- only
  the last path segment is runner-chosen, so no path check is loosened (the
  "most dangerous write in the product" keeps its guard).
- **The birth write** (`create.js` `instructionFile(name, runner)`) passes the
  in-scope runner (the plist is not written yet at birth), so a codex agent's
  `AGENTS.md` is CREATED with the doctrine + blocks. This is required because
  `tellAgent` deliberately will NOT invent a boot file later, so if birth did not
  create it a codex agent would never get the block.
- **`status.js`** identity read-back is runner-aware too, matching `fileFor`.

Claude agents are unchanged (runner 'claude' -> CLAUDE.md; no job -> CLAUDE.md).

## Verification

`engine/create.test.js` "#2245: a codex agent boots its brief from AGENTS.md
(with the doctrine)...": a codex agent's brief lands in AGENTS.md carrying the
doctrine and NONE in CLAUDE.md; a claude agent's in CLAUDE.md and none in
AGENTS.md; both resolvers (`instructionFile`, `instructions.fileFor`) agree.
272 instructions/status/discover tests and 150 create tests green.

## Coordination

Split agreed with PigeonPete (the doctrine/block owner): he retracted his
blockBody duplicate (the doctrine is the single source); this runner-aware writer
routes both the doctrine and the block to AGENTS.md verbatim. He is reviewing the
instructions.js diff for the safeKey guard + verbatim reuse.

## Weakest premise / known follow-up (out of scope)

A provider SWITCH (`setProvider`) changes the runner but does NOT migrate an
existing brief between CLAUDE.md and AGENTS.md -- a switched-to-codex agent's old
CLAUDE.md brief would be orphaned and its AGENTS.md (if any) would need a re-tell
to gain the block, and `tellAgent` will not create one. #2245 is the create-time
gap (Kosmos-created codex agents), which this closes; the switch-migration case is
flagged as a separate follow-up rather than expanded into here.
