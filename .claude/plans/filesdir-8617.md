# #8617: make each agent's Files folder when the agent is made

Card: joshualeestone/kosmos#8617 (feedback, two installs, 11-04 and 11-08).

## What finished looks like

A newly made agent has an empty Files folder beside its instructions file, and an agent made before this gets one the
next time the board starts (the boot sweep). The agent has a real folder to save into and attach from (`kosmos reply
--file` refuses a missing one) before its first save. Nothing already called Files is replaced or followed, and a
connected agent (working in a folder the person brought in) is left to make its own.

The page does not change: it hides the Files section for an empty folder and a missing one alike (#3757's ruling), and
this does not revisit that.

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
- **Connected agents are skipped.** Their folder is the person's own (often a project or repo, sometimes on a share);
  the boot sweep and the About-you save run for them too, and Kosmos should not add a folder there uninvited. They keep
  the instruction to make it themselves. The check reads the profile only (`recordedDirSpelling`), never the folder.
- **A Files folder a person deletes comes back empty on the next board start.** Accepted: the page hides an empty
  folder, and the agent is told to save there.
- **Kept: the block's "create the folder if it is not there yet".** Still true for a folder that could not be made (a
  file in the way), or one a person deleted.

## Weakest premise

That the agent's own folder at birth is the folder `filesDir` names. create.js writes through `workerDir(name)` and
dmfiles resolves through `instructions.fileFor` (safeKey); the code already notes they agree because creation names pass
`[a-z0-9_-]`. The create test asserts the folder sits beside the instructions file.

## What would change my mind

A report that a person's Files filled with something they did not expect: it would mean an agent or tool reads an empty
Files as an invitation. Nothing in the tree does today (the page lists it; replyfile only attaches from it).

## Not measured

Windows: a junction or reparse point named Files is reasoned to read as EEXIST and then not a directory under lstat, not
measured; the new test file runs on Windows (tools/windows-tests.js) but its link arm skips there (symlinks need elevation).

## Tests

- New `engine/dmfiles.folder-8617.test.js` (7): made once and kept with its files; no parent made; a file, a link and a
  dangling link are never replaced or followed; the sweep makes it for an existing agent with the verdict unchanged;
  CONTROL: a refused tell makes none.
- `engine/create.test.js`: a new agent has an empty Files from birth, beside its instructions file.
- Controls: with the create.js call removed, the create test fails; with the tellAgent call removed, the sweep test fails.
- Readers and guards (30 files that read dmfiles or the Files route, create.test.js, fixture-discipline, sandbox-data,
  no-brand-refs, no-name-refs, engine.reachable): 1,028 pass, 0 fail, 69 skipped.

## Review

- Round 1 (blind, opus): no BLOCKER, 2 WARNING, 4 NIT.
  - WARNING fixed (words): the comments and plan said the page would show an empty Files; it hides the section for
    empty and missing alike (#3757). Reworded to the real benefit: a folder to save into and attach from.
  - WARNING fixed: the sweep would have made Files inside a connected agent's folder (the person's own). ensureFolder
    now skips an agent whose profile records a folder; test with a plain-agent control; removing the skip fails it.
  - NITs fixed: no raw error message (it carries the path); the sweep test checks the file called Files survives; the
    Windows gap is stated under Not measured; the requires sit together.
- Round 2 (blind, sonnet): no BLOCKER, 1 WARNING, 4 NIT.
  - WARNING fixed: the folder was made before the instructions write, so a failed write left one; it is now made only
    once the block is in place (already current, or just written). Test for the already-current exit.
  - NITs: confirmed only discover.js writes a profile `dir` (connected agents only); a test name narrowed to what it
    proves; the redundant try in create.js kept (it covers a module that fails to load).
- Round 3 (blind, opus): no BLOCKER, 2 WARNING, 4 NIT.
  - WARNING fixed: a folder that could not be made was silent; the tell result now carries `folder` (its reason, not
    for a connected agent) and the boot sweep says it once. Tested both ways.
  - WARNING fixed (words): the Reveal button makes Files in a connected agent's folder on the person's press; that
    difference is now said on both sides.
  - NITs fixed: the older header line, "never through a link" scoped to Files itself, an unknown connected check has its
    own reason, the link test skips on Windows.
- Round 4 (blind, sonnet): no BLOCKER, 1 WARNING (described by the reviewer as not a defect), 4 NIT. Converged.
  - WARNING deferred: the boot line's words cover a real mkdir failure and an unreadable profile alike; the reason after
    the dash tells them apart.
  - NIT recorded in Decided: a deleted empty Files comes back on the next start. Other NITs (a shared reason string, the
    create.js comment, one assertion message's phrasing) not acted on.
- Final validation (6j) failed on one guard: windows-tests-1777 (a test that branches on a win32 host must run on
  Windows or be excluded with a reason), from the round 3 skip. Fixed by adding the file to the Windows run
  (tools/windows-tests.js ALSO), so the folder logic now runs on a real Windows disk; the link arm skips there.
- Round 5 (blind, opus, after the 6j fix): no BLOCKER, 1 WARNING, 4 NIT.
  - WARNING fixed: the boot line said agents "can still make it themselves", false when a file is in the way; dropped.
  - NITs fixed: ensureFolder answers the same keys on every exit; the unknown branch says it covers only a module that
    fails to load; the no-folder arm asserts its reason; the test cleanup uses the Windows-safe removeTree.
