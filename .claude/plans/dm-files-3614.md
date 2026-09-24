# #3614 item 3: the agent instruction to save direct-message files in its own Files folder

Josh, 2026-09-24 12:42 (#admin): agents make files in a direct conversation that are not inside a
project, so they are hard to find. April builds the folder and the Files list on the agent page
(items 1, 2, 4). This is item 3, the instruction, which is mine.

## The path (decided, written on #3614 and sent to April)
`<create.workerDir(name)>/Files`: the agent's own Kosmos folder, the one function Kosmos already uses
for it (it follows a recorded folder for an agent brought in from elsewhere). April had not posted a
path, so per Splinter (13:28) I used the card's call and told her; she builds to it or we change both.

## Shape
A PER-AGENT managed block (`engine/dmfiles.js`, markers `kosmos:dmfiles`), like the reports-to block
and unlike the constant connections block, because the card says the path is written in, not guessed.
- Written at birth in `create.js` (both creation paths), beside the connections block.
- Swept for every existing agent: in the About-you save's side work and at board start, the same two
  places the reports-to and connections blocks are refreshed (#1649 / #1676).
- The same guards as its siblings: roster gate, never invents an instructions file, refuses two blocks,
  never throws. The path is neutralised, so a folder name cannot close the block early.
- The marker pair joins `projects.ALL_MARKERS()` (the registry test enforces it).

## Decided, and why
- The block tells the agent to CREATE the folder if missing, so it works before and after April's half.
- Premise noted on the card: removal checks whether the worker folder still exists rather than always
  deleting it, so files saved there may outlive the agent. It does not change the instruction.
- Weakest premise: that "a direct conversation, not inside a project" is a line an agent can draw. If an
  agent is in a project room when the person asks it for a file in a DM, it still has to choose.

## Verification
- `engine/dmfiles.test.js` (7): the path is workerDir + Files; the real path is in the block; a marker in
  the path cannot close it; lands and is idempotent; each agent gets its OWN path; sibling guards; registry.
- `server.dmfiles-refresh-3614.test.js` (3): a plain board start puts it in an existing agent with that
  agent's own path; no instructions file is invented; a board with an unwritable agent still starts.
  RED with the boot call removed.
- `engine/create.test.js` #3614: born with the block on both paths, own path, later sweep writes nothing.
  RED with the birth join broken (the exact bug caught while writing it: `dir` was not in scope).
