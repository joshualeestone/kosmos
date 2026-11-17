# #8617: make each agent's Files folder when the agent is made

Card: joshualeestone/kosmos#8617 (feedback, two installs, 11-04 and 11-08).

## What finished looks like

A newly made agent has an empty Files folder beside its instructions file, and an agent made before this gets one the
next time the board starts (the boot sweep). The agent page then lists an empty Files rather than a missing one, and the
agent has a folder to save into and attach from. Nothing that is already called Files is replaced or followed.

## The change

- `engine/dmfiles.js` `ensureFolder(name)`: makes only `filesDir(name)`, inside the agent's own folder when that is
  already a folder; never its parents. A folder already there is kept. A file or a link named Files (even a link to a
  folder, or a dangling one) is left alone and answered as not ok. Never throws.
- `engine/create.js`: called right after the instructions file is written at birth. Not gating.
- `engine/dmfiles.js` `tellAgent`: called once the block is ready to write (on the roster, instructions readable and
  unambiguous). The boot sweep runs `syncEveryone` for every agent, so existing agents get the folder on the next start.
  Its answer does not change the block's verdict.

## Decided

- **Make it in the existing sweep, not a new one.** The boot sweep already visits every named agent with the same gates;
  a second loop would be a second copy of those gates.
- **Rejected: making it when the page asks for the list.** A read (GET) that writes would be a side effect in a path the
  page polls; and the agent, not only the page, needs the folder.
- **Rejected: `recursive: true`.** It would make an agent folder that does not exist, for a name that is not an agent.
- **Kept: the block's "create the folder if it is not there yet".** Still true for a folder that could not be made (a
  file in the way), or one a person deleted.

## Weakest premise

That the agent's own folder at birth is the folder `filesDir` names. create.js writes through `workerDir(name)` and
dmfiles resolves through `instructions.fileFor` (safeKey); the code already notes they agree because creation names pass
`[a-z0-9_-]`. The create test asserts the folder sits beside the instructions file.

## What would change my mind

A report that a person's Files filled with something they did not expect: it would mean an agent or tool reads an empty
Files as an invitation. Nothing in the tree does today (the page lists it; replyfile only attaches from it).

## Tests

- New `engine/dmfiles.folder-8617.test.js` (5): made once and kept with its files; no parent made; a file, a link and a
  dangling link are never replaced or followed; the sweep makes it for an existing agent with the verdict unchanged;
  CONTROL: a refused tell makes none.
- `engine/create.test.js`: a new agent has an empty Files from birth, beside its instructions file.
- Controls: with the create.js call removed, the create test fails; with the tellAgent call removed, the sweep test fails.
- Readers and guards (30 files that read dmfiles or the Files route, create.test.js, fixture-discipline, sandbox-data,
  no-brand-refs, no-name-refs, engine.reachable): 1,028 pass, 0 fail, 69 skipped.
