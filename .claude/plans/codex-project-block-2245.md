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

`engine/create.test.js` "#2245: a provider switch MOVES the brief to the file the
new runner boots from, both directions": a claude-born agent switched to openai
moves CLAUDE.md -> AGENTS.md (and back on the reverse switch), a codex-born agent
switched to claude moves AGENTS.md -> CLAUDE.md, the old file is gone each time,
and the bytes are asserted IDENTICAL (moved, not regenerated, so a per-project
block already in the brief survives). Verified red-capable (disabling the rename
fails the test).

## Coordination

Split agreed with PigeonPete (the doctrine/block owner): he retracted his
blockBody duplicate (the doctrine is the single source); this runner-aware writer
routes both the doctrine and the block to AGENTS.md verbatim. He reviewed
`fd6c0b47` and APPROVED (safeKey + containment intact, no path injection via
runner, verbatim reuse, write/read agree). His two non-blocking notes are
handled: the readJob-per-poll cost is a small local plist read behind the
existing (larger) instruction-file read, and the switch-migration follow-up is
addressed below.

## Provider-switch brief migration (blind-review WARNING, FIXED here)

A provider SWITCH (`setProvider`) rewrites the plist runner but used NOT to move
the brief file, which #2245 turned into a one-directional REGRESSION: before
#2245 a codex-born brief lived in CLAUDE.md, so a switch to claude still found
it; after #2245 it lives in AGENTS.md, so a switch to claude booted an empty
brief (and claude->codex was already broken the same way). Shipping a regression
under "scoped out" is wrong, so this is fixed in-card: `setProvider` now moves
the brief from the old runner's filename to the new one (a same-directory,
atomic rename that also removes the orphan) whenever the runner changes, using
the same `briefFilename` mapping. Best-effort, matching the sibling profile
write: the plist is the launch truth, and the residual (a near-impossible
same-directory rename failure) is stated honestly rather than claimed to
self-heal.

The move NEVER clobbers an existing destination (blind-review iter-4): a
connected agent lives in the person's own folder, which can hold BOTH CLAUDE.md
and AGENTS.md (discover.js handles "a person who has both"), so `renameSync`
runs only when the destination does not already exist. If it does, the new
runner already has a brief to read and the old file is the user's to keep.
A Kosmos-created agent only ever has one brief, so the guard never changes its
behaviour. A test arm writes a pre-existing destination and asserts neither
file is lost (verified red-capable).

## Weakest premise / known follow-up (out of scope): the name-regime residual

A blind-review WARNING deferred here with a code read.

`fileFor` resolves the DIRECTORY via `store.safeKey(agent)` (broad acceptance)
but the RUNNER via `create.readJob(agent)`, which validates the name with
`NAME_RE` (`^[a-z0-9][a-z0-9_-]{1,31}$`) and returns null on a miss, so the
runner falls back to 'claude' -> CLAUDE.md. A CONNECTED codex agent whose name
passes `nameUsable` but fails `NAME_RE` (uppercase, a dot, a space, single char)
therefore gets its brief routed to CLAUDE.md, not the AGENTS.md it reads.

Deferred, not fixed, on a code read:
- NOT a regression: pre-#2245 every agent got CLAUDE.md, so this is unchanged
  behaviour for these agents, and it is fail-closed to the historical default.
- Kosmos-CREATED codex agents (this card's launch-blocker scope) are provably
  unaffected: creation gates the name through `NAME_RE`, so whenever `readJob`
  succeeds `safeKey(agent) === agent` and there is no wrong-file hazard.
- The fix is not a one-liner: `readJob`'s `NAME_RE` guards `plistPath(name)`, a
  path built from the name, so relaxing it to match `safeKey` has its own
  path-traversal surface and deserves its own scoped change.

Tracked on #2250 (the same connected/non-birth code path as the switch case).
